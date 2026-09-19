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

    await ConnectionShare.update(
        { status: 'EXPIRED' },
        {
            where: {
                ...where,
                status: 'ACTIVE',
                expires_at: { [Op.ne]: null, [Op.lte]: agora }
            }
        }
    );

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
 * Vagas livres para NOVOS convites (conta pendentes).
 *
 * @param {object} connection instância de Connection
 */
async function vagasParaConvite(connection) {
    const { ativos, pendentes, ocupadas } = await contarOcupacao(connection.id);
    return {
        ativos,
        pendentes,
        total: Math.max(1, Number(connection.total_connections) || 1),
        livres: vagasRestantes(connection.total_connections, ocupadas)
    };
}

/**
 * Vagas livres para ACEITAR um convite (conta só quem já está dentro).
 *
 * Diferente de `vagasParaConvite` de propósito: na hora do aceite, o convite
 * sendo aceito é ele mesmo um dos pendentes. Contá-lo bloquearia o último
 * convidado do plano — o convite ocuparia a vaga que ele veio ocupar.
 */
async function vagasParaAceite(connection) {
    const { ativos } = await contarOcupacao(connection.id);
    return vagasRestantes(connection.total_connections, ativos);
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
