const Connection = require('../models/Connection');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const Client = require('../models/Client');
const { ativar, garantirConexoes } = require('../services/subscriptionActivation');

/**
 * Webhook do Asaas — a única coisa que libera ou corta o acesso pago.
 *
 * Por isso ele é autenticado. Antes aceitava qualquer POST: bastava mandar
 * `{event:'PAYMENT_RECEIVED', payment:{...}}` para ativar uma conexão sem
 * pagar nada. Agora exige o token configurado no painel do Asaas, enviado no
 * cabeçalho `asaas-access-token`.
 */

const TOKEN = process.env.ASAAS_WEBHOOK_TOKEN;

if (!TOKEN) {
    console.warn(
        '[webhook] ASAAS_WEBHOOK_TOKEN nao definido. O webhook vai RECUSAR todas as ' +
        'chamadas. Defina o mesmo token aqui e no painel do Asaas.'
    );
}

/** Quantos ciclos somar ao confirmar um pagamento, a partir do ciclo do plano. */
function fimDoPeriodo(cycle, base = new Date()) {
    const d = new Date(base);
    const meses = {
        mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12
    }[String(cycle || '').trim().toLowerCase()] ?? 1;
    d.setMonth(d.getMonth() + meses);
    return d;
}

/**
 * Acha a assinatura pelo que o evento carrega, do mais específico ao mais frouxo.
 * externalReference é o nosso próprio id — é o vínculo mais confiável.
 */
async function acharAssinatura(payment) {
    if (!payment) return null;

    // 1. externalReference e o nosso proprio id — o vinculo mais confiavel.
    //    So existe nas assinaturas de cartao; o Pix Automatico nao aceita o campo.
    if (payment.externalReference) {
        const porRef = await Subscription.findByPk(Number(payment.externalReference));
        if (porRef) return porRef;
    }

    // 2. Assinatura do Asaas (cartao).
    if (payment.subscription) {
        const porSub = await Subscription.findOne({
            where: { asaas_subscription_id: payment.subscription }
        });
        if (porSub) return porSub;
    }

    /*
     * 3. Pix Automatico. A cobranca nasce de uma AUTORIZACAO, e o id dela pode
     *    vir em campos diferentes conforme o evento. Tentamos todos os nomes
     *    plausiveis em vez de apostar num — foi exatamente aqui que o vinculo
     *    falhou e o pagamento ficou orfao ("evento sem destino").
     */
    const idAutorizacao = payment.pixAutomaticAuthorizationId
        || payment.pixAutomaticAuthorization?.id
        || payment.pixAutomaticAuthorization
        || payment.authorizationId;
    if (idAutorizacao && typeof idAutorizacao === 'string') {
        const porPix = await Subscription.findOne({
            where: { pix_authorization_id: idAutorizacao }
        });
        if (porPix) return porPix;
    }

    // 4. contractId: mandamos 'TUNNELX-SUB-<id>' ao criar a autorizacao Pix.
    const contrato = payment.contractId || payment.pixAutomaticAuthorization?.contractId;
    if (typeof contrato === 'string' && contrato.startsWith('TUNNELX-SUB-')) {
        const id = Number(contrato.replace('TUNNELX-SUB-', ''));
        if (Number.isFinite(id)) {
            const porContrato = await Subscription.findByPk(id);
            if (porContrato) return porContrato;
        }
    }

    // 5. Ultimo recurso: o cliente. `customer` costuma ser string, mas alguns
    //    eventos mandam o objeto inteiro.
    const idCliente = typeof payment.customer === 'string'
        ? payment.customer
        : payment.customer?.id;
    if (idCliente) {
        return Subscription.findOne({
            where: { asaas_customer_id: idCliente },
            order: [['id', 'DESC']]
        });
    }

    return null;
}

/**
 * Cria a conexão do cliente assim que a assinatura fica em dia.
 *
 * Nasce com status_queue 'WAIT': é o que coloca o túnel na fila do
 * provisionador, que gera config e QR e marca 'CREATED'. Idempotente — um
 * webhook reenviado (o Asaas repete em caso de falha) não pode render dois
 * túneis para o mesmo cliente.
 */
