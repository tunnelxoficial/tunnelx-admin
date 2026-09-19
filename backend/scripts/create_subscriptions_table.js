const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { sequelize } = require('../config/db');
const Subscription = require('../models/Subscription');

/**
 * Cria a tabela Subscriptions.
 *
 * Script, e nao DB_SYNC: o sync liga o `alter` para TODOS os modelos, e no MSSQL
 * ele gera DDL invalida para colunas com default (ver o comentario em
 * config/db.js). Aqui a criacao e cirurgica — so esta tabela, sem tocar no que
 * ja esta em producao.
 *
 * Rodar uma vez:  node scripts/create_subscriptions_table.js
 * Reexecutar e inofensivo: `sync()` sem force nao recria tabela existente.
 */
async function up() {
    try {
        await sequelize.authenticate();
        console.log('Banco conectado.');

        await Subscription.sync();
        console.log('Tabela Subscriptions pronta.');

        const [linhas] = await sequelize.query(
            "SELECT COUNT(*) AS total FROM sys.tables WHERE name = 'Subscriptions'"
        );
        console.log('Confirmacao no catalogo do SQL Server:', linhas[0]?.total === 1 ? 'existe' : 'NAO existe');

        console.log('\nProximos passos:');
        console.log('  1. ASAAS_API_KEY no .env (a chave que estava no codigo precisa ser REVOGADA)');
        console.log('  2. ASAAS_WEBHOOK_TOKEN no .env e o MESMO no painel do Asaas');
        console.log('  3. Apontar o webhook do Asaas para  POST /webhook  deste servidor');
    } catch (error) {
        console.error('Falha na migracao:', error.message);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
}

up();
