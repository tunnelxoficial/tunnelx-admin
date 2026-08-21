const Client = require('../models/Client');
const Connection = require('../models/Connection');
const { sequelize } = require('../config/db');
const { generatePassword, hashPassword, onlyDigits, isValidCpf } = require('../utils/password');

const CAMPOS = ['name', 'cpf', 'email', 'whatsapp', 'cep', 'uf', 'cidade', 'bairro', 'logradouro', 'complemento'];

function pick(body) {
    return CAMPOS.reduce((acc, campo) => {
        if (body[campo] !== undefined) acc[campo] = body[campo];
        return acc;
    }, {});
}

/**
 * CPF e a chave de login do aplicativo, entao repetido significa login ambiguo.
 *
 * A comparacao ignora pontuacao porque a base tem os dois formatos: o painel
 * envia com mascara ('064.767.391-66') e o app envia so digitos.
 */
async function cpfEmUso(cpf, ignorarId) {
    const digitos = onlyDigits(cpf);
    if (!digitos) return null;

    const [linhas] = await sequelize.query(
        "SELECT TOP 1 id, name FROM Clients" +
        " WHERE REPLACE(REPLACE(REPLACE(cpf, '.', ''), '-', ''), ' ', '') = :digitos" +
        " AND id <> :ignorarId",
        { replacements: { digitos, ignorarId: ignorarId || 0 } }
    );
    return linhas[0] || null;
}

exports.getAll = async (req, res) => {
    try {
        // withPassword traz o hash so para responder "este cliente ja tem acesso?".
        // O hash em si nunca sai daqui.
        const clients = await Client.scope('withPassword').findAll({ order: [['id', 'DESC']] });

        res.json(clients.map((c) => {
            const { password_hash, ...resto } = c.toJSON();
            return { ...resto, has_app_access: !!password_hash };
        }));
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar clientes.' });
    }
};

exports.create = async (req, res) => {
    try {
        const dados = pick(req.body);

        if (dados.cpf) {
            if (!isValidCpf(dados.cpf)) {
                return res.status(400).json({ message: 'CPF invalido.' });
            }
            const dono = await cpfEmUso(dados.cpf, null);
            if (dono) {
                return res.status(409).json({ message: 'Este CPF ja pertence ao cliente "' + dono.name + '".' });
            }
        }

        // A senha em claro existe uma unica vez: nesta resposta. O banco guarda hash.
        let senhaEmClaro = null;
        if (req.body.generatePassword) {
            if (!dados.cpf) {
                return res.status(400).json({ message: 'Informe o CPF: e com ele que o cliente entra no aplicativo.' });
            }
            senhaEmClaro = generatePassword();
            dados.password_hash = await hashPassword(senhaEmClaro);
        }

        const novo = await Client.create(dados);
        const { password_hash, ...cliente } = novo.toJSON();

        res.status(201).json({ ...cliente, has_app_access: !!password_hash, generated_password: senhaEmClaro });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar cliente.', detail: error.message });
    }
};

exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const client = await Client.scope('withPassword').findByPk(id);
        if (!client) return res.status(404).json({ message: 'Cliente nao encontrado.' });

        const dados = pick(req.body);

        if (dados.cpf) {
            if (!isValidCpf(dados.cpf)) {
                return res.status(400).json({ message: 'CPF invalido.' });
            }
            const dono = await cpfEmUso(dados.cpf, client.id);
            if (dono) {
                return res.status(409).json({ message: 'Este CPF ja pertence ao cliente "' + dono.name + '".' });
            }
        }

        let senhaEmClaro = null;
        if (req.body.generatePassword) {
            const cpfFinal = dados.cpf || client.cpf;
            if (!cpfFinal) {
                return res.status(400).json({ message: 'Informe o CPF: e com ele que o cliente entra no aplicativo.' });
            }
            senhaEmClaro = generatePassword();
            dados.password_hash = await hashPassword(senhaEmClaro);
        }

        await client.update(dados);
        const { password_hash, ...cliente } = client.toJSON();

        res.json({ ...cliente, has_app_access: !!password_hash, generated_password: senhaEmClaro });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao atualizar cliente.', detail: error.message });
    }
};

/**
 * Gera (ou regera) a senha de aplicativo do cliente.
 *
 * Endpoint separado do update de proposito: trocar senha nao pode ser efeito
 * colateral de corrigir um endereco, e assim o painel pede a senha sem reenviar
 * o cadastro inteiro. A senha em claro so trafega nesta resposta - depois disso
 * existe apenas o hash, e a unica saida e gerar outra.
 */
exports.setPassword = async (req, res) => {
    try {
        const { id } = req.params;
        const client = await Client.scope('withPassword').findByPk(id);
        if (!client) return res.status(404).json({ message: 'Cliente nao encontrado.' });

        if (!client.cpf) {
            return res.status(400).json({ message: 'Cadastre o CPF antes: e com ele que o cliente entra no aplicativo.' });
        }

        const senhaEmClaro = generatePassword();
        await client.update({ password_hash: await hashPassword(senhaEmClaro) });

        res.json({
            id: client.id,
            name: client.name,
            cpf: client.cpf,
            password: senhaEmClaro,
            has_app_access: true,
            message: 'Anote agora: esta senha nao pode ser consultada depois.'
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao gerar a senha.', detail: error.message });
    }
};

/** Revoga o acesso ao aplicativo sem apagar o cadastro nem as conexoes. */
exports.revokePassword = async (req, res) => {
    try {
        const { id } = req.params;
        const client = await Client.scope('withPassword').findByPk(id);
        if (!client) return res.status(404).json({ message: 'Cliente nao encontrado.' });

        await client.update({ password_hash: null });
        res.json({ id: client.id, has_app_access: false, message: 'Acesso ao aplicativo revogado.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao revogar o acesso.' });
    }
};

exports.delete = async (req, res) => {
    try {
        const { id } = req.params;
        const client = await Client.findByPk(id);
        if (!client) return res.status(404).json({ message: 'Cliente nao encontrado.' });

        // Apagar o cliente deixaria conexoes orfas apontando para um ClientId
        // inexistente - e elas continuariam no ar, sem dono e sem cobranca.
        const conexoes = await Connection.count({ where: { ClientId: id } });
        if (conexoes > 0) {
            return res.status(409).json({
                message: 'Este cliente tem ' + conexoes + ' conexao(oes). Remova as conexoes antes de excluir o cadastro.'
            });
        }

        await client.destroy();
        res.json({ message: 'Cliente removido com sucesso.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao remover cliente.' });
    }
};
