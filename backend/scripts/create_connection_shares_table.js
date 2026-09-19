const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { sequelize } = require('../config/db');
const ConnectionShare = require('../models/ConnectionShare');

/**
 * Cria a tabela ConnectionShares — os convites de acesso a um tunel.
 *
 * Script, e nao DB_SYNC: o sync com `alter` atinge TODOS os modelos, e no MSSQL
 * gera DDL invalida para colunas com default (ver config/db.js). Aqui so esta
 * tabela e tocada.
 *
 * Rodar uma vez:  node scripts/create_connection_shares_table.js
 * Reexecutar e inofensivo: sync() sem force nao recria tabela existente.
 */
async function up() {
    try {
        await sequelize.authenticate();
        console.log('Banco conectado.');

        await ConnectionShare.sync();
        console.log('Tabela ConnectionShares pronta.');

        const [tabela] = await sequelize.query(
            "SELECT COUNT(*) AS total FROM sys.tables WHERE name = 'ConnectionShares'"
        );
        console.log('Catalogo do SQL Server:', tabela[0]?.total === 1 ? 'existe' : 'NAO existe');

        /*
         * Colunas acrescentadas depois da primeira versao da tabela.
         *
         * sync() sem `alter` nao mexe em tabela existente — de proposito, ver
         * config/db.js. Entao o que nasce depois entra por DDL explicita, e
         * so se ainda nao existir, para o script continuar reexecutavel.
         */
        const faltando = [
            ["duration_key", "NVARCHAR(16) NOT NULL CONSTRAINT DF_ConnectionShares_duration_key DEFAULT 'indefinido'"]
        ];
        for (const [nome, ddl] of faltando) {
            const [existe] = await sequelize.query(
                "SELECT COUNT(*) AS total FROM sys.columns" +
                " WHERE object_id = OBJECT_ID('ConnectionShares') AND name = :nome",
                { replacements: { nome } }
            );
            if (existe[0]?.total) continue;
            await sequelize.query(`ALTER TABLE ConnectionShares ADD [${nome}] ${ddl}`);
            console.log(`Coluna ${nome} adicionada.`);
        }

        const [colunas] = await sequelize.query(
            "SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('ConnectionShares') ORDER BY column_id"
        );
        console.log('Colunas:', colunas.map((c) => c.name).join(', '));
    } catch (error) {
        console.error('Falha na migracao:', error.message);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
}

up();
