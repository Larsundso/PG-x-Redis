import readline from 'readline';
import Client from './index.js';
const client = new Client({
    database: 'DataBase Name',
    user: 'DataBase User',
    password: 'DataBase Password',
    port: 5432,
    host: 'DataBase Host',
}, {
    password: 'DataBase Password',
    host: 'DataBase Host',
    name: 'DataBase Alias',
});
await client.init();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('line', async (msg) => {
    if (msg === 'restart')
        process.exit();
    console.log(msg.includes('await') || msg.includes('return')
        ?
            await eval(`(async () => {${msg}})()`)
        :
            eval(msg));
});
process.on('unhandledRejection', (e) => console.log(e));
//# sourceMappingURL=test.js.map