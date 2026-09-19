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
async function resolveClientAccess(clientId) {
    const sub = await Subscription.findOne({
        where: { ClientId: clientId },
        order: [['id', 'DESC']]
    });

    const acesso = evaluateAccess(sub);
    if (acesso.allowed) {
        return { access: { ...acesso, asGuest: false }, subscription: sub };
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
            subscription: sub
        };
    }

    return { access: { ...acesso, asGuest: false }, subscription: sub };
}

module.exports = { resolveClientAccess };
