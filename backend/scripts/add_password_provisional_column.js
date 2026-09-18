const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { sequelize } = require('../config/db');

/**
 * Coluna Clients.password_is_provisional - marca do primeiro acesso.
 *
 * Existe como script porque DB_SYNC vem desligado por padrao (ver config/db.js):
 * o schema de producao nao muda sozinho a cada boot.
 *
 * O backfill e a parte que importa. Todo cliente que HOJE tem senha a recebeu do
 * operador - a tela de troca no app nasce junto com esta coluna, entao ninguem
 * ainda escolheu a propria senha. Deixar o default `false` valendo para a base
 * existente dispensaria justamente quem mais precisa trocar, inclusive os
 * cadastros antigos que ficaram com '123456' (ver docs/ACESSO-APP.md).
 *
 * Rodar uma vez:  node scripts/add_password_provisional_column.js
 * Reexecutar e inofensivo: a criacao e ignorada se a coluna ja existir e o
 * backfill so alcanca linhas ainda nao marcadas.
 */
async function up() {
    const queryInterface = sequelize.getQueryInterface();

    try {
        const colunas = await queryInterface.describeTable('Clients');

        if (colunas.password_is_provisional) {
            console.log('Coluna password_is_provisional ja existe - pulando a criacao.');
        } else {
            await queryInterface.addColumn('Clients', 'password_is_provisional', {
                type: sequelize.Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false
            });
            console.log('Coluna password_is_provisional criada.');
        }

        // Quem ja tem senha nunca passou pela troca: a tela nao existia.
        const [, meta] = await sequelize.query(
            'UPDATE Clients SET password_is_provisional = 1' +
            ' WHERE password_hash IS NOT NULL AND password_is_provisional = 0'
        );
        console.log('Clientes marcados para trocar a senha no primeiro acesso:', meta ?? 0);

        console.log('\nEsses clientes vao precisar definir uma nova senha ao entrar no app.');
        console.log('Quem nao lembrar a senha atual: gere outra pelo painel (Clientes > Gerar senha).');
    } catch (error) {
        console.error('Erro ao aplicar a migracao:', error.message);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
}

up();
