/**
 * Regras do compartilhamento de túnel.
 *
 * Separado do controller para ser testável sem banco: prazo, validade do
 * convite e veredito de acesso são a parte que erra em silêncio — um convite
 * que nunca expira, ou um acesso que continua valendo depois do prazo, só
 * aparece semanas depois e como problema de cobrança.
 */

/** Quanto tempo um QR não escaneado continua valendo. */
const VALIDADE_DO_CONVITE_MIN = 30;

/**
 * Durações que o dono pode escolher.
 *
 * Em minutos, e não em datas: a contagem começa no ACEITE, não na criação. Um
 * convite gerado hoje e aceito amanhã daria um dia a menos se a data fosse
 * fixada na criação.
 */
const DURACOES = {
    '6h': { minutos: 6 * 60, label: '6 horas' },
    '12h': { minutos: 12 * 60, label: '12 horas' },
    '1d': { minutos: 24 * 60, label: '1 dia' },
    '7d': { minutos: 7 * 24 * 60, label: '7 dias' },
    '30d': { minutos: 30 * 24 * 60, label: '30 dias' },
    '90d': { minutos: 90 * 24 * 60, label: '3 meses' },
    '365d': { minutos: 365 * 24 * 60, label: '1 ano' },
    indefinido: { minutos: null, label: 'Sem prazo' }
};

function duracaoValida(chave) {
    return Object.prototype.hasOwnProperty.call(DURACOES, chave);
}

/** Lista para o app montar o seletor, sem duplicar os rótulos no cliente. */
function listarDuracoes() {
    return Object.entries(DURACOES).map(([key, d]) => ({
        key,
        label: d.label,
        minutes: d.minutos
    }));
}

/** Quando o convite (o QR) deixa de poder ser escaneado. */
function validadeDoConvite(agora = new Date()) {
    return new Date(agora.getTime() + VALIDADE_DO_CONVITE_MIN * 60 * 1000);
}

/** Até quando o ACESSO vale, contando do aceite. `null` = indefinido. */
function fimDoAcesso(chaveDuracao, aceiteEm = new Date()) {
    const d = DURACOES[chaveDuracao];
    if (!d || d.minutos === null) return null;
    return new Date(aceiteEm.getTime() + d.minutos * 60 * 1000);
}

/**
 * O convite pode ser aceito?
 *
 * @param {object|null} share
 * @param {Date} [agora]
 */
function podeAceitar(share, agora = new Date()) {
    if (!share) {
        return { ok: false, code: 'NAO_ENCONTRADO', message: 'Este convite não existe ou já foi usado.' };
    }
    if (share.status === 'REVOKED') {
        return { ok: false, code: 'REVOGADO', message: 'O dono cancelou este convite.' };
    }
    if (share.status === 'ACTIVE' || share.GuestClientId) {
        return { ok: false, code: 'JA_USADO', message: 'Este convite já foi usado por outra pessoa.' };
    }
    if (share.invite_expires_at && new Date(share.invite_expires_at) <= agora) {
        return { ok: false, code: 'CONVITE_EXPIRADO', message: 'Este convite expirou. Peça um novo ao dono.' };
    }
    return { ok: true };
}

/**
 * O acesso de um convidado ainda vale?
 *
 * Usado no portão das conexões: é o que impede um convidado de continuar
 * entrando depois do prazo ou da revogação.
 */
function acessoValido(share, agora = new Date()) {
    if (!share) return false;
    if (share.status !== 'ACTIVE') return false;
    if (share.expires_at && new Date(share.expires_at) <= agora) return false;
    return true;
}

/** Texto do prazo restante, pronto para a tela. */
function descreverPrazo(share, agora = new Date()) {
    if (!share?.expires_at) return 'Sem prazo';

    const restaMs = new Date(share.expires_at) - agora;
    if (restaMs <= 0) return 'Expirado';

    const horas = Math.floor(restaMs / 3600000);
    if (horas < 1) return `Expira em ${Math.max(1, Math.round(restaMs / 60000))} min`;
    if (horas < 24) return `Expira em ${horas}h`;

    const dias = Math.floor(horas / 24);
    if (dias < 30) return `Expira em ${dias} dia${dias > 1 ? 's' : ''}`;

    const meses = Math.floor(dias / 30);
    return `Expira em ${meses} ${meses > 1 ? 'meses' : 'mês'}`;
}

/**
 * Quantas vagas restam no túnel.
 *
 * `total_connections` conta PESSOAS no mesmo túnel, e o dono ocupa uma delas —
 * por isso o `- 1`. Sem descontar o dono, um plano de 8 aceitaria 8 convidados
 * e ficaria com 9 pessoas na mesma chave.
 */
function vagasRestantes(totalPessoas, convidadosAtivos) {
    const total = Math.max(1, Number(totalPessoas) || 1);
    return Math.max(0, total - 1 - convidadosAtivos);
}

module.exports = {
    DURACOES,
    VALIDADE_DO_CONVITE_MIN,
    duracaoValida,
    listarDuracoes,
    validadeDoConvite,
    fimDoAcesso,
    podeAceitar,
    acessoValido,
    descreverPrazo,
    vagasRestantes
};
