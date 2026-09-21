const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const { sequelize } = require('../config/db');
const User = require('../models/Users');

/**
 * Cria um operador do painel pela linha de comando.
 *
 * `POST /auth/register` era público. Não devolvia token, o que a fazia parecer
 * inofensiva — mas criava a linha em Users, e `/auth/login` entrega a quem tem
 * essa linha um token `kind: "admin"`. Qualquer pessoa se cadastrava e entrava
 * no painel inteiro, o que anularia todo o portão montado em index.js.
 *
 * Agora aquela rota exige já ser operador. Este script é o outro caminho: o que
 * exige acesso ao servidor, não à internet. É por aqui que nasce o primeiro
 * operador de uma instalação nova.
 *
 *   node scripts/create_admin.js <email> <senha> [nome]
 */

async function main() {
    const [, , email, senha, nome] = process.argv;

    if (!email || !senha) {
        console.error('Uso: node scripts/create_admin.js <email> <senha> [nome]');
        process.exitCode = 1;
        return;
    }

    if (senha.length < 10) {
        console.error('A senha precisa ter ao menos 10 caracteres.');
        process.exitCode = 1;
        return;
    }

    try {
        await sequelize.authenticate();

        const existente = await User.findOne({ where: { email } });
        if (existente) {
            console.error(`Ja existe um operador com o e-mail ${email} (id ${existente.id}).`);
            process.exitCode = 1;
            return;
        }

        const user = await User.create({
            username: nome || email.split('@')[0],
            email,
            password: await bcrypt.hash(senha, 10)
        });

        console.log(`Operador criado: id ${user.id}, e-mail ${user.email}`);

        const total = await User.count();
        console.log(`Total de operadores no painel: ${total}`);
    } catch (error) {
        console.error('Falha ao criar o operador:', error.message);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
}

main();
