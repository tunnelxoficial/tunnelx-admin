const Client = require('../models/Client');
const Plan = require('../models/Plan');
const Product = require('../models/Product');
const Connection = require('../models/Connection');
const Subscription = require('../models/Subscription');
const asaasService = require('../services/asaasService');
const { evaluateAccess } = require('../utils/subscriptionAccess');
const { onlyDigits } = require('../utils/password');

/**
 * Assinatura vista pelo aplicativo: escolher plano, pagar e cancelar.
 *
 * Todas as rotas daqui são escopadas pelo token do cliente (req.client.id). Não
 * existe `clientId` em parâmetro nenhum: assinatura é dinheiro, e um id vindo da
 * requisição seria a porta para assinar no nome de outro.
 */

/** O que o app precisa para desenhar o cartão do plano. */
async function planoParaApp(plan) {
    let beneficios = [];
    if (plan.product_ids) {
        try {
            const ids = JSON.parse(plan.product_ids);
            if (Array.isArray(ids) && ids.length) {
                const produtos = await Product.findAll({ where: { id: ids } });
                beneficios = produtos.map(p => ({
                    tipo: p.tipo,
                    descricao: p.descricao,
                    valor: Number(p.valor)
                }));
            }
        } catch (e) {
            console.error('[app/plans] product_ids invalido no plano', plan.id, e.message);
        }
    }

    return {
        id: plan.id,
        name: plan.name,
        description: plan.description,
        cycle: plan.cycle,
        price: Number(plan.price),
        dataLimit: plan.dataLimit,
        total_connections: plan.total_connections,
        // Equipamentos/serviços inclusos. O app lista como benefício; o valor
        // deles NÃO entra no preço da assinatura — é cobrado na adesão.
        benefits: beneficios
    };
}

exports.listPlans = async (req, res) => {
    try {
        const plans = await Plan.findAll({ order: [['price', 'ASC']] });
        res.json(await Promise.all(plans.map(planoParaApp)));
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao carregar os planos.' });
    }
};

