const Subscription = require('../models/Subscription');
const { evaluateAccess } = require('../utils/subscriptionAccess');
const { sharesDoConvidado } = require('./shareService');

/**
 * Veredito final de acesso de um cliente — assinatura OU convite.
 *
 * `evaluateAccess` responde só pela assinatura, e continua assim: é função pura,
 * testada, e misturar banco nela tiraria isso. Aqui em cima entra o segundo
 * caminho legítimo de acesso: o convidado, que não paga nada e mesmo assim
 * precisa entrar no túnel de quem o convidou.
 *
 * Um lugar só porque dois pontos consultam: o portão de /app/connections e a
 * tela de assinatura do app (que decide entre mostrar planos, aviso de atraso ou
 * bloqueio). Se divergissem, o convidado veria a tela de "escolha um plano"
 * mesmo tendo acesso — ou pior, o portão o deixaria passar e a tela o mandaria
 * pagar por algo que já tem.
 *
 * A assinatura vem primeiro: quem paga e também é convidado de alguém deve ver o
 * estado da própria assinatura (atraso, cancelamento), não o do convite.
 *
 * Devolve `{ access, subscription }` em dois campos, e não um objeto só: o
 * `access` vai inteiro para dentro do JSON que o app recebe, e a instância de
 * Subscription carrega `credit_card_token` e os ids do Asaas. Fundidos, bastava
 * um `res.json({ access })` para publicar isso na resposta.
 */
/**
 * Veredito de acesso, calculado UMA vez por requisição.
 *
 * O middleware chama isto para decidir se a requisição passa, e o controller
 * logo em seguida precisa dos mesmos convites para montar a resposta. Sem o
 * cache, a mesma conta era feita duas vezes no mesmo request — 2 UPDATEs + 1
 * SELECT, repetidos, para um resultado idêntico calculado milissegundos
 * depois. Num endpoint que TODO aparelho consulta a cada 30 segundos, isso é
 * metade das idas ao banco jogada fora.
 *
 * O cache vive no objeto da requisição: nasce e morre com ela. Não há como
 * servir o veredito de um cliente para outro, nem segurar dado velho entre
 * requisições.
 *
 * @param {number} clientId
 * @param {object} [req] a requisição, quando houver — é o que habilita o cache
 */
async function resolveClientAccess(clientId, req = null) {
    if (req && req.__acesso && req.__acesso.clientId === clientId) {
        return req.__acesso.resultado;
    }

    const resultado = await calcularAcesso(clientId);
    if (req) req.__acesso = { clientId, resultado };
    return resultado;
}

async function calcularAcesso(clientId) {
    const sub = await Subscription.findOne({
        where: { ClientId: clientId },
        order: [['id', 'DESC']]
    });

    const acesso = evaluateAccess(sub);
    if (acesso.allowed) {
        /*
         * `shares: null` e não `[]`: quem tem assinatura própria pode AINDA
         * assim ser convidado de alguém, e aqui nós simplesmente não olhamos.
         * Nulo diz "não consultado"; lista vazia diria "não existem", e o
         * controller esconderia túneis que a pessoa tem direito de ver.
         */
        return { access: { ...acesso, asGuest: false }, subscription: sub, shares: null };
    }

    // Sem assinatura válida: ainda pode ser convidado de alguém.
    const convites = await sharesDoConvidado(clientId);
    if (convites.length) {
        return {
            access: {
                allowed: true,
                state: 'GUEST',
                daysLeft: null,
                // Só avisa quando o estado da assinatura própria não importa —
                // quem nunca assinou (NONE) não precisa ver cobrança nenhuma.
                message: acesso.state === 'NONE' || acesso.state === 'CANCELED'
                    ? null
                    : acesso.message,
                asGuest: true,
                shareCount: convites.length
            },
            subscription: sub,
            // Os convites já carregados viajam junto: o controller monta a lista
            // de túneis emprestados a partir daqui, sem repetir a consulta.
            shares: convites
        };
    }

    return { access: { ...acesso, asGuest: false }, subscription: sub, shares: convites };
}

module.exports = { resolveClientAccess };
