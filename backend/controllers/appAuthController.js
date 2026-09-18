const jwt = require('jsonwebtoken');
const Client = require('../models/Client');
const Connection = require('../models/Connection');
const Plan = require('../models/Plan');
const { sequelize } = require('../config/db');
const { checkPassword, onlyDigits } = require('../utils/password');
const { SECRET_KEY } = require('../middleware/auth');

/**
 * Autenticacao do CLIENTE no aplicativo - separada do login do painel.
 *
 * O painel entra por e-mail (tabela Users, operadores da TunnelX). O cliente
 * entra por CPF (tabela Clients), porque e o dado que ele tem na mao no balcao e
 * o mesmo que ja identifica a conexao dele.
 *
 * O token nasce com `kind: 'client'`: e o que impede que um login de cliente,
 * obtido por qualquer pessoa com CPF e senha, sirva de credencial no painel.
 */

// 30 dias: o app e um cliente VPN, nao um internet banking. Exigir login toda
// semana faria o usuario desistir e deixar o tunel importado manualmente.
const EXPIRACAO = '30d';

// O token do primeiro acesso nao navega no app: ele so atravessa a tela de nova
// senha. Trinta dias para uma credencial que passou por WhatsApp seria uma
// janela aberta a toa.
const EXPIRACAO_PROVISORIA = '30m';

/**
 * Busca por CPF comparando apenas digitos.
 *
 * A coluna guarda os dois formatos: cadastros feitos pelo painel vem com a
 * mascara ('064.767.391-66'), e o app manda o que o usuario digitou. Sem
 * normalizar os dois lados, o login falha para o cliente cujo cadastro tem
 * ponto e traco - que hoje sao todos.
 */
async function acharPorCpf(cpf) {
    const digitos = onlyDigits(cpf);
    if (digitos.length !== 11) return null;

    const [linhas] = await sequelize.query(
        "SELECT TOP 1 id FROM Clients" +
        " WHERE REPLACE(REPLACE(REPLACE(cpf, '.', ''), '-', ''), ' ', '') = :digitos",
        { replacements: { digitos } }
    );
    if (!linhas[0]) return null;

    return Client.scope('withPassword').findByPk(linhas[0].id);
}

exports.login = async (req, res) => {
    try {
        const { cpf, password } = req.body || {};

        if (!cpf || !password) {
            return res.status(400).json({ message: 'Informe CPF e senha.' });
        }

        const client = await acharPorCpf(cpf);

        // Resposta unica para CPF inexistente, cliente sem acesso liberado e senha
        // errada. Distinguir os casos entregaria de graca quais CPFs sao clientes.
        const senhaConfere = client && (await checkPassword(password, client.password_hash));
        if (!senhaConfere) {
            return res.status(401).json({ message: 'CPF ou senha invalidos.' });
        }

        const provisoria = !!client.password_is_provisional;

        // Token provisorio expira rapido: ele existe para atravessar uma unica
        // tela. Trinta dias so fazem sentido depois que a senha e do cliente.
        const token = jwt.sign(
            {
                id: client.id,
                cpf: onlyDigits(client.cpf),
                kind: 'client',
                ...(provisoria ? { pwd: 'provisional' } : {})
            },
            SECRET_KEY,
            { expiresIn: provisoria ? EXPIRACAO_PROVISORIA : EXPIRACAO }
        );

        res.json({
            token,
            // O app usa isto para desviar direto a tela de nova senha. A recusa
            // de verdade nao esta aqui e sim no middleware: um app antigo que
            // ignore o campo esbarra em 403 ao pedir as conexoes.
            must_change_password: provisoria,
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
        console.error(error);
        res.status(500).json({ message: 'Erro ao realizar login.' });
    }
};

exports.me = async (req, res) => {
    try {
        const client = await Client.findByPk(req.client.id);
        if (!client) return res.status(404).json({ message: 'Cliente nao encontrado.' });
        res.json(client);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao carregar o perfil.' });
    }
};

/**
 * Conexoes do cliente autenticado, ja com o .conf pronto para importar.
 *
 * O `config` carrega a CHAVE PRIVADA do peer - por isso o escopo vem do token e
 * nunca de um parametro da requisicao. Nao existe aqui um `?clientId=`: o unico
 * cliente que esta rota enxerga e o dono do token.
 *
 * Conexoes ainda na fila (status_queue = 'WAIT') aparecem na lista sem config: o
 * app precisa mostrar "em preparacao" em vez de omitir a conexao que o cliente
 * acabou de comprar e nao encontra.
 */
exports.connections = async (req, res) => {
    try {
        const connections = await Connection.findAll({
            where: { ClientId: req.client.id },
            include: [{ model: Plan, attributes: ['name', 'dataLimit'] }],
            order: [['id', 'DESC']]
        });

        res.json(connections.map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            status_queue: c.status_queue,
            internet: c.internet,
            data_limit: c.data_limit,
            total_connections: c.total_connections,
            plan: c.Plan ? { name: c.Plan.name, dataLimit: c.Plan.dataLimit } : null,
            // pronta = worker ja gerou o par de chaves e o Endpoint atual
            ready: c.status_queue === 'CREATED' && !!c.config,
            config: c.config || null,
            qrcode_base64: c.qrcode ? Buffer.from(c.qrcode).toString('base64') : null,
            updatedAt: c.updatedAt
        })));
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao carregar as conexoes.' });
    }
};

/**
 * Troca de senha pelo proprio cliente.
 *
 * A senha entregue no balcao foi gerada pelo operador e passou por WhatsApp ou
 * papel; sem esta rota ela seria permanente e conhecida por terceiros.
 */
exports.changePassword = async (req, res) => {
    try {
        const { current_password, new_password } = req.body || {};

        if (!current_password || !new_password) {
            return res.status(400).json({ message: 'Informe a senha atual e a nova senha.' });
        }
        if (String(new_password).length < 6) {
            return res.status(400).json({ message: 'A nova senha precisa ter ao menos 6 caracteres.' });
        }

        const client = await Client.scope('withPassword').findByPk(req.client.id);
        if (!client) return res.status(404).json({ message: 'Cliente nao encontrado.' });

        // 400, e nao 401: quem chamou ESTA autenticado - o token e valido. O que
        // veio errado foi um campo do corpo. Com 401 o app trataria o erro de
        // digitacao como sessao expirada, apagaria o token e deixaria o cliente
        // preso na tela de senha sem conseguir tentar de novo.
        if (!(await checkPassword(current_password, client.password_hash))) {
            return res.status(400).json({
                code: 'WRONG_CURRENT_PASSWORD',
                message: 'Senha atual incorreta.'
            });
        }

        // Repetir a senha entregue pelo operador nao conclui o primeiro acesso:
        // a copia que circulou por WhatsApp continuaria valendo.
        if (String(new_password) === String(current_password)) {
            return res.status(400).json({ message: 'A nova senha precisa ser diferente da atual.' });
        }

        const { hashPassword } = require('../utils/password');
        await client.update({
            password_hash: await hashPassword(new_password),
            password_is_provisional: false
        });

        // Token novo e pleno: o que o app tem na mao pode ser o provisorio, que
        // o middleware recusa em todas as outras rotas. Sem devolver este aqui,
        // o cliente trocaria a senha e continuaria sem conseguir ver as conexoes.
        const token = jwt.sign(
            { id: client.id, cpf: onlyDigits(client.cpf), kind: 'client' },
            SECRET_KEY,
            { expiresIn: EXPIRACAO }
        );

        res.json({ message: 'Senha alterada com sucesso.', token });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao alterar a senha.' });
    }
};
