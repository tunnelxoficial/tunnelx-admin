const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { sequelize } = require('../config/db');

/**
 * Colunas da sessao unica em Clients.
 *
 * DDL explicita em vez de DB_SYNC: o sync com `alter` atinge todos os modelos e
 * no MSSQL gera comando invalido para coluna com default (ver config/db.js).
 *
 * Rodar uma vez:  node scripts/add_session_columns.js
 * Reexecutar e inofensivo: cada coluna so e criada se ainda nao existir.
 *
 * Nao preenche nada nas linhas existentes. `active_session_id` nulo significa
 * "ninguem logado", que e o estado correto depois desta mudanca: os tokens ja
 * emitidos nao carregam `sid` e serao recusados, entao todo mundo entra de novo
 * — uma vez — e a partir dai cada conta fica presa a um aparelho.
 */
const COLUNAS = [
    ['active_session_id', 'NVARCHAR(64) NULL'],
    ['active_device', 'NVARCHAR(120) NULL'],
    // DATETIMEOFFSET, e nao DATETIME: o Sequelize manda a data com fuso
    // ("... +00:00") e o DATETIME do SQL Server recusa a conversao — erro 241,
    // que derrubaria TODO login. As demais colunas de data desta base ja usam
    // datetimeoffset; esta precisa seguir o mesmo tipo.
    ['session_started_at', 'DATETIMEOFFSET NULL']
];

async function up() {
    try {
        await sequelize.authenticate();
        console.log('Banco conectado.');

        for (const [nome, ddl] of COLUNAS) {
            const [existe] = await sequelize.query(
                "SELECT COUNT(*) AS total FROM sys.columns" +
                " WHERE object_id = OBJECT_ID('Clients') AND name = :nome",
                { replacements: { nome } }
            );
            if (existe[0]?.total) {
                console.log(`Coluna ${nome} ja existia.`);
                continue;
            }
            await sequelize.query(`ALTER TABLE Clients ADD [${nome}] ${ddl}`);
            console.log(`Coluna ${nome} adicionada.`);
        }

        const [cols] = await sequelize.query(
            "SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('Clients')" +
            " AND name IN ('active_session_id','active_device','session_started_at')"
        );
        console.log('Confirmado:', cols.map((c) => c.name).join(', ') || 'NENHUMA');

        console.log('\nEfeito no proximo deploy: todos os clientes precisarao entrar');
        console.log('uma vez de novo — os tokens antigos nao tem sessao vinculada.');
    } catch (error) {
        console.error('Falha na migracao:', error.message);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
}

up();
