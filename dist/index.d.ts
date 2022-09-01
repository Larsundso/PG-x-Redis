/// <reference types="node" />
import { EventEmitter } from 'events';
import PG from 'pg';
import Redis from 'redis';
declare type BasicReturnType = {
    [key: string]: string | boolean | null | number | BasicReturnType[];
}[];
export default class RedisXpSQL extends EventEmitter {
    postgres: PG.Pool;
    redis: Redis.RedisClientType;
    constructor(pgConfig: {
        database: string;
        user: string;
        password: string;
        port: number;
        host: string;
    }, redisConfig: {
        password?: string;
        name: string;
        host: string;
    });
    _redisEnd: () => Promise<void>;
    _initRedis: () => Promise<void>;
    _initPsql: () => Promise<void>;
    init: () => Promise<void>;
    _getDataTypes: (tableName: string) => Promise<{
        column_name: string;
        data_type: string;
    }[]>;
    _getPkeys: (tableName: string) => Promise<string[]>;
    _cacheData: (data: BasicReturnType, tableName: string) => Promise<BasicReturnType>;
    _redisQueryCreator: (whereContent: string, tableName: string, options?: (string | boolean | null | number)[]) => Promise<string>;
    query(sql: string, options?: (string | boolean | null | number)[]): Promise<BasicReturnType>;
}
export {};
//# sourceMappingURL=index.d.ts.map