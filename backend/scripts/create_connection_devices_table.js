const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { sequelize } = require('../config/db');
const ConnectionDevice = require('../models/ConnectionDevice');

/**
 * Cria ConnectionDevices — um peer WireGuard por aparelho.
 *
 * Esta é a migração que corrige a causa das quedas e da oscilação. Ver o
 * comentário em models/ConnectionDevice.js para o mecanismo.
 *
 * NÃO mexe em nada que já existe. As Connections continuam com o `config`
 * delas, e os `.conf` já distribuídos seguem funcionando — a migração é
 * aditiva de propósito, porque derrubar os clientes atuais para consertar a
 * arquitetura seria trocar um problema por outro.
 *
 * Rodar uma vez:  node scripts/create_connection_devices_table.js
 */

/**
 * Índice único em (ConnectionId, ClientId).
 *
 * É o coração do modelo: um aparelho POR cliente POR túnel. Sem esta garantia
 * no banco, uma corrida entre duas requisições do mesmo cliente (o app consulta
 * /app/connections e /app/connections/state quase juntos) criaria dois devices,
 * dois peers e dois IPs para a mesma pessoa — reintroduzindo pela porta dos
 * fundos exatamente o consumo duplicado que esta migração existe para eliminar.
 */
const UNICO = 'UX_ConnectionDevices_Connection_Client';

async function up() {
    try {
        await sequelize.authenticate();
        console.log('Banco conectado.\n');

        await ConnectionDevice.sync();
        console.log('Tabela ConnectionDevices pronta.');

        const [existe] = await sequelize.query(
            'SELECT COUNT(*) AS total FROM sys.indexes WHERE name = :nome',
            { replacements: { nome: UNICO } }
        );

        if (existe[0]?.total) {
            console.log(`- ${UNICO}: ja existia.`);
        } else {
            await sequelize.query(
                `CREATE UNIQUE INDEX ${UNICO} ON ConnectionDevices (ConnectionId, ClientId)`
            );
            console.log(`+ ${UNICO} criado (um aparelho por cliente por tunel)`);
        }

        const [cols] = await sequelize.query(
            "SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('ConnectionDevices') ORDER BY column_id"
        );
        console.log('\nColunas:', cols.map((c) => c.name).join(', '));

        const [quantos] = await sequelize.query('SELECT COUNT(*) AS total FROM ConnectionDevices');
        console.log('Devices existentes:', quantos[0].total);

        console.log('\nNada foi alterado em Connections: os .conf ja distribuidos');
        console.log('continuam validos. O peer por aparelho passa a valer para');
        console.log('quem abrir o app a partir de agora.');
    } catch (error) {
        console.error('Falha:', error.message);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
}

up();
