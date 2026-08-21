const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
        host: process.env.DB_HOST,
        dialect: 'mssql',
        port: process.env.DB_PORT,
        logging: false,
        dialectOptions: {
            options: {
                encrypt: false, // Use true for Azure, false for local dev usually
                trustServerCertificate: true // Self-signed certs
            }
        }
    }
);

const connectDB = async () => {
    try {
        await sequelize.authenticate();
        console.log('Database connected successfully.');
    } catch (error) {
        console.error('Unable to connect to the database:', error);
        return; // sem conexao nao ha o que sincronizar
    }

    // Antes havia um sequelize.sync({ alter: true }) fixo aqui, executado a cada
    // boot do processo. Dois problemas:
    //
    // 1) No MSSQL o Sequelize gera DDL invalida para colunas com default, por ex.
    //      ALTER TABLE [tunnelx].[Plans] ALTER COLUMN [total_connections] INTEGER DEFAULT 1
    //    O T-SQL nao aceita DEFAULT dentro de ALTER COLUMN (erro 156: "Incorrect
    //    syntax near the keyword 'DEFAULT'") -- um DEFAULT e um objeto de constraint
    //    separado, criado com ALTER TABLE ... ADD CONSTRAINT ... DEFAULT ... FOR coluna.
    //
    // 2) Alterar o schema de producao a cada restart do processo e arriscado por si
    //    so, ainda mais sem migrations e com varias instancias possiveis.
    //
    // Agora a sincronizacao precisa ser pedida explicitamente pela variavel DB_SYNC:
    //   DB_SYNC=create  -> cria apenas tabelas ausentes, nao altera as existentes
    //   DB_SYNC=alter   -> comportamento antigo (evite em producao no MSSQL)
    //   ausente/vazio   -> nao mexe no schema (padrao)
    const mode = (process.env.DB_SYNC || '').trim().toLowerCase();
    if (mode !== 'create' && mode !== 'alter') return;

    try {
        await sequelize.sync(mode === 'alter' ? { alter: true } : {});
        console.log('Models synchronized (DB_SYNC=' + mode + ').');
    } catch (error) {
        // Falha de schema nao deve derrubar a API: as tabelas ja existem em producao.
        console.error('Falha ao sincronizar o schema (DB_SYNC=' + mode + '). A API segue no ar:', error.message);
    }
};

module.exports = { sequelize, connectDB };
