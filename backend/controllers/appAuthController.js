const jwt = require('jsonwebtoken');
const Client = require('../models/Client');
const Connection = require('../models/Connection');
const Plan = require('../models/Plan');
const { sequelize } = require('../config/db');
const { checkPassword, onlyDigits } = require('../utils/password');
const { SECRET_KEY } = require('../middleware/auth');
const {
    novaSessao, normalizarDispositivo, podeEntrar
} = require('../utils/deviceSession');

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

/*
 * Dez anos. Na pratica, sessao que nao expira.
 *
 * A troca e consciente: ninguem precisa refazer login, e some a friccao de
 * sessao vencida no meio do uso. O custo e que um token vazado (aparelho
 * perdido, backup do celular, log de proxy) vale por uma decada, e nao existe
 * revogacao — o JWT e auto-contido, nao ha lista de tokens invalidados.
 *
 * O que ainda protege: /app/connections verifica a assinatura a CADA chamada
 * (requireActiveSubscription). Entao um token roubado nao rende acesso se a
 * assinatura for cancelada ou ficar em atraso. Para cortar um cliente na hora:
 * revogar a senha pelo painel e cancelar a assinatura. Para cortar TODO mundo:
 * trocar o JWT_SECRET.
 */
const EXPIRACAO = '10y';

// A do primeiro acesso continua curta, e de proposito: ela nao navega no app,
// so atravessa a tela de nova senha. Dez anos para uma credencial que passou
// por WhatsApp seria uma janela aberta a toa.
const EXPIRACAO_PROVISORIA = '30m';

/**
 * Busca por CPF comparando apenas digitos.
 *
 * A coluna `cpf` guarda os dois formatos: cadastros do painel vem com mascara
 * (064.767.391-66) e o app manda o que o usuario digitou. Comparar direto
 * falharia para quem tem ponto e traco — que hoje sao todos.
 *
 * A comparacao usa `cpf_digits`, uma coluna computada PERSISTIDA com
 * exatamente a mesma expressao (ver scripts/add_indexes.js), e indexada.
 *
 * Antes o REPLACE ficava no WHERE, o que torna a consulta nao-sargavel: o
 * SQL Server precisa calcular a funcao linha a linha antes de comparar, entao
 * cada tentativa de login varria a tabela Clients inteira. Numa rota publica,
 * sem autenticacao e antes do rate limit existir, isso era tambem o jeito mais
 * barato de derrubar o banco de fora.
 *
 * Se a coluna ainda nao existir (migracao nao rodada), cai no caminho antigo:
 * lento, mas correto — melhor que a API recusar todo login.
 */
let temCpfDigits = null; // null = ainda nao verificado

async function colunaCpfDigitsExiste() {
    if (temCpfDigits !== null) return temCpfDigits;
    try {
        const [r] = await sequelize.query(
            "SELECT COUNT(*) AS total FROM sys.columns" +
            " WHERE object_id = OBJECT_ID('Clients') AND name = 'cpf_digits'"
        );
        temCpfDigits = (r[0]?.total || 0) > 0;
    } catch {
        temCpfDigits = false;
    }
    return temCpfDigits;
}

async function acharPorCpf(cpf) {
    const digitos = onlyDigits(cpf);
    if (digitos.length !== 11) return null;

    const sql = (await colunaCpfDigitsExiste())
        ? 'SELECT TOP 1 id FROM Clients WHERE cpf_digits = :digitos'
        : "SELECT TOP 1 id FROM Clients" +
          " WHERE REPLACE(REPLACE(REPLACE(cpf, '.', ''), '-', ''), ' ', '') = :digitos";

    const [linhas] = await sequelize.query(sql, { replacements: { digitos } });
    if (!linhas[0]) return null;

    return Client.scope('withPassword').findByPk(linhas[0].id);
}

/**
 * Abre uma sessao e devolve o token que a representa.
 *
 * Grava o `sid` no cliente ANTES de assinar o token: se a ordem fosse inversa e
 * a escrita falhasse, o aparelho sairia daqui com um token que nenhuma
 * requisicao aceitaria.
 */
