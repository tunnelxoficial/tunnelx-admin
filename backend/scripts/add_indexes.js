const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { sequelize } = require('../config/db');

/**
 * Índices das rotas quentes.
 *
 * A tabela `Connections` tinha só a chave primária. Toda consulta do aplicativo
 * filtra por `ClientId`, e o provisionador varre por `status_queue` a cada 60
 * segundos — as duas faziam varredura completa. Com poucas centenas de linhas
 * ninguém percebe; é exatamente o tipo de coisa que só dói quando o produto
 * cresce, e aí dói em todas as telas ao mesmo tempo.
 *
 * `Clients.cpf` ganha um índice sobre a forma NORMALIZADA (só dígitos), porque
 * o login compara assim:
 *
 *     WHERE REPLACE(REPLACE(REPLACE(cpf,'.',''),'-',''),' ','') = :digitos
 *
 * Uma expressão desse tipo no WHERE torna a consulta não-sargável: o SQL Server
 * precisa calcular a função para cada linha antes de comparar, então nenhum
 * índice comum sobre `cpf` ajuda. A saída é uma coluna computada persistida com
 * a mesma expressão, indexada — aí o otimizador reconhece e faz busca.
 *
 * Rodar uma vez:  node scripts/add_indexes.js
 * Reexecutar é inofensivo: cada objeto só é criado se ainda não existir.
 */

const INDICES = [
    {
        nome: 'IX_Connections_ClientId',
        tabela: 'Connections',
        ddl: 'CREATE INDEX IX_Connections_ClientId ON Connections (ClientId)',
        porque: '/app/connections e /app/connections/state filtram por aqui'
    },
    {
        nome: 'IX_Connections_status_queue',
        tabela: 'Connections',
        // Filtrado: o provisionador só procura 'WAIT', e essas linhas são poucas.
        // O índice fica minúsculo e não é tocado pelas conexões já provisionadas.
        ddl: "CREATE INDEX IX_Connections_status_queue ON Connections (status_queue) WHERE status_queue = 'WAIT'",
        porque: 'o provisionador varre a cada 60s procurando WAIT'
    },
    {
        nome: 'IX_Subscriptions_ClientId',
        tabela: 'Subscriptions',
        ddl: 'CREATE INDEX IX_Subscriptions_ClientId ON Subscriptions (ClientId, id DESC)',
        porque: 'resolveClientAccess busca a assinatura mais recente do cliente'
    },
    {
        nome: 'IX_ConnectionShares_Guest',
        tabela: 'ConnectionShares',
        ddl: 'CREATE INDEX IX_ConnectionShares_Guest ON ConnectionShares (GuestClientId, status)',
        porque: 'sharesDoConvidado roda a cada poll de cada convidado'
    },
    {
        nome: 'IX_ConnectionShares_Connection',
        tabela: 'ConnectionShares',
        ddl: 'CREATE INDEX IX_ConnectionShares_Connection ON ConnectionShares (ConnectionId, status)',
        porque: 'contarOcupacao conta vagas por conexao'
    },
    {
        nome: 'IX_ConnectionShares_token',
        tabela: 'ConnectionShares',
        ddl: 'CREATE UNIQUE INDEX IX_ConnectionShares_token ON ConnectionShares (token)',
        porque: 'o aceite do convite busca pelo token'
    }
];

async function existeTabela(nome) {
    const [r] = await sequelize.query(
        'SELECT COUNT(*) AS total FROM sys.tables WHERE name = :nome',
        { replacements: { nome } }
    );
    return r[0]?.total > 0;
}

async function existeIndice(nome) {
    const [r] = await sequelize.query(
        'SELECT COUNT(*) AS total FROM sys.indexes WHERE name = :nome',
        { replacements: { nome } }
    );
    return r[0]?.total > 0;
}

async function existeColuna(tabela, coluna) {
    const [r] = await sequelize.query(
        'SELECT COUNT(*) AS total FROM sys.columns' +
        ' WHERE object_id = OBJECT_ID(:tabela) AND name = :coluna',
        { replacements: { tabela, coluna } }
    );
    return r[0]?.total > 0;
}

async function up() {
    try {
        await sequelize.authenticate();
        console.log('Banco conectado.\n');

        for (const ix of INDICES) {
            if (!(await existeTabela(ix.tabela))) {
                console.log(`- ${ix.nome}: tabela ${ix.tabela} nao existe, pulando.`);
                continue;
            }
            if (await existeIndice(ix.nome)) {
                console.log(`- ${ix.nome}: ja existia.`);
                continue;
            }
            await sequelize.query(ix.ddl);
            console.log(`+ ${ix.nome} criado (${ix.porque})`);
        }

        /* ------------------------------------------ CPF normalizado ------- */

        console.log('');
        if (!(await existeColuna('Clients', 'cpf_digits'))) {
            await sequelize.query(
                'ALTER TABLE Clients ADD cpf_digits AS' +
                " (REPLACE(REPLACE(REPLACE(ISNULL(cpf,''),'.',''),'-',''),' ','')) PERSISTED"
            );
            console.log('+ Clients.cpf_digits (coluna computada persistida) criada');
        } else {
            console.log('- Clients.cpf_digits: ja existia.');
        }

        if (!(await existeIndice('IX_Clients_cpf_digits'))) {
            await sequelize.query('CREATE INDEX IX_Clients_cpf_digits ON Clients (cpf_digits)');
            console.log('+ IX_Clients_cpf_digits criado (login por CPF deixa de varrer a tabela)');
        } else {
            console.log('- IX_Clients_cpf_digits: ja existia.');
        }

        /* ------------------------------------------ conferencia ----------- */

        console.log('\nIndices agora em Connections:');
        const [ixs] = await sequelize.query(
            "SELECT i.name, i.type_desc FROM sys.indexes i" +
            " WHERE i.object_id = OBJECT_ID('Connections') AND i.name IS NOT NULL"
        );
        for (const r of ixs) console.log('  ' + r.name + ' (' + r.type_desc + ')');

        console.log('\nO login so passa a usar o indice depois que appAuthController');
        console.log('consultar cpf_digits diretamente — ver acharPorCpf.');
    } catch (error) {
        console.error('Falha:', error.message);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
}

up();
