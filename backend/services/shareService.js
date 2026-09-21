const { Op } = require('sequelize');
const ConnectionShare = require('../models/ConnectionShare');
const { acessoValido, vagasRestantes } = require('../utils/shareRules');

/**
 * Estado dos convites — ocupação de vagas e expiração.
 *
 * Um lugar só porque três caminhos precisam da mesma contagem: o dono ao gerar
 * um convite, o convidado ao aceitar, e o portão que decide se ele ainda entra.
 * Se cada um contasse do seu jeito, um plano de 8 acabaria com 9 pessoas na
 * mesma chave — e como o WireGuard guarda UM endpoint por peer, o excedente
 * derruba quem já estava conectado.
 */

/**
 * Marca como EXPIRED o que passou do prazo.
 *
 * Varredura preguiçosa, no caminho de quem consulta, em vez de um job agendado:
 * não há agendador neste servidor, e um convite expirado que continua ACTIVE no
 * banco é acesso vendido de graça. O custo é um UPDATE ocasional numa tabela
 * pequena.
 *
 * Vale para os dois prazos: o do ACESSO (expires_at, em convites aceitos) e o
 * do CONVITE (invite_expires_at, em QR que ninguém escaneou) — este último
 * precisa sair da contagem, senão um QR esquecido segura uma vaga para sempre.
 */
async function varrerExpirados(where = {}) {
    const agora = new Date();

    /*
     * O prazo do convite tem que cortar o PEER, não só marcar o convite.
     *
     * Antes esta função só mudava `status` para EXPIRED. O túnel sumia da lista
     * do convidado — e era só isso. A linha em ConnectionDevices continuava com
     * `revoked_at` nulo, e daí saíam duas falhas que se somam:
     *
     *   1. O provisionador só remove peers com `revoked_at` preenchido, então o
     *      peer do ex-convidado NUNCA saía do túnel. Quem tivesse importado o
     *      .conf no aplicativo oficial do WireGuard seguia navegando de graça,
     *      indefinidamente. O prazo vendido não existia tecnicamente.
     *   2. `contarVagas` conta esse device para sempre. Um plano de 8 com
     *      rotatividade de convidados chegava a zero vagas com o túnel vazio, e
     *      o titular via "todas as vagas ocupadas" sem ninguém dentro e sem nada
     *      para remover — o convite expirado nem aparece na lista dele.
     *
     * Por isso os ids são capturados ANTES de mudar o status: depois do UPDATE
     * não há mais como saber quais linhas mudaram nesta passada, e revogar tudo
     * que está EXPIRED faria trabalho repetido a cada poll de cada aparelho.
     */
    const expirados = [];

    const aceitosVencidos = await ConnectionShare.findAll({
        where: {
            ...where,
            status: 'ACTIVE',
            expires_at: { [Op.ne]: null, [Op.lte]: agora }
        },
        attributes: ['id']
    });
    expirados.push(...aceitosVencidos.map((s) => s.id));

    if (aceitosVencidos.length) {
        await ConnectionShare.update(
            { status: 'EXPIRED' },
            { where: { id: { [Op.in]: expirados } } }
        );
    }

    // Convite que ninguém escaneou: não há aparelho para cortar, só o QR morre.
    await ConnectionShare.update(
        { status: 'EXPIRED' },
        {
            where: {
                ...where,
                status: 'PENDING',
                invite_expires_at: { [Op.lte]: agora }
            }
        }
    );

    if (expirados.length) {
        // Import tardio: deviceService também importa daqui, e no topo isto
        // fecharia um ciclo entre os dois módulos.
        const { revogarPorShare } = require('./deviceService');
        for (const id of expirados) {
            try {
                await revogarPorShare(id);
            } catch (e) {
                console.error('[shareService] falha ao cortar o aparelho do convite', id, e.message);
            }
        }
    }
}

/**
 * Quantas pessoas ocupam o túnel hoje.
 *
 * Convites PENDENTES contam como vaga reservada. Sem isso, o dono geraria 20 QR
 * de um plano de 8 e a recusa só apareceria na cara de quem escaneasse — o
 * convidado levaria a culpa por um limite que o dono estourou.
 */
async function contarOcupacao(connectionId) {
    await varrerExpirados({ ConnectionId: connectionId });

    const [ativos, pendentes] = await Promise.all([
        ConnectionShare.count({ where: { ConnectionId: connectionId, status: 'ACTIVE' } }),
        ConnectionShare.count({ where: { ConnectionId: connectionId, status: 'PENDING' } })
    ]);

    return { ativos, pendentes, ocupadas: ativos + pendentes };
}

/**
 * Vagas livres para NOVOS convites.
 *
 * A conta mudou de unidade: o limite do plano agora é de APARELHOS, não de
 * convites. Cada pessoa no túnel — o titular inclusive — tem um peer próprio
 * (ver models/ConnectionDevice.js), e é isso que consome vaga.
 *
 * Os convites PENDENTES continuam reservando, porque ainda não viraram
 * aparelho: sem reservar, o titular geraria 20 QR de um plano de 8 e a recusa
 * apareceria na cara de quem escaneasse.
 *
 * O titular não é mais descontado à parte. Antes ele usava a chave da
 * Connection e não aparecia em contagem nenhuma, o que obrigava a um `- 1`
 * espalhado; agora o device dele está em `usados` como o de qualquer outro.
 *
 * @param {object} connection instância de Connection
 */
async function vagasParaConvite(connection) {
    const { contarVagas } = require('./deviceService');
    const { pendentes } = await contarOcupacao(connection.id);
    const { total, usados } = await contarVagas(connection);

    return {
        // `ativos` = quantos CONVIDADOS estão dentro (o titular não conta aqui,
        // porque a tela do titular fala de quem ele convidou).
        ativos: Math.max(0, usados - 1),
        pendentes,
        total,
        livres: Math.max(0, total - usados - pendentes)
    };
}

/**
 * Vagas livres para ACEITAR um convite (conta só quem já está dentro).
 *
 * Diferente de `vagasParaConvite` de propósito: na hora do aceite, o convite
 * sendo aceito é ele mesmo um dos pendentes. Contá-lo bloquearia o último
 * convidado do plano — o convite ocuparia a vaga que ele veio ocupar.
 *
 * Conta aparelhos, pela mesma razão de `vagasParaConvite`.
 */
async function vagasParaAceite(connection) {
    const { contarVagas } = require('./deviceService');
    const { livres } = await contarVagas(connection);
    return livres;
}

/** Convites ativos e válidos deste convidado (os túneis emprestados a ele). */
async function sharesDoConvidado(guestClientId) {
    await varrerExpirados({ GuestClientId: guestClientId });

    const shares = await ConnectionShare.findAll({
        where: { GuestClientId: guestClientId, status: 'ACTIVE' },
        order: [['id', 'DESC']]
    });

    // Segunda checagem em memória: a varredura acima e esta consulta não são
    // atômicas, e um convite pode vencer entre as duas.
    return shares.filter((s) => acessoValido(s));
}

module.exports = {
    varrerExpirados,
    contarOcupacao,
    vagasParaConvite,
    vagasParaAceite,
    sharesDoConvidado
};
