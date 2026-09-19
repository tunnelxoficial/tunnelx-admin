const Connection = require('../models/Connection');
const Client = require('../models/Client');
const Plan = require('../models/Plan');

/**
 * Ativar assinatura e criar as conexões — num lugar só.
 *
 * Dois caminhos chegam aqui: o webhook do Asaas e a verificação manual ("já
 * paguei"). Se cada um ativasse do seu jeito, divergiriam no primeiro ajuste —
 * e divergir aqui significa cliente pago sem túnel, ou túnel sem pagamento.
 *
 * O webhook é o caminho normal. A verificação manual existe porque ele pode
 * falhar: não chegar, chegar sem o vínculo, ou ser recusado. Sem ela, um
 * webhook perdido deixaria o cliente pagando e sem acesso, esperando suporte.
 */

/** Quantos meses somar, a partir do ciclo do plano. */
function fimDoPeriodo(cycle, base = new Date()) {
    const d = new Date(base);
    const meses = {
        mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12
    }[String(cycle || '').trim().toLowerCase()] ?? 1;
    d.setMonth(d.getMonth() + meses);
    return d;
}

/**
 * Garante que o cliente tenha as conexões do plano.
 *
 * Uma linha de Connection = um peer WireGuard, com chave e IP próprios: é assim
 * que o provisionador trata cada linha. Entao um plano de N conexoes simultaneas
 * precisa de N linhas — criar uma so entregaria uma chave unica, e aparelhos
 * compartilhando a mesma chave brigam pelo peer (o WireGuard guarda um endpoint
 * por peer) em vez de funcionarem juntos.
 *
 * Idempotente: conta o que já existe e cria só a diferença. O Asaas reenvia
 * webhook em caso de falha, e um reenvio não pode dobrar os túneis.
 */
async function garantirConexoes(sub) {
    const [client, plan] = await Promise.all([
        Client.findByPk(sub.ClientId),
        Plan.findByPk(sub.PlanId)
    ]);
    if (!client || !plan) {
        console.error('[ativacao] cliente ou plano ausente para a assinatura', sub.id);
        return [];
    }

    const existentes = await Connection.findAll({ where: { ClientId: sub.ClientId } });

    // Reativa o que já existe: quem voltou de um atraso não precisa de túnel novo.
    for (const c of existentes) {
        if (c.status !== 'active') {
            await c.update({ status: 'active', payment_status: 'PAID' });
        }
    }

    const desejadas = Math.max(1, Number(plan.total_connections) || 1);
    const faltam = desejadas - existentes.length;
    if (faltam <= 0) return existentes;

    const novas = [];
    for (let i = 0; i < faltam; i++) {
        // status_queue nasce 'WAIT' (padrão do modelo): é o que põe o túnel na
        // fila do provisionador, que gera config e QR e marca 'CREATED'.
        novas.push(await Connection.create({
            name: client.name,
            cpf: client.cpf,
            phone: client.whatsapp,
            email: client.email,
            total_connections: desejadas,
            data_limit: plan.dataLimit,
            status: 'active',
            internet: true,
            ClientId: client.id,
            PlanId: plan.id,
            asaas_customer_id: sub.asaas_customer_id,
            asaas_subscription_id: sub.asaas_subscription_id,
            payment_status: 'PAID'
        }));
    }

    console.log(
        `[ativacao] cliente ${client.id}: ${novas.length} conexao(oes) criada(s) ` +
        `(plano pede ${desejadas}, ja tinha ${existentes.length})`
    );
    return existentes.concat(novas);
}

/**
 * Marca a assinatura como em dia e provisiona o que falta.
 *
 * @param {object} sub         instancia de Subscription
 * @param {object} [pagamento] cobranca do Asaas, quando houver
 */
async function ativar(sub, pagamento = null) {
    const plan = await Plan.findByPk(sub.PlanId);

    await sub.update({
        status: 'ACTIVE',
        overdue_since: null, // pagou: a carência zera
        current_period_end: fimDoPeriodo(plan?.cycle),
        ...(pagamento?.id ? { last_payment_id: pagamento.id } : {}),
        ...(pagamento?.status ? { last_payment_status: pagamento.status } : {})
    });

    await garantirConexoes(sub);
    console.log(`[ativacao] assinatura ${sub.id} ativa`);
    return sub;
}

module.exports = { ativar, garantirConexoes, fimDoPeriodo };