/** Assinatura atual + veredito de acesso, tudo que o app precisa num request. */
exports.current = async (req, res) => {
    try {
        const sub = await Subscription.findOne({
            where: { ClientId: req.client.id },
            order: [['id', 'DESC']]
        });

        const acesso = evaluateAccess(sub);
        if (!sub) return res.json({ subscription: null, access: acesso });

        const plan = await Plan.findByPk(sub.PlanId);

        res.json({
            subscription: {
                id: sub.id,
                status: sub.status,
                billing_type: sub.billing_type,
                plan: plan ? await planoParaApp(plan) : null,
                current_period_end: sub.current_period_end,
                cancel_at_period_end: sub.cancel_at_period_end,
                card_last4: sub.card_last4,
                card_brand: sub.card_brand
            },
            access: acesso
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao carregar sua assinatura.' });
    }
};

/**
 * Contrata o plano.
 *
 * A conexão NÃO é criada aqui. Ela nasce quando o pagamento confirma, no
 * webhook: criar antes colocaria um túnel na fila do provisionador sem nada
 * pago por trás, e bastaria abandonar o checkout para ganhar acesso.
 */
exports.subscribe = async (req, res) => {
    try {
        const { planId, billingType, card } = req.body || {};

        if (!planId) return res.status(400).json({ message: 'Escolha um plano.' });
        if (billingType !== 'CREDIT_CARD' && billingType !== 'PIX') {
            return res.status(400).json({ message: 'Forma de pagamento invalida.' });
        }

        const plan = await Plan.findByPk(planId);
        if (!plan) return res.status(404).json({ message: 'Plano nao encontrado.' });

        const client = await Client.findByPk(req.client.id);
        if (!client) return res.status(404).json({ message: 'Cliente nao encontrado.' });
        if (!client.cpf) {
            return res.status(400).json({ message: 'Seu cadastro esta sem CPF. Fale com o suporte.' });
        }

        // Já tem assinatura valendo? Assinar de novo criaria cobrança duplicada.
        const existente = await Subscription.findOne({
            where: { ClientId: client.id },
            order: [['id', 'DESC']]
        });
        if (existente && ['ACTIVE', 'OVERDUE', 'PENDING'].includes(existente.status)
            && !existente.cancel_at_period_end) {
            return res.status(409).json({
                message: 'Voce ja tem uma assinatura em andamento.',
                code: 'ALREADY_SUBSCRIBED'
            });
        }

        const asaasCustomer = await asaasService.createCustomer({
            name: client.name,
            email: client.email,
            cpf: onlyDigits(client.cpf),
            whatsapp: onlyDigits(client.whatsapp),
            cep: onlyDigits(client.cep),
            logradouro: client.logradouro,
            complemento: client.complemento,
            bairro: client.bairro,
            id: client.id
        });

        const sub = await Subscription.create({
            ClientId: client.id,
            PlanId: plan.id,
            billing_type: billingType,
            status: 'PENDING',
            asaas_customer_id: asaasCustomer.id
        });

        const remoteIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
            || req.socket?.remoteAddress;

        if (billingType === 'CREDIT_CARD') {
            if (!card?.number || !card?.holderName || !card?.expiryMonth || !card?.expiryYear || !card?.ccv) {
                await sub.destroy();
                return res.status(400).json({ message: 'Preencha todos os dados do cartao.' });
            }

            const holderInfo = {
                name: card.holderName,
                email: client.email,
                cpfCnpj: onlyDigits(card.holderCpf || client.cpf),
                postalCode: onlyDigits(client.cep),
                addressNumber: card.addressNumber || client.numero || 'S/N',
                phone: onlyDigits(client.whatsapp)
            };

            // Tokeniza primeiro: o número do cartão morre aqui, e o que segue
            // para a assinatura (e para o banco de dados) é só o token.
            const token = await asaasService.tokenizeCard(
                asaasCustomer.id,
                { ...card, remoteIp },
                holderInfo
            );

            const assinatura = await asaasService.createCardSubscription({
                customerId: asaasCustomer.id,
                plan,
                creditCardToken: token.creditCardToken,
                externalReference: sub.id,
                remoteIp
            });

            await sub.update({
                asaas_subscription_id: assinatura.id,
                credit_card_token: token.creditCardToken,
                card_last4: token.creditCardNumber,
                card_brand: token.creditCardBrand
            });

            // O status só vira ACTIVE pelo webhook de pagamento confirmado.
            // Confiar na resposta do POST ativaria assinatura de cartão recusado.
            return res.status(201).json({
                subscription_id: sub.id,
                status: 'PENDING',
                billing_type: 'CREDIT_CARD',
                message: 'Estamos confirmando o pagamento do seu cartao.'
            });
        }

        // ---- PIX Automático -------------------------------------------------
        const autorizacao = await asaasService.createPixAuthorization({
            customerId: asaasCustomer.id,
            plan,
            externalReference: sub.id
        });

        await sub.update({ pix_authorization_id: autorizacao.id });

        const qr = autorizacao.immediateQrCode || {};
        return res.status(201).json({
            subscription_id: sub.id,
            status: 'PENDING',
            billing_type: 'PIX',
            // O cliente paga este QR no app do banco. É esse pagamento que
            // registra o consentimento do débito recorrente.
            pix: {
                authorization_id: autorizacao.id,
                encoded_image: qr.encodedImage || null,
                payload: qr.payload || null,
                expiration_date: qr.expirationDate || null
            },
            message: 'Pague o Pix e autorize a cobranca recorrente no app do seu banco.'
        });
    } catch (error) {
        console.error('[app/subscribe]', error);
        res.status(500).json({ message: error.message || 'Nao foi possivel concluir a assinatura.' });
    }
};

/**
 * Cancela mantendo o que já foi pago.
 *
 * No Asaas a assinatura vai para INACTIVE (para de gerar cobrança) e aqui fica
 * marcada para encerrar no fim do período. O acesso continua até lá — quem
 * pagou o mês usa o mês.
 */
exports.cancel = async (req, res) => {
    try {
        const sub = await Subscription.findOne({
            where: { ClientId: req.client.id },
            order: [['id', 'DESC']]
        });

        if (!sub || sub.status === 'CANCELED') {
            return res.status(404).json({ message: 'Voce nao tem assinatura ativa.' });
        }
        if (sub.cancel_at_period_end) {
            return res.status(409).json({ message: 'Sua assinatura ja esta cancelada.' });
        }

        if (sub.asaas_subscription_id) {
            await asaasService.deactivateSubscription(sub.asaas_subscription_id);
        } else if (sub.pix_authorization_id) {
            await asaasService.cancelPixAuthorization(sub.pix_authorization_id);
        }

        await sub.update({ cancel_at_period_end: true, canceled_at: new Date() });

        const acesso = evaluateAccess(sub);
        res.json({
            message: sub.current_period_end
                ? 'Assinatura cancelada. Seu acesso continua ate o fim do periodo ja pago.'
                : 'Assinatura cancelada.',
            current_period_end: sub.current_period_end,
            access: acesso
        });
    } catch (error) {
        console.error('[app/cancel]', error);
        res.status(500).json({ message: error.message || 'Nao foi possivel cancelar.' });
    }
};

/** QR da cobrança em aberto, para quem está em atraso regularizar pelo app. */
exports.pendingPayment = async (req, res) => {
    try {
        const sub = await Subscription.findOne({
            where: { ClientId: req.client.id },
            order: [['id', 'DESC']]
        });
        if (!sub || !sub.last_payment_id) {
            return res.status(404).json({ message: 'Nenhuma cobranca em aberto.' });
        }

        const pagamento = await asaasService.getPayment(sub.last_payment_id);
        if (!pagamento) return res.status(404).json({ message: 'Cobranca nao encontrada.' });

        const qr = await asaasService.getPixQrCode(sub.last_payment_id);

        res.json({
            id: pagamento.id,
            value: pagamento.value,
            due_date: pagamento.dueDate,
            status: pagamento.status,
            invoice_url: pagamento.invoiceUrl || null,
            pix: qr ? { encoded_image: qr.encodedImage, payload: qr.payload } : null
        });
    } catch (error) {
        console.error('[app/pendingPayment]', error);
        res.status(500).json({ message: 'Erro ao carregar a cobranca.' });
    }
};

module.exports = exports;