async function abrirSessao(client, dispositivo, extra = {}) {
    const sid = novaSessao();

    await client.update({
        active_session_id: sid,
        active_device: normalizarDispositivo(dispositivo),
        session_started_at: new Date()
    });

    return jwt.sign(
        { id: client.id, cpf: onlyDigits(client.cpf), kind: 'client', sid, ...extra },
        SECRET_KEY,
        { expiresIn: extra.pwd === 'provisional' ? EXPIRACAO_PROVISORIA : EXPIRACAO }
    );
}

exports.login = async (req, res) => {
    try {
        const { cpf, password, device_name, force, current_session } = req.body || {};

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

        /*
         * Uma conta, um aparelho.
         *
         * A recusa vem DEPOIS da conferencia da senha, de proposito: responder
         * "esta conta esta em uso" a quem errou a senha contaria a um estranho
         * que o CPF e cliente e que alguem esta logado agora.
         *
         * Nao derruba o outro aparelho sozinho. Quem esta entrando ve onde a
         * conta esta aberta e decide — `force` e essa decisao voltando. Derrubar
         * em silencio faria dois telefones se expulsarem em looping, e nenhum dos
         * donos entenderia por que.
         */
        const veredito = podeEntrar(client, !!force, current_session || null);
        if (!veredito.ok) {
            return res.status(409).json({
                code: veredito.code,
                device: veredito.device,
                since: veredito.since,
                message: 'Sua conta esta aberta em ' + veredito.device +
                    '. Para entrar aqui, o outro aparelho sera desconectado.'
            });
        }

        const provisoria = !!client.password_is_provisional;

        // Token provisorio expira rapido: ele existe para atravessar uma unica
        // tela. Dez anos so fazem sentido depois que a senha e do cliente.
        const token = await abrirSessao(
            client,
            device_name,
            provisoria ? { pwd: 'provisional' } : {}
        );

        res.json({
            token,
            // O aparelho guarda isto para, num login futuro, poder dizer "a
            // sessao ativa sou eu" e nao ser tratado como invasor de si mesmo.
            session_id: client.active_session_id,
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
 * Duas origens, uma lista: os tuneis DELE e os que outra pessoa compartilhou com
 * ele. O segundo caso e o acesso provisionado — familia dividindo o mesmo tunel
 * dentro do limite do plano do titular.
 *
 * Conexoes ainda na fila (status_queue = 'WAIT') aparecem na lista sem config: o
 * app precisa mostrar "em preparacao" em vez de omitir a conexao que o cliente
 * acabou de comprar e nao encontra.
 */
/**
 * Resumo do estado das conexoes — barato o bastante para ser consultado sempre.
 *
 * Mesmo escopo e mesmo portao de /app/connections, mas sem `config` nem o QR:
 * a resposta e de algumas centenas de bytes contra dezenas de KB. O app usa isto
 * para perceber SOZINHO que algo mudou — em especial que o titular removeu o
 * convidado — sem ficar baixando a configuracao inteira de minuto em minuto na
 * rede movel do cliente.
 *
 * O `revision` resume tudo que obriga o app a reagir: quais tuneis existem, se
 * ja foram provisionados e ate quando cada acesso emprestado vale. Se ele nao
 * mudou, nao ha o que fazer.
 *
 * Um 402 aqui NAO e erro: e a resposta certa quando o acesso acabou. O app trata
 * isso removendo os tuneis da conta e derrubando a VPN.
 */
/**
 * Convites válidos deste cliente, reaproveitando o que o portão já buscou.
 *
 * `requireActiveSubscription` roda antes de toda rota daqui e já consultou os
 * convites para decidir se a requisição passa. Buscá-los de novo custava 2
 * UPDATEs + 1 SELECT por requisição, num endpoint que cada aparelho consulta a
 * cada 30 segundos — e o resultado era idêntico, milissegundos depois.
 *
 * `shares: null` significa "o portão não olhou" (o cliente passou pela própria
 * assinatura), e aí sim vale consultar: ele pode ser titular E convidado.
 */
async function convitesDoCliente(req) {
    const { sharesDoConvidado } = require('../services/shareService');
    const cache = req.__acesso && req.__acesso.resultado;

    if (cache && Array.isArray(cache.shares)) return cache.shares;
    return sharesDoConvidado(req.client.id);
}
exports.connectionsState = async (req, res) => {
    try {
        const crypto = require('crypto');
        const { deviceDoCliente, devicePronto } = require('../services/deviceService');

        const proprias = await Connection.findAll({
            where: { ClientId: req.client.id },
            attributes: ['id', 'status', 'status_queue', 'updatedAt'],
            order: [['id', 'DESC']]
        });

        /*
         * `ready` olha o APARELHO, nao a Connection.
         *
         * O app usa este campo para decidir se ja pode baixar a configuracao. A
         * Connection pode estar CREATED ha meses enquanto o peer deste aparelho
         * acabou de entrar na fila; dizer "pronto" nesse momento faria o app
         * buscar um .conf que ainda nao existe.
         *
         * `garantirDevice` NAO e chamado aqui de proposito: esta rota e o polling
         * de 30 segundos de cada aparelho, e criar linha em rota de leitura tao
         * quente e pedir escrita desnecessaria no banco. Quem cria e
         * /app/connections, que o app chama logo em seguida.
         */
        const itens = [];

        for (const c of proprias) {
            const device = await deviceDoCliente(c.id, req.client.id);
            itens.push({
                id: c.id,
                shared: false,
                ready: devicePronto(device),
                status: c.status,
                updatedAt: c.updatedAt,
                expires_at: null
            });
        }

        for (const share of await convitesDoCliente(req)) {
            const c = await Connection.findByPk(share.ConnectionId, {
                attributes: ['id', 'status', 'status_queue', 'updatedAt']
            });
            if (!c) continue;
            const device = await deviceDoCliente(c.id, req.client.id);
            itens.push({
                id: c.id,
                shared: true,
                ready: devicePronto(device),
                status: c.status,
                updatedAt: c.updatedAt,
                expires_at: share.expires_at
            });
        }

        const assinatura = itens
            .map((i) => [i.id, i.shared ? 1 : 0, i.ready ? 1 : 0, i.status,
                new Date(i.updatedAt).getTime(),
                i.expires_at ? new Date(i.expires_at).getTime() : 0].join(':'))
            .join('|');

        res.json({
            revision: crypto.createHash('sha1').update(assinatura).digest('hex').slice(0, 16),
            items: itens
        });
    } catch (error) {
        console.error('[app/connections/state]', error);
        res.status(500).json({ message: 'Erro ao consultar o estado das conexoes.' });
    }
};

exports.connections = async (req, res) => {
    try {
        const { descreverPrazo } = require('../utils/shareRules');
        const { garantirDevice, contarVagas, devicePronto } = require('../services/deviceService');

        /**
         * Um tunel do jeito que o app desenha o card.
         *
         * O `config` entregue e o DO APARELHO deste cliente, nunca mais o da
         * Connection. Era o mesmo arquivo para as N pessoas do plano, e o
         * WireGuard guarda um unico endpoint por peer: os aparelhos se
         * derrubavam em rodizio. Ver models/ConnectionDevice.js.
         *
         * Aparelho ainda na fila devolve `ready: false`, e o app mostra "em
         * preparacao" — o mesmo tratamento que ja existia para a conexao
         * recem-comprada.
         */
        const serializar = (c, device, extra = {}) => {
            const pronto = devicePronto(device);
            return {
                id: c.id,
                name: c.name,
                status: c.status,
                status_queue: pronto ? 'CREATED' : (device ? device.status_queue : c.status_queue),
                internet: c.internet,
                data_limit: c.data_limit,
                total_connections: c.total_connections,
                plan: c.Plan ? { name: c.Plan.name, dataLimit: c.Plan.dataLimit } : null,
                ready: pronto,
                config: pronto ? device.config : null,
                qrcode_base64: pronto && device.qrcode ? Buffer.from(device.qrcode).toString('base64') : null,
                device_id: device ? device.id : null,
                device_address: device ? device.address : null,
                updatedAt: c.updatedAt,
                ...extra
            };
        };

        const proprias = await Connection.findAll({
            where: { ClientId: req.client.id },
            include: [{ model: Plan, attributes: ['name', 'dataLimit'] }],
            order: [['id', 'DESC']]
        });

        /*
         * Cada tunel proprio garante o aparelho DESTE cliente.
         *
         * E aqui que o peer do titular nasce: ele abre o app e o device entra na
         * fila do provisionador. Idempotente — a chave e (conexao, cliente) com
         * indice unico, entao reabrir o app nao cria um segundo peer.
         */
        const listaPropria = await Promise.all(proprias.map(async (c) => {
            const { device } = await garantirDevice({
                connectionId: c.id,
                clientId: req.client.id
            });

            const vagas = await contarVagas(c);

            return serializar(c, device, {
                shared: false,
                owned: true,
                slots: {
                    total: vagas.total,
                    // O titular ocupa um aparelho como qualquer outro e ja esta
                    // dentro de `used`. No modelo antigo ele usava a chave da
                    // Connection e ficava fora da conta, o que obrigava a um
                    // desconto manual facil de esquecer.
                    used: vagas.usados,
                    guests_active: Math.max(0, vagas.usados - 1),
                    free: vagas.livres,
                    // Plano de 1 pessoa nao tem o que compartilhar.
                    can_share: vagas.total > 1
                }
            });
        }));

        /*
         * Tuneis emprestados: os que ALGUEM compartilhou com este cliente.
         *
         * E o mesmo TUNEL do titular, mas NAO a mesma chave: o convidado tem o
         * proprio peer, com par de chaves e /32 dele. Era exatamente o contrario
         * antes — o mesmo .conf ia para todo mundo, e como o WireGuard guarda um
         * unico endpoint por peer, cada aparelho derrubava o anterior.
         *
         * `sharesDoConvidado` ja varre os vencidos, entao um prazo que expirou
         * simplesmente some da lista na proxima abertura do app.
         */
        const convites = await convitesDoCliente(req);
        const listaCompartilhada = [];

        for (const share of convites) {
            const c = await Connection.findByPk(share.ConnectionId, {
                include: [{ model: Plan, attributes: ['name', 'dataLimit'] }]
            });
            if (!c) continue;

            const dono = await Client.findByPk(share.OwnerClientId, { attributes: ['name'] });

            // O aparelho do convidado nasce aqui se ainda nao existir — o aceite
            // do convite ja o cria, mas um convite aceito antes desta mudanca nao
            // tem device nenhum, e sem isto o convidado ficaria sem config.
            const { device } = await garantirDevice({
                connectionId: c.id,
                clientId: req.client.id,
                shareId: share.id
            });

            listaCompartilhada.push(serializar(c, device, {
                shared: true,
                owned: false,
                share_id: share.id,
                owner_name: String(dono?.name || 'Titular').trim().split(/\s+/)[0],
                duration_label: share.duration_label,
                expires_at: share.expires_at,
                expires_text: descreverPrazo(share),
                // Quem entrou por convite nao administra o tunel de outra pessoa.
                slots: null
            }));
        }

        res.json([...listaPropria, ...listaCompartilhada]);
    } catch (error) {
        console.error('[app/connections]', error);
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

        /*
         * Token novo e pleno: o que o app tem na mao pode ser o provisorio, que
         * o middleware recusa em todas as outras rotas.
         *
         * Abre sessao NOVA em vez de manter a atual: trocar a senha e o gesto de
         * quem desconfia que alguem mais tem acesso, e a sessao antiga deixa de
         * valer no mesmo instante. Se houvesse outro aparelho aberto, ele cai.
         */
        const token = await abrirSessao(client, req.body?.device_name);

        res.json({
            message: 'Senha alterada com sucesso.',
            token,
            session_id: client.active_session_id
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao alterar a senha.' });
    }
};

/**
 * Encerra a sessao deste aparelho.
 *
 * Existe porque a conta e de um aparelho so: sem uma forma de soltar a conta, o
 * usuario teria que derrubar a propria sessao pela tela de recusa toda vez que
 * trocasse de telefone.
 *
 * So solta se o `sid` do token for o que esta gravado. Sem essa conferencia, um
 * token antigo — de uma sessao ja substituida — deslogaria o aparelho que esta
 * em uso agora.
 */
exports.logout = async (req, res) => {
    try {
        const client = await Client.findByPk(req.client.id);
        if (!client) return res.status(404).json({ message: 'Cliente nao encontrado.' });

        if (client.active_session_id && client.active_session_id === req.client.sid) {
            await client.update({
                active_session_id: null,
                active_device: null,
                session_started_at: null
            });
        }

        res.json({ message: 'Sessao encerrada.' });
    } catch (error) {
        console.error('[app/logout]', error);
        res.status(500).json({ message: 'Erro ao encerrar a sessao.' });
    }
};
