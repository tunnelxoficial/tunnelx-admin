const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { sequelize } = require('../config/db');

/**
 * Transforma `status_queue` numa fila de verdade.
 *
 * Ela tinha dois estados, `WAIT` e `CREATED`, e nada mais. Sem estado
 * intermediário não existe reivindicação: duas instâncias do provisionador — ou
 * a mesma reiniciando no meio de um lote — leem a mesma linha e provisionam o
 * mesmo cliente duas vezes, gerando dois peers e consumindo dois IPs do pool
 * para uma venda só.
 *
 * Com estas colunas o ciclo passa a ser:
 *
 *   WAIT → PROCESSING → CREATED          (caminho normal)
 *   WAIT → PROCESSING → WAIT             (falha transitória, tenta de novo)
 *   WAIT → PROCESSING → FAILED           (5 tentativas, para de girar)
 *
 * O `FAILED` importa tanto quanto o resto: um erro permanente — pool de IPs
 * esgotado, nome inválido — reprocessado a cada 60 segundos consome o
 * provisionador inteiro e esconde as linhas boas atrás dele.
 *
 * Rodar uma vez:  node scripts/add_queue_columns.js
 */

const COLUNAS = [
    ['queue_claimed_at', 'DATETIMEOFFSET NULL'],
    ['queue_attempts', 'INT NOT NULL CONSTRAINT DF_Connections_queue_attempts DEFAULT 0']
];

/** Linhas presas em PROCESSING há mais que isto voltam para a fila. */
const MINUTOS_ATE_DESTRAVAR = 15;

async function up() {
    try {
        await sequelize.authenticate();
        console.log('Banco conectado.');

        for (const [nome, ddl] of COLUNAS) {
            const [existe] = await sequelize.query(
                "SELECT COUNT(*) AS total FROM sys.columns" +
                " WHERE object_id = OBJECT_ID('Connections') AND name = :nome",
                { replacements: { nome } }
            );
            if (existe[0]?.total) {
                console.log(`- ${nome}: ja existia.`);
                continue;
            }
            await sequelize.query(`ALTER TABLE Connections ADD [${nome}] ${ddl}`);
            console.log(`+ ${nome} adicionada.`);
        }

        /*
         * Amplia a CHECK constraint do status_queue.
         *
         * O Sequelize implementa ENUM no MSSQL como CHECK, e a existente so
         * aceitava WAIT e CREATED. Sem ampliar, o claim atomico do provisionador
         * — que grava PROCESSING — seria REJEITADO pelo banco em producao, e a
         * fila pararia inteira.
         *
         * O nome da constraint e gerado pelo SQL Server (CK__Connectio__statu__...),
         * entao e preciso descobri-lo em vez de assumir.
         */
        const [checks] = await sequelize.query(
            "SELECT name FROM sys.check_constraints" +
            " WHERE parent_object_id = OBJECT_ID('Connections')" +
            " AND definition LIKE '%status_queue%'"
        );

        for (const c of checks) {
            await sequelize.query(`ALTER TABLE Connections DROP CONSTRAINT [${c.name}]`);
            console.log(`- constraint ${c.name} removida (aceitava so WAIT e CREATED)`);
        }

        await sequelize.query(
            "ALTER TABLE Connections ADD CONSTRAINT CK_Connections_status_queue" +
            " CHECK (status_queue IN ('WAIT', 'PROCESSING', 'CREATED', 'FAILED'))"
        );
        console.log('+ CK_Connections_status_queue: WAIT, PROCESSING, CREATED, FAILED');

        /*
         * Destrava o que ficou preso.
         *
         * Se o provisionador morrer entre o claim e a conclusao, a linha fica em
         * PROCESSING para sempre — ninguem mais a pega, porque o claim so
         * procura WAIT. Rodar isto no boot do provisionador (ou aqui, na
         * migracao) devolve as orfas.
         */
        const [presas] = await sequelize.query(
            `UPDATE Connections
                SET status_queue = 'WAIT'
              WHERE status_queue = 'PROCESSING'
                AND (queue_claimed_at IS NULL
                     OR queue_claimed_at < DATEADD(minute, -${MINUTOS_ATE_DESTRAVAR}, SYSDATETIMEOFFSET()));
             SELECT @@ROWCOUNT AS total;`
        );
        console.log(`Linhas presas em PROCESSING devolvidas: ${presas[0]?.total ?? 0}`);

        const [estados] = await sequelize.query(
            'SELECT status_queue, COUNT(*) AS total FROM Connections GROUP BY status_queue'
        );
        console.table(estados);
    } catch (error) {
        console.error('Falha:', error.message);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
}

up();
