const jwt = require('jsonwebtoken');
const Client = require('../models/Client');
const { sequelize } = require('../config/db');
const { hashPassword, onlyDigits, isValidCpf } = require('../utils/password');
const { SECRET_KEY } = require('../middleware/auth');
const { novaSessao, normalizarDispositivo } = require('../utils/deviceSession');

/**
 * Auto-cadastro do cliente pelo aplicativo.
 *
 * Antes, todo cliente nascia no painel: o operador cadastrava, gerava a senha e
 * entregava. Isso funciona no balcao e trava a venda pelo app — ninguem baixa um
 * aplicativo para depois ligar pedindo cadastro.
 *
 * Aqui o cliente se cadastra, define a PROPRIA senha e segue para escolher o
 * plano. A conta nasce sem assinatura: existir nao da acesso a nada. O portao
 * continua sendo o pagamento (ver middleware/auth.js#requireActiveSubscription),
 * entao uma conta criada e abandonada e so uma linha na tabela.
 *
 * A senha nasce `password_is_provisional: false` — ela foi escolhida pelo dono,
 * nao ditada por um operador, e por isso nao precisa ser trocada no primeiro uso.
 */

const EXPIRACAO = '10y'; // ver a nota em appAuthController
const SENHA_MINIMA = 6;

/** Mesma checagem do painel: CPF e chave de login, repetido seria login ambiguo. */
async function cpfEmUso(cpf) {
    const digitos = onlyDigits(cpf);
    if (!digitos) return null;

    // Mesma coluna indexada do login — ver a nota em appAuthController.
    let linhas;
    try {
        [linhas] = await sequelize.query(
            'SELECT TOP 1 id, name FROM Clients WHERE cpf_digits = :digitos',
            { replacements: { digitos } }
        );
    } catch {
        // Migracao de indices ainda nao rodada neste banco.
        [linhas] = await sequelize.query(
            "SELECT TOP 1 id, name FROM Clients" +
            " WHERE REPLACE(REPLACE(REPLACE(cpf, '.', ''), '-', ''), ' ', '') = :digitos",
            { replacements: { digitos } }
        );
    }
    return linhas[0] || null;
}

function emailValido(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
}

exports.register = async (req, res) => {
    try {
        const {
            name, cpf, email, whatsapp, password, device_name,
            cep, uf, cidade, bairro, logradouro, complemento
        } = req.body || {};

        // ---- validacao ------------------------------------------------------
        if (!name || String(name).trim().length < 3) {
            return res.status(400).json({ message: 'Informe seu nome completo.' });
        }
        if (!isValidCpf(cpf)) {
            return res.status(400).json({ message: 'CPF invalido. Confira os numeros.' });
        }
        if (!emailValido(email)) {
            return res.status(400).json({ message: 'E-mail invalido.' });
        }
        if (onlyDigits(whatsapp).length < 10) {
            return res.status(400).json({ message: 'Informe um WhatsApp valido com DDD.' });
        }
        if (!password || String(password).length < SENHA_MINIMA) {
            return res.status(400).json({ message: `A senha precisa ter ao menos ${SENHA_MINIMA} caracteres.` });
        }

        // CPF ja cadastrado: pode ser o proprio cliente tentando se cadastrar de
        // novo em vez de entrar. A mensagem aponta o caminho certo em vez de so
        // recusar — e NAO confirma o nome de quem tem o CPF, que seria entregar
        // dado de terceiro a quem digitou um CPF qualquer.
        const dono = await cpfEmUso(cpf);
        if (dono) {
            return res.status(409).json({
                code: 'CPF_JA_CADASTRADO',
                message: 'Este CPF ja tem conta. Entre com sua senha ou fale com o suporte.'
            });
        }

        // ---- criacao --------------------------------------------------------
        const client = await Client.create({
            name: String(name).trim(),
            cpf: String(cpf).trim(),
            email: String(email).trim().toLowerCase(),
            whatsapp: String(whatsapp).trim(),
            cep: cep || null,
            uf: uf || null,
            cidade: cidade || null,
            bairro: bairro || null,
            logradouro: logradouro || null,
            complemento: complemento || null,
            password_hash: await hashPassword(String(password)),
            password_is_provisional: false,
            // Conta nasce ja aberta neste aparelho — quem cadastrou esta aqui.
            active_session_id: novaSessao(),
            active_device: normalizarDispositivo(device_name),
            session_started_at: new Date()
        });

        // Token pleno: a senha e do dono desde o primeiro segundo, entao nao ha
        // troca obrigatoria pela frente.
        const token = jwt.sign(
            { id: client.id, cpf: onlyDigits(client.cpf), kind: 'client', sid: client.active_session_id },
            SECRET_KEY,
            { expiresIn: EXPIRACAO }
        );

        res.status(201).json({
            token,
            session_id: client.active_session_id,
            must_change_password: false,
            client: {
                id: client.id,
                name: client.name,
                cpf: client.cpf,
                email: client.email,
                whatsapp: client.whatsapp,
                cidade: client.cidade,
                uf: client.uf
            }
        });
    } catch (error) {
        console.error('[app/register]', error);
        res.status(500).json({ message: 'Nao foi possivel criar sua conta. Tente de novo.' });
    }
};

/**
 * Diz se um CPF ja tem conta, para a tela avisar ENQUANTO se digita.
 *
 * Responde so um booleano: nunca o nome nem qualquer dado de quem ja existe.
 * Descobrir "este CPF e cliente da TunnelX" ja e alguma informacao, mas e a
 * mesma que o cadastro devolveria ao ser enviado — e evita o usuario preencher
 * o formulario inteiro para ser recusado no fim.
 */
exports.checkCpf = async (req, res) => {
    try {
        const cpf = req.query.cpf;
        if (!isValidCpf(cpf)) {
            return res.json({ valid: false, taken: false });
        }
        const dono = await cpfEmUso(cpf);
        res.json({ valid: true, taken: !!dono });
    } catch (error) {
        console.error('[app/checkCpf]', error);
        res.status(500).json({ message: 'Erro ao verificar o CPF.' });
    }
};

module.exports = exports;
