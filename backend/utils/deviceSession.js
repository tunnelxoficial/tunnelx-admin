const crypto = require('crypto');

/**
 * Sessão única por conta — uma conta, um aparelho.
 *
 * O problema que isto resolve não é técnico, é comercial: sem nada disso, duas
 * pessoas entram com o mesmo CPF e senha e usam o serviço lado a lado para
 * sempre. Uma assinatura vira duas, e ninguém percebe.
 *
 * O JWT não consegue impedir isso sozinho. Ele é auto-contido: uma vez emitido,
 * qualquer cópia vale até expirar, e aqui a expiração é de dez anos. Não existe
 * "deslogar" um JWT — só existe parar de aceitá-lo. É o que o `sid` faz.
 *
 * As regras ficam aqui, longe do banco, porque são a parte que erra em silêncio:
 * um login que deveria ser recusado e passa só aparece como cliente pagando um
 * plano e usando dois.
 */

/** Quantos minutos de inatividade fazem uma sessão parar de segurar a conta. */
const SESSAO_OCIOSA_MIN = 0; // 0 = nunca expira sozinha; só sai por logout ou troca

function novaSessao() {
    return crypto.randomBytes(24).toString('hex');
}

/**
 * Como identificar o aparelho na mensagem de recusa.
 *
 * Só serve para o dono reconhecer ("ah, é meu tablet") — não é credencial e não
 * participa de nenhuma decisão de acesso. Por isso pode vir do cliente sem
 * cerimônia; o que manda é o `sid`, que o servidor gera.
 */
function normalizarDispositivo(nome) {
    const limpo = String(nome || '').trim().replace(/\s+/g, ' ');
    if (!limpo) return 'Outro aparelho';
    return limpo.slice(0, 120);
}

/**
 * O login pode prosseguir?
 *
 * @param {object} client            linha de Clients (campos de sessão)
 * @param {boolean} forcar           o usuário confirmou que quer desconectar o outro
 * @param {string|null} sessaoAtual  `sid` que o aparelho já tem, se tiver
 * @returns {{ok: true} | {ok: false, code: string, device: string, since: Date|null}}
 */
function podeEntrar(client, forcar = false, sessaoAtual = null) {
    const ativa = client?.active_session_id;

    // Ninguém logado: entra.
    if (!ativa) return { ok: true };

    // É o MESMO aparelho entrando de novo (reinstalou, refez login). Não faz
    // sentido pedir confirmação para desconectar a si mesmo.
    if (sessaoAtual && sessaoAtual === ativa) return { ok: true };

    // Confirmou que quer derrubar o outro. Só chega aqui quem acertou a senha.
    if (forcar) return { ok: true };

    return {
        ok: false,
        code: 'SESSION_ACTIVE',
        device: client.active_device || 'Outro aparelho',
        since: client.session_started_at || null
    };
}

/**
 * O token ainda representa a sessão válida desta conta?
 *
 * Chamado a CADA requisição autenticada — é o que transforma "entrar em outro
 * aparelho" em "o anterior para de funcionar".
 *
 * Token sem `sid` é recusado. São os emitidos antes desta mudança: aceitá-los
 * manteria aberta exatamente a porta que estamos fechando, já que valem dez anos
 * e não estão presos a aparelho nenhum.
 */
function sessaoValida(payloadSid, client) {
    if (!payloadSid) return { ok: false, code: 'SESSION_INVALID' };
    if (!client) return { ok: false, code: 'SESSION_INVALID' };
    if (!client.active_session_id) return { ok: false, code: 'SESSION_ENDED' };
    if (client.active_session_id !== payloadSid) return { ok: false, code: 'SESSION_REPLACED' };
    return { ok: true };
}

/** Texto pronto para a tela de quem foi desconectado. */
function mensagemDaRecusa(code) {
    switch (code) {
        case 'SESSION_REPLACED':
            return 'Sua conta foi aberta em outro aparelho. Por segurança, este foi desconectado.';
        case 'SESSION_ENDED':
            return 'Sua sessao foi encerrada. Entre novamente.';
        default:
            return 'Entre novamente para continuar.';
    }
}

module.exports = {
    SESSAO_OCIOSA_MIN,
    novaSessao,
    normalizarDispositivo,
    podeEntrar,
    sessaoValida,
    mensagemDaRecusa
};
