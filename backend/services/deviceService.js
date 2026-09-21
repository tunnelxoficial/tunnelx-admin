const { Op } = require('sequelize');
const ConnectionDevice = require('../models/ConnectionDevice');

/**
 * Um peer por aparelho: garantia, contagem e corte.
 *
 * Toda decisão sobre devices passa por aqui. Espalhar isso pelos controllers
 * seria repetir a conta de vagas em três lugares — e foi exatamente assim que o
 * modelo anterior acabou entregando a mesma chave para 8 pessoas.
 */

/**
 * Garante o aparelho deste cliente neste túnel.
 *
 * Idempotente por construção: a chave é (ConnectionId, ClientId), e há índice
 * único no banco. `findOrCreate` numa corrida — o app chama /app/connections e
 * /app/connections/state quase ao mesmo tempo — faz uma das duas falhar na
 * constraint, e o catch relê a linha que a outra criou. Sem isso seriam dois
 * peers e dois IPs para a mesma pessoa.
 *
 * @returns {Promise<{device: object, criado: boolean}>}
 */
async function garantirDevice({ connectionId, clientId, shareId = null, deviceName = null }) {
    const [device, criado] = await ConnectionDevice.findOrCreate({
        where: { ConnectionId: connectionId, ClientId: clientId },
        defaults: {
            ConnectionId: connectionId,
            ClientId: clientId,
            ConnectionShareId: shareId,
            device_name: deviceName,
            status_queue: 'WAIT'
        }
    }).catch(async (erro) => {
        // Corrida perdida na constraint única: a outra requisição criou.
        if (erro?.name === 'SequelizeUniqueConstraintError') {
            const existente = await ConnectionDevice.findOne({
                where: { ConnectionId: connectionId, ClientId: clientId }
            });
            if (existente) return [existente, false];
        }
        throw erro;
    });

    // Aparelho que tinha sido cortado e voltou (convite novo, assinatura
    // regularizada): volta para a fila em vez de virar um segundo device.
    if (!criado && device.revoked_at) {
        await device.update({
            revoked_at: null,
            ConnectionShareId: shareId ?? device.ConnectionShareId,
            status_queue: 'WAIT',
            queue_attempts: 0
        });
    }

    // Nome do aparelho muda quando a pessoa troca de celular; sem valor de
    // acesso, só serve para o titular reconhecer quem está no túnel dele.
    if (!criado && deviceName && device.device_name !== deviceName) {
        await device.update({ device_name: deviceName });
    }

    return { device, criado };
}

/** Aparelhos que ocupam vaga: tudo que não foi cortado. */
function ondeAtivo(connectionId) {
    return { ConnectionId: connectionId, revoked_at: null };
}

/**
 * Quantos aparelhos há e quantos ainda cabem.
 *
 * Aqui o titular NÃO é descontado à parte: ele tem um device como qualquer
 * outro, e o device dele já está na contagem. No modelo antigo o desconto era
 * necessário porque o titular usava a chave da Connection e não aparecia em
 * lugar nenhum — uma assimetria que fazia o `- 1` ser fácil de esquecer.
 */
async function contarVagas(connection) {
    const total = Math.max(1, Number(connection.total_connections) || 1);
    const usados = await ConnectionDevice.count({ where: ondeAtivo(connection.id) });
    return { total, usados, livres: Math.max(0, total - usados) };
}

/**
 * Cabe mais um aparelho neste túnel?
 *
 * Quem já tem device passa sempre: reabrir o app não pode esbarrar no limite
 * do próprio plano.
 */
async function cabeMaisUm(connection, clientId) {
    const jaTem = await ConnectionDevice.findOne({
        where: { ConnectionId: connection.id, ClientId: clientId, revoked_at: null }
    });
    if (jaTem) return true;

    const { livres } = await contarVagas(connection);
    return livres > 0;
}

/**
 * Corta o aparelho: marca revogado e devolve o peer para a fila de remoção.
 *
 * Não apaga a linha. O peer ainda está vivo no servidor WireGuard, e é o
 * provisionador que o remove de lá; apagar aqui deixaria o peer órfão no túnel
 * — o cliente cortado seguiria navegando, que é o vazamento que este produto já
 * teve antes.
 */
async function revogarDevice(device) {
    if (!device || device.revoked_at) return device;
    return device.update({ revoked_at: new Date() });
}

/** Corta todos os aparelhos vindos de um convite (o titular removeu o convidado). */
async function revogarPorShare(shareId) {
    const devices = await ConnectionDevice.findAll({
        where: { ConnectionShareId: shareId, revoked_at: null }
    });
    for (const d of devices) await revogarDevice(d);
    return devices.length;
}

/** O aparelho deste cliente neste túnel, se existir e estiver valendo. */
async function deviceDoCliente(connectionId, clientId) {
    return ConnectionDevice.findOne({
        where: { ConnectionId: connectionId, ClientId: clientId, revoked_at: null }
    });
}

/** Aparelhos ativos de um túnel, para a tela do titular. */
async function devicesDaConexao(connectionId) {
    return ConnectionDevice.findAll({
        where: ondeAtivo(connectionId),
        order: [['id', 'ASC']]
    });
}

/**
 * O aparelho já pode ser usado?
 *
 * `CREATED` com config é a única combinação que vale. Um device em WAIT existe
 * mas ainda não tem chave: entregar algo nesse estado seria entregar nada.
 */
function devicePronto(device) {
    return !!device && device.status_queue === 'CREATED' && !!device.config;
}

module.exports = {
    garantirDevice,
    contarVagas,
    cabeMaisUm,
    revogarDevice,
    revogarPorShare,
    deviceDoCliente,
    devicesDaConexao,
    devicePronto
};
