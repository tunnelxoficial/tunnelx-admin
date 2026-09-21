const Connection = require('../models/Connection');
const Client = require('../models/Client');
const Plan = require('../models/Plan');
const { liberar, MOTIVO_INADIMPLENCIA } = require('./acessoInternet');

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
 * Garante que o cliente tenha A conexão do plano. UMA.
 *
 * `total_connections` NAO e quantidade de tuneis: e quantas pessoas podem usar
 * o MESMO tunel. Um plano de 8 significa um tunel compartilhado por ate 8
 * pessoas, com o mesmo .conf e o mesmo QR — e por isso o compartilhamento do
 * QR existe.
 *
 * Eu ja criei 8 linhas aqui, e estava errado: cada linha vira um peer separado
 * no provisionador, com chave e IP proprios. O resultado era o painel cheio de
 * conexoes repetidas do mesmo cliente e 8 IPs consumidos do pool 10.66.66.0/24
 * para atender uma venda so.
 *
 * Idempotente: se ja existe conexao, apenas reativa. O Asaas reenvia webhook em
 * caso de falha, e um reenvio nao pode criar tunel novo.
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
    if (existentes.length) {
        for (const c of existentes) {
            const mudancas = {};
            if (c.status !== 'active') {
                mudancas.status = 'active';
                mudancas.payment_status = 'PAID';
            }
            // O limite de pessoas acompanha o plano: trocar de plano muda quantos
            // podem usar, sem precisar refazer o tunel.
            if (c.total_connections !== plan.total_connections) {
                mudancas.total_connections = plan.total_connections;
            }
            if (Object.keys(mudancas).length) await c.update(mudancas);

            /*
             * Devolve a internet no tunel, e nao so o rotulo no banco.
             *
             * Antes esta funcao mexia em status e payment_status e parava ai. Se
             * o cliente tivesse sido cortado por falta de pagamento, pagar
             * deixava a linha bonita no painel e o peer continuava fora do
             * tunel: cliente pago, sem internet, ate alguem reparar na mao.
             *
             * somenteSeMotivo garante que o pagamento NAO desfaz um corte que o
             * operador fez de proposito — esse so a mao dele desfaz.
             */
            await liberar(c, { somenteSeMotivo: MOTIVO_INADIMPLENCIA });
        }
        return existentes;
    }

    // status_queue nasce 'WAIT' (padrão do modelo): é o que põe o túnel na fila
    // do provisionador, que gera config e QR e marca 'CREATED'.
    const nova = await Connection.create({
        name: client.name,
        cpf: client.cpf,
        phone: client.whatsapp,
        email: client.email,
        // Quantas PESSOAS cabem neste tunel.
        total_connections: plan.total_connections || 1,
        data_limit: plan.dataLimit,
        status: 'active',
        internet: true,
        ClientId: client.id,
        PlanId: plan.id,
        asaas_customer_id: sub.asaas_customer_id,
        asaas_subscription_id: sub.asaas_subscription_id,
        payment_status: 'PAID'
    });

    console.log(
        `[ativacao] cliente ${client.id}: conexao ${nova.id} criada ` +
        `(compartilhada por ate ${plan.total_connections || 1} pessoa(s))`
    );
    return [nova];
}

/**
 * Marca a assinatura como em dia e provisiona o que falta.
 *
 * @param {object} sub         instancia de Subscription
 * @param {object} [pagamento] cobranca do Asaas, quando houver
 */
async function ativar(sub, pagamento = null) {
    const plan = await Plan.findByPk(sub.PlanId);

    /*
     * O MESMO pagamento nao pode esticar o periodo duas vezes.
     *
     * No cartao, o Asaas manda PAYMENT_CONFIRMED e depois PAYMENT_RECEIVED para
     * a mesma cobranca, separados pelo prazo de liquidacao. Como o periodo era
     * recontado a partir de AGORA em toda chamada, o cliente ganhava dois ciclos
     * por um pagamento so.
     */
    const jaContabilizado = pagamento?.id && sub.last_payment_id === pagamento.id;

    await sub.update({
        status: 'ACTIVE',
        overdue_since: null, // pagou: a carência zera
        ...(jaContabilizado ? {} : { current_period_end: fimDoPeriodo(plan?.cycle) }),
        ...(pagamento?.id ? { last_payment_id: pagamento.id } : {}),
        ...(pagamento?.status ? { last_payment_status: pagamento.status } : {})
    });

    await garantirConexoes(sub);
    console.log(`[ativacao] assinatura ${sub.id} ativa`);
    return sub;
}

module.exports = { ativar, garantirConexoes, fimDoPeriodo };
