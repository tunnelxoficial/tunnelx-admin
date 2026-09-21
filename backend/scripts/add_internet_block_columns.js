const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { sequelize } = require('../config/db');

/**
 * Da MOTIVO ao bloqueio de internet.
 *
 * A coluna `internet` ja existia e ja era escrita pelo botao do painel, mas era
 * cega: dizia "cortado" sem dizer por quem. Isso basta enquanto so existe corte
 * manual; deixa de bastar no instante em que o sistema passa a cortar
 * inadimplente sozinho, porque as duas decisoes se atropelam.
 *
 * O caso concreto: o operador corta um cliente de proposito (fraude, acordo
 * desfeito). No dia seguinte uma cobranca antiga e confirmada no Asaas. Sem
 * motivo gravado, a liberacao automatica nao tem como saber que aquele corte
 * nao foi dela, e devolve a internet a quem o operador tinha cortado.
 *
 * Com o motivo, a regra fica explicita e verificavel:
 *   - corte 'overdue'  -> o pagamento libera sozinho
 *   - corte 'operator' -> so a mao do operador desfaz
 *
 * `internet_blocked_at` existe para auditoria: sem ela nao ha como responder
 * "desde quando esse cliente esta sem internet?", que e a primeira pergunta de
 * todo atendimento.
 *
 * Idempotente. Rodar uma vez:  node scripts/add_internet_block_columns.js
 */

const COLUNAS = [
    ['internet_block_reason', 'NVARCHAR(20) NULL'],
    ['internet_blocked_at', 'DATETIMEOFFSET NULL']
];

async function up() {
    try {
        await sequelize.authenticate();
        console.log('Banco conectado.');

        for (const [nome, ddl] of COLUNAS) {
            const [existe] = await sequelize.query(
                'SELECT COUNT(*) AS total FROM sys.columns' +
                " WHERE object_id = OBJECT_ID('Connections') AND name = :nome",
                { replacements: { nome } }
            );

            if (existe[0] && existe[0].total) {
                console.log(`- ${nome}: ja existia.`);
                continue;
            }

            await sequelize.query(`ALTER TABLE Connections ADD [${nome}] ${ddl}`);
            console.log(`+ ${nome} adicionada.`);
        }

        /*
         * O `internet = 0` herdado NAO vale como corte — e o passo mais perigoso
         * desta migracao.
         *
         * Ate agora o botao "bloquear internet" do painel so invertia esse
         * booleano: nenhum processo lia o campo, e nenhuma dessas conexoes chegou
         * a perder o acesso. Ou seja, todo cliente com internet = 0 no banco esta
         * navegando NESTE MOMENTO, possivelmente ha meses.
         *
         * A partir de agora o campo manda de verdade: o provisionador reconcilia
         * o tunel com ele. Manter esses zeros seria cortar, de uma vez, todo
         * cliente cujo botao alguem ja apertou por engano — um apagao em massa no
         * minuto em que o provisionador novo subir, e justamente com clientes
         * pagantes.
         *
         * Por isso o padrao e igualar o banco a REALIDADE (eles tem internet) e
         * listar quem era, para o operador cortar de novo com intencao. Quem
         * quiser honrar os cortes antigos roda com --manter-cortes.
         */
        const manterCortes = process.argv.includes('--manter-cortes');

        const [herdados] = await sequelize.query(
            `SELECT id, name, payment_status FROM Connections WHERE internet = 0`
        );

        if (herdados.length === 0) {
            console.log('Nenhuma conexao com internet = 0 herdado.');
        } else if (manterCortes) {
            await sequelize.query(
                `UPDATE Connections
                    SET internet_block_reason = 'operator',
                        internet_blocked_at = SYSDATETIMEOFFSET()
                  WHERE internet = 0
                    AND internet_block_reason IS NULL`
            );
            console.log('');
            console.log(`ATENCAO: ${herdados.length} conexao(oes) marcadas como CORTADAS pelo operador.`);
            console.log('Elas perderao o acesso no primeiro ciclo do provisionador:');
            console.table(herdados);
        } else {
            await sequelize.query(
                `UPDATE Connections
                    SET internet = 1,
                        internet_block_reason = NULL,
                        internet_blocked_at = NULL
                  WHERE internet = 0
                    AND internet_block_reason IS NULL`
            );
            console.log('');
            console.log(`${herdados.length} conexao(oes) tinham internet = 0 herdado de um botao que`);
            console.log('nunca cortou ninguem. Foram igualadas a realidade (acesso liberado),');
            console.log('para o provisionador novo nao derrubar todas de uma vez.');
            console.log('');
            console.log('Confira a lista e corte no painel as que realmente devem ficar sem acesso:');
            console.table(herdados);
            console.log('(Para honrar os cortes antigos em vez disso: node scripts/add_internet_block_columns.js --manter-cortes)');
        }

        const [situacao] = await sequelize.query(
            `SELECT internet,
                    ISNULL(internet_block_reason, '(sem motivo)') AS motivo,
                    COUNT(*) AS total
               FROM Connections
              GROUP BY internet, internet_block_reason`
        );
        console.table(situacao);
    } catch (error) {
        console.error('Falha:', error.message);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
}

up();
