import readline from 'readline';
import Client from './index.js';

const client = new Client(
  {
    database: 'DataBase Name',
    user: 'DataBase User',
    password: 'DataBase Password',
    port: 5432,
    host: 'DataBase Host',
  },
  {
    password: 'DataBase Password',
    host: 'DataBase Host',
    name: 'DataBase Alias',
  },
);

await client.init();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('line', async (msg: string) => {
  if (msg === 'restart') process.exit();
  // eslint-disable-next-line no-console
  console.log(
    msg.includes('await') || msg.includes('return')
      ? // eslint-disable-next-line no-eval
        await eval(`(async () => {${msg}})()`)
      : // eslint-disable-next-line no-eval
        eval(msg),
  );
});

// eslint-disable-next-line no-console
process.on('unhandledRejection', (e: Error) => console.log(e));
