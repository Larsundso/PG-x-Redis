import { EventEmitter } from 'events';
import PG from 'pg';
import Redis from 'redis';

const whereStatementReplacementsRedis = {
  conditions: [
    [' != ', '-(@$name:$cond)'],
    [' >= ', '-(@$name:[$cond +inf])'],
    [' <= ', '-(@$name:[+inf $cond])'],
    [' > ', '-(@$name:[($cond +inf])'],
    [' < ', '-(@$name:[+inf ($cond])'],
    [' = ', '(@$name:$cond)'],
  ],
  splitters: [
    ['AND', ''],
    ['OR', '|'],
  ],
};

type BasicReturnType = {
  [key: string]: string | boolean | null | number | BasicReturnType[];
}[];

export default class RedisXpSQL extends EventEmitter {
  postgres: PG.Pool;
  redis: Redis.RedisClientType;

  constructor(
    pgConfig: {
      database: string;
      user: string;
      password: string;
      port: number;
      host: string;
    },
    redisConfig: {
      password?: string;
      name: string;
      host: string;
    },
  ) {
    super();

    this.postgres = new PG.Pool(pgConfig);
    this.redis = Redis.createClient(redisConfig);

    this.query = this.query.bind(this);
    this.init = this.init.bind(this);
    this._initRedis = this._initRedis.bind(this);
    this._initPsql = this._initPsql.bind(this);
    this._redisEnd = this._redisEnd.bind(this);
    this._getPkeys = this._getPkeys.bind(this);
    this._cacheData = this._cacheData.bind(this);
  }

  async _redisEnd() {
    // eslint-disable-next-line no-console
    console.log('[Redis DB] Connection ended. Re-initiating...');

    this.redis.removeListener('connect', _redisConnect);
    this.redis.removeListener('ready', _redisReady);
    this.redis.removeListener('end', this._redisEnd);
    this.redis.removeListener('error', _redisError);
    this.redis.removeListener('reconnecting', _redisReconnecting);

    if (this.getMaxListeners() !== 0) this.setMaxListeners(this.getMaxListeners() - 1);

    this._initRedis();
  }

  async _initRedis() {
    if (this.getMaxListeners() !== 0) this.setMaxListeners(this.getMaxListeners() + 1);

    this.redis.on('connect', _redisConnect);
    this.redis.on('ready', _redisReady);
    this.redis.on('end', this._redisEnd);
    this.redis.on('error', _redisError);
    this.redis.on('reconnecting', _redisReconnecting);

    await this.redis.connect();
  }

  async _initPsql() {
    if (this.getMaxListeners() !== 0) this.setMaxListeners(this.getMaxListeners() + 1);

    this.postgres.query('SELECT NOW() as now;', (err: Error | undefined) => {
      if (err) throw new Error(`[pSQL DB] Couldn't connect to DataBase\n${err}`);
      // eslint-disable-next-line no-console
      else console.log('[pSQL DB] Established Connection to DataBase');
    });

    this.postgres.connect((err: Error | undefined) => {
      if (!err) return;

      throw new Error(`[pSQL DB] Couldn't connect to DataBase\n${err}`);
    });

    this.postgres.on('error', _psqlError);
  }

  async init() {
    await this._initRedis();
    await this._initPsql();
  }

