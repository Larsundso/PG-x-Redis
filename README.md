# PG x Redis

PG x Redis utilizes Redis, RedisJSON and RediSearch to speed up PostgreSQL Queries by caching Data into Redis and Selecting Redis Data over PostgreSQL Data.

## Prerequisites

To use this Package, your Server needs Redis, RedisJSON, RediSearch and PostgreSQL.

### Getting started

```js
import RedisXpSQL from 'PG-x-Redis';

const DataBase = new RedisXpSQL(
  { // Postgres Config
    database: 'DataBase Name',
    user: 'DataBase User',
    password: 'DataBase Password',
    port: 5432,
    host: 'DataBase Host',
  },
  { // Redis Config
    password: 'DataBase Password',
    host: 'DataBase Host',
    name: 'DataBase Alias',
  },
);

await DataBase.init();
```
<br>

This Package only supports simple Queries and 4 types of Actions<br>
**Notice**: Only use this Packages `query()` Function on PostgreSQL Tables with defined Primary Keys.
<br> It uses Primary Keys to save Data in Redis as it is a KeyValue Storage.

### Supported Action Types

`INSERT`
```js
await DataBase.query(
    `INSERT INTO userinfo (firstname, lastname, email, age) VALUES ($1, $2, $3, $4);`,
    [ 'John', 'Doe', 'JohnDoe@mail.com', 24],
);
// Response > [{ firstname: 'John', lastname: 'Doe', email: 'JohnDoe@mail.com', age: 24 }]
```

`UPDATE` 
```js
await DataBase.query(
    `UPDATE userinfo SET age = $1 WHERE firstname = $2 AND lastname = $3;`,
    [ 25, 'John', 'Doe' ],
);
// Response > [{ 'John', 'Doe',  'JohnDoe@mail.com', 25 }]
```

`SELECT` 
```js
await DataBase.query(
    `SELECT * FROM userinfo WHERE age = $1`,
    [ 25 ],
);
// Response > [{ 'John', 'Doe',  'JohnDoe@mail.com', 25 }]
```

`DELETE`
```js
await DataBase.query(
    `DELETE FROM userinfo WHERE email = $1`,
    [ 'JohnDoe@mail.com' ],
);
// Response > [{ 'John', 'Doe',  'JohnDoe@mail.com', 25 }]
```

### Query Replacements
Replacements can only be passed in Array Form for `pg` Data Sanitization

#### Redis Client
```js
DataBase.redis
DataBase.redis.json.get('Key')
DataBase.redis.ft.search('Index Key', 'Redis Query')
// etc...
```
#### PostgreSQL Client
```js
DataBase.postgres
DataBase.postgres.query(`PSQL Query`, [ 'SQL Options' ])
// etc...
```

### ! Warning ! for raw Interactions with Redis and PostgreSQL Clients
Changed Data will not be cached

## Contributing
I will happily accept your pull request if it:
- looks reasonable
- does not break backwards compatibility