async function garantirConexao(sub) {
    const jaTem = await Connection.findOne({ where: { ClientId: sub.ClientId } });
    if (jaTem) {
        if (jaTem.status !== 'active') await jaTem.update({ status: 'active', payment_status: 'PAID' });
        return jaTem;
    }

    const [client, plan] = await Promise.all([
        Client.findByPk(sub.ClientId),
        Plan.findByPk(sub.PlanId)
    ]);
    if (!client || !plan) {
        console.error('[webhook] cliente ou plano ausente para a assinatura', sub.id);
        return null;
    }

    const nova = await Connection.create({
        name: client.name,
        cpf: client.cpf,
        phone: client.whatsapp,
        email: client.email,
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

    console.log(`[webhook] conexao ${nova.id} criada e enfileirada para o cliente ${client.id}`);
    return nova;
}

/** Corta o acesso das conexões do cliente sem apagá-las. */
async function desativarConexoes(clientId, status) {
    const [qtd] = await Connection.update(
        { status },
        { where: { ClientId: clientId } }
    );
    return qtd;
}

const webhookController = {
    handleWebhook: async (req, res) => {
        // Autenticação primeiro: o corpo nem é olhado sem o token certo.
        const enviado = req.headers['asaas-access-token'];
        if (!TOKEN || enviado !== TOKEN) {
            console.warn('[webhook] chamada recusada: token ausente ou invalido');
            return res.status(401).json({ message: 'nao autorizado' });
        }

        try {
            const { event, payment } = req.body || {};
            if (!event) return res.status(400).json({ message: 'evento ausente' });

            console.log('[webhook]', event, payment?.id || '');

            const sub = payment ? await acharAssinatura(payment) : null;

            // ---- assinatura do aplicativo -----------------------------------
            if (sub) {
                if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED') {
                    await ativar(sub, payment);
                    return res.status(200).json({ received: true });
                }

                if (event === 'PAYMENT_OVERDUE') {
                    await sub.update({
                        status: 'OVERDUE',
                        // Só marca na primeira vez: um segundo webkook de atraso
                        // não pode reiniciar a contagem dos 3 dias.
                        overdue_since: sub.overdue_since || new Date(),
                        last_payment_id: payment.id,
                        last_payment_status: 'OVERDUE'
                    });
                    console.log(`[webhook] assinatura ${sub.id} em atraso; carencia iniciada`);
                    return res.status(200).json({ received: true });
                }

                if (event === 'PAYMENT_REFUNDED' || event === 'PAYMENT_CHARGEBACK_REQUESTED'
                    || event === 'PAYMENT_DELETED') {
                    await sub.update({ status: 'CANCELED', canceled_at: new Date() });
                    await desativarConexoes(sub.ClientId, 'inactive');
                    return res.status(200).json({ received: true });
                }

                // Cobrança criada para o próximo ciclo: guarda para o app poder
                // mostrar o QR de quem quer adiantar ou regularizar.
                if (event === 'PAYMENT_CREATED') {
                    await sub.update({ last_payment_id: payment.id, last_payment_status: payment.status });
                    return res.status(200).json({ received: true });
                }
            }

            // ---- eventos do Pix Automático ----------------------------------
            if (event.startsWith('PIX_AUTOMATIC_AUTHORIZATION')) {
                const auth = req.body.authorization || req.body.pixAutomaticAuthorization;
                if (auth?.id) {
                    const porPix = await Subscription.findOne({
                        where: { pix_authorization_id: auth.id }
                    });
                    if (porPix) {
                        if (auth.status === 'ACTIVE') {
                            // A autorizacao ativa significa consentimento dado; o
                            // acesso em si ainda depende do pagamento confirmado.
                            console.log(`[webhook] autorizacao Pix ativa para a assinatura ${porPix.id}`);
                        } else if (['CANCELLED', 'CANCELED', 'EXPIRED', 'REJECTED'].includes(auth.status)) {
                            await porPix.update({ status: 'CANCELED', canceled_at: new Date() });
                            await desativarConexoes(porPix.ClientId, 'inactive');
                        }
                    }
                }
                return res.status(200).json({ received: true });
            }

            // ---- fluxo antigo: cobrança ligada direto a uma conexão ----------
            // O checkout web (pre-cadastro) ainda cria a conexão no ato e anota
            // os ids do Asaas nela.
            if (payment) {
                let connection = null;
                if (payment.id) {
                    connection = await Connection.findOne({ where: { asaas_payment_id: payment.id } });
                }
                if (!connection && payment.subscription) {
                    connection = await Connection.findOne({
                        where: { asaas_subscription_id: payment.subscription }
                    });
                }
                if (!connection && payment.customer) {
                    connection = await Connection.findOne({
                        where: { asaas_customer_id: payment.customer },
                        order: [['createdAt', 'DESC']]
                    });
                }

                if (connection) {
                    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
                        await connection.update({ payment_status: 'PAID', status: 'active' });
                    } else if (event === 'PAYMENT_OVERDUE') {
                        await connection.update({ payment_status: 'OVERDUE', status: 'payment_pending' });
                    } else if (event === 'PAYMENT_DELETED' || event === 'PAYMENT_REFUNDED') {
                        await connection.update({ payment_status: 'REFUNDED', status: 'inactive' });
                    }
                    return res.status(200).json({ received: true });
                }
            }

            // Evento que não é nosso: 200 mesmo assim. Responder erro faria o
            // Asaas reenviar em laço e, depois de tantas falhas, suspender a fila.
            /*
             * Chegou um evento que nao conseguimos ligar a nada.
             *
             * Imprime a estrutura recebida — sem isto, diagnosticar exige
             * adivinhar quais campos o Asaas mandou. Sao metadados de cobranca,
             * nao credenciais.
             */
            console.warn('[webhook] evento sem destino:', event, payment?.id || '');
            if (payment) {
                console.warn('[webhook]   campos da cobranca:', Object.keys(payment).join(', '));
                console.warn('[webhook]   customer=%s subscription=%s externalReference=%s',
                    JSON.stringify(payment.customer), JSON.stringify(payment.subscription),
                    JSON.stringify(payment.externalReference));
            }
            console.warn('[webhook]   chaves do corpo:', Object.keys(req.body || {}).join(', '));
            res.status(200).json({ received: true });
        } catch (error) {
            console.error('[webhook] falha ao processar:', error);
            res.status(500).json({ error: 'Webhook processing failed' });
        }
    }
};

module.exports = webhookController;