  async _getDataTypes(tableName: string) {
    const redisRes = await this.redis.json.get(`types-${tableName}`);
    if (redisRes) return redisRes as { column_name: string; data_type: string }[];

    const psqlRes = await this.postgres.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1;`,
      [tableName],
    );

    if (!psqlRes) throw new Error('[pSQL DB] No Response received from Query');
    if (!psqlRes.rowCount) return [];

    await this.redis.json.set(`types-${tableName}`, '$', psqlRes.rows);
    return psqlRes.rows as { column_name: string; data_type: string }[];
  }

  async _getPkeys(tableName: string) {
    const redisRes = await this.redis.json.get(`pkeys-${tableName}`);
    if (redisRes) {
      return (redisRes as { attname: string }[]).map((s) => s.attname) as unknown as string[];
    }
    const psqlRes = await this.postgres.query(`
    SELECT 
      pg_attribute.attname 
    FROM 
      pg_index, pg_class, pg_attribute, pg_namespace 
    WHERE 
      pg_class.oid = '${tableName}'::regclass AND 
      indrelid = pg_class.oid AND 
      nspname = 'public' AND 
      pg_class.relnamespace = pg_namespace.oid AND 
      pg_attribute.attrelid = pg_class.oid AND 
      pg_attribute.attnum = any(pg_index.indkey) AND 
      indisprimary;
   `);

    if (!psqlRes || !psqlRes.rowCount) throw new Error(`No pKeys for Table "${tableName}" found`);

    this.redis.json.set(`pkeys-${tableName}` as never, '$' as never, psqlRes.rows as never);
    return psqlRes.rows.map((s) => s.attname) as string[];
  }

  async _cacheData(data: BasicReturnType, tableName: string) {
    const dataTypes = await this._getDataTypes(tableName);
    const dataObject: { [key: string]: { type: string; SORTABLE: true; AS: string } } = {};

    dataTypes.forEach((d) => {
      dataObject[`$.${d.column_name}`] = {
        type: Redis.SchemaFieldTypes.TEXT,
        SORTABLE: true,
        AS: d.column_name,
      };
    });

    await this.redis.ft
      .create(
        `index:${tableName}` as never,
        dataObject as never,
        {
          ON: 'JSON',
          PREFIX: `${tableName}`,
        } as never,
      )
      .catch(() => null);

    const pKeys = await this._getPkeys(tableName);
    const pKeyStrings = data.map((r) => pKeys.map((p) => r[p]).join(':'));

    await Promise.all(
      pKeyStrings.map((s, i) => this.redis.json.set(`${tableName}:${s}`, '$', data[i])),
    );

    return data;
  }

  async query(
    sql: string,
    options?: (string | boolean | null | number)[],
  ): Promise<BasicReturnType> {
    if ([...sql].filter((s) => s === ';').length > 1) {
      const sqls = sql.split(/;\s?/g).filter((s) => s.length);
      const optionsPerSql = sqls.map((query) =>
        query
          .match(/\$\d+/g)
          ?.map((num) => (options ? options[Number(num.replace('$', '')) - 1] : null)),
      );

      const finishedQueries = sqls.map((q) => {
        q.match(/\$\d+/g)?.forEach((match, i) => {
          q = q.replace(`${match}`, `$${i + 1}`);
        });
        return q;
      });

      return (
        await Promise.all(finishedQueries.map((query, i) => this.query(query, optionsPerSql[i])))
      ).flat(1);
    }

    sql = sql.replace(';', '');

    if (options && !Array.isArray(options)) throw new Error('Only Array Options are supported');

    const action = sql.toLowerCase().split(/\s+/)[0];
    if (!action) throw new Error('No Query Data');
    const queryArgs = sql.slice(action.length + 1).split(/\s+/);

    switch (action) {
      case 'select': {
        const tableName = queryArgs[2].toLowerCase();
        const whereContent = sql.toLowerCase().split('where')[1];
        const redisQuery = redisQueryCreator(whereContent, options);
        let needsFirstRun = false;
        let redisRes = await this.redis.ft.search(`index:${tableName}`, redisQuery).catch((e) => {
          if (!String(e).includes('no such index')) return null;
          needsFirstRun = true;
          return null;
        });

        if (needsFirstRun) {
          const firstCacheRes = await this.postgres.query(`SELECT * FROM ${tableName};`);

          if (!firstCacheRes) throw new Error('[pSQL DB] No Response received from Query');
          if (!firstCacheRes.rowCount) return [];

          await this._cacheData(firstCacheRes.rows, tableName);

          redisRes = await this.redis.ft.search(`index:${tableName}`, redisQuery).catch(() => null);
        }

        if (redisRes) {
          return redisRes.documents.map((d) => d.value) as BasicReturnType;
        }

        const psqlRes = await this.postgres.query(sql, options);

        if (!psqlRes) throw new Error('[pSQL DB] No Response received from Query');
        if (!psqlRes.rowCount) return [];

        return this._cacheData(psqlRes.rows, tableName);
      }
      case 'update': {
        const tableName = queryArgs[0].toLowerCase();
        const whereContent = sql.toLowerCase().split('where')[1];
        const redisQuery = redisQueryCreator(whereContent, options);
        let needsFirstRun = false;
        let redisRes = await this.redis.ft.search(`index:${tableName}`, redisQuery).catch((e) => {
          if (!String(e).includes('no such index')) return null;
          needsFirstRun = true;
          return null;
        });

        if (needsFirstRun) {
          await this.query(`SELECT * FROM ${tableName};`);
          redisRes = await this.redis.ft.search(`index:${tableName}`, redisQuery).catch(() => null);
        }

        if (!redisRes || !redisRes.total) return [];
        const psqlRes = await this.postgres.query(`${sql} RETURNING *`, options);

        return this._cacheData(psqlRes.rows, tableName);
      }
      case 'insert': {
        const tableName = queryArgs[1].toLowerCase();
        const psqlRes = await this.postgres.query(`${sql} RETURNING *`, options);

        return this._cacheData(psqlRes.rows, tableName);
      }
      case 'delete': {
        const tableName = queryArgs[1].toLowerCase();
        const psqlRes = await this.postgres.query(`${sql} RETURNING *`, options);

        if (!psqlRes) throw new Error('[pSQL DB] No Response received from Query');

        const pKeys = await this._getPkeys(tableName);

        await Promise.all(
          psqlRes.rows.map((r) => {
            const pKeyStrings = pKeys.map((p) => r[p]).join(':');
            return this.redis.json.del(pKeyStrings, '$');
          }),
        );

        return psqlRes.rows;
      }
      default: {
        throw new Error('Unsupported Action Type');
      }
    }
  }
}

const _redisConnect = async () => {
  // eslint-disable-next-line no-console
  console.log('[Redis DB] Connecting to DataBase...');
};

const _redisReady = async () => {
  // eslint-disable-next-line no-console
  console.log('[Redis DB] Established Connection to DataBase');
};

const _redisError = async (err: Error) => {
  if (!err) return;
  throw new Error(`[Redis DB] Client Error\n${err}`);
};

const _redisReconnecting = async () => {
  // eslint-disable-next-line no-console
  console.log('[Redis DB] Connection lost. Re-connecting...');
};

const _psqlError = async (err: Error) => {
  throw new Error(`[pSQL DB] Unexpected Error on idle Client\n${err}`);
};

const redisQueryCreator = (
  whereContent: string,
  options?: (string | boolean | null | number)[],
) => {
  if (!whereContent) return '*';
  whereContent = whereContent.trim();

  const args = whereContent.split(/\s+/g);
  const chunks: string[][] = [[]];
  let lastI = 0;
  args.forEach((arg) => {
    if (chunks[lastI].length === 4) {
      lastI += 1;
      chunks[lastI] = [arg];
    } else {
      chunks[lastI].push(arg);
    }
  });

  const replacedConditions = chunks.map((arg) => {
    const replacement = whereStatementReplacementsRedis.conditions.find(
      (c) => c[0] === ` ${arg[1]} `,
    )?.[1];

    let parsedArg: string | number | boolean | null | undefined;
    if (/\$\d+/g.test(arg[2])) {
      const num = Number(arg[2].replace('$', '')) - 1;
      parsedArg = ['string'].includes(typeof options?.[num])
        ? `"${options?.[num]}"`
        : options?.[num];
    } else [, , parsedArg] = arg;

    return [replacement?.replace('$name', arg[0]).replace('$cond', String(parsedArg)), arg[2]];
  });

  const finishedRedisQuery = replacedConditions
    .map(([c, splitter]) => {
      const splitterToUse = whereStatementReplacementsRedis.splitters.find(
        (s) => s[0] === splitter,
      )?.[1];

      return splitterToUse !== undefined ? [c, splitterToUse] : [c];
    })
    .flat(1)
    .join(' ')
    .replace(/\s+/g, ' ');

  return finishedRedisQuery;
};
