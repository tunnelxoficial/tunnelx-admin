const Client = require('../models/Client');
const Plan = require('../models/Plan');
const Product = require('../models/Product');
const Connection = require('../models/Connection');
const asaasService = require('../services/asaasService');
const { sequelize } = require('../config/db');

const checkoutController = {
    processCheckout: async (req, res) => {
        const t = await sequelize.transaction();

        try {
            const { clientData, planId, cardData } = req.body;

            // 1. Create or Update Client locally
            let client = await Client.findOne({ where: { cpf: clientData.cpf } });
            if (client) {
                await client.update(clientData, { transaction: t });
            } else {
                client = await Client.create(clientData, { transaction: t });
            }

            // 2. Create/Get Asaas Customer
            // We pass the local ID as external reference
            const asaasCustomer = await asaasService.createCustomer({
                ...clientData,
                id: client.id
            });

            // Update client with asaas_id if you want to store it (optional but recommended)
            // await client.update({ asaas_id: asaasCustomer.id }, { transaction: t });

            // 3. Get Plan Details
            const plan = await Plan.findByPk(planId);
            if (!plan) throw new Error('Plano não encontrado');

            let productTotal = 0;
            let hasProducts = false;

            if (plan.product_ids) {
                try {
                    const ids = JSON.parse(plan.product_ids);
                    if (Array.isArray(ids) && ids.length > 0) {
                        const products = await Product.findAll({ where: { id: ids } });
                        productTotal = products.reduce((acc, p) => acc + parseFloat(p.valor), 0);
                        if (products.length > 0) hasProducts = true;
                    }
                } catch (e) {
                    console.error('Error parsing product_ids', e);
                }
            }

            const creditCardHolderInfo = {
                name: clientData.name,
                email: clientData.email,
                cpfCnpj: clientData.cpf,
                postalCode: clientData.cep,
                addressNumber: clientData.numero,
                phone: clientData.whatsapp
            };

            const remoteIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
            const cardDataWithIp = { ...cardData, remoteIp };

            // 4. Process Payments
            if (hasProducts) {
                // Charge products immediately
                await asaasService.createPayment(
                    asaasCustomer.id,
                    productTotal,
                    cardDataWithIp,
                    creditCardHolderInfo,
                    `Adesão/Equipamentos - Plano ${plan.name}`,
                    client.id
                );

                // Create subscription for next month
                const nextMonth = new Date();
                nextMonth.setMonth(nextMonth.getMonth() + 1);
                const nextDueDate = nextMonth.toISOString().split('T')[0];

                await asaasService.createSubscription(
                    asaasCustomer.id,
                    plan,
                    cardDataWithIp,
                    creditCardHolderInfo,
                    nextDueDate,
                    client.id
                );
            } else {
                // Just create subscription (starts immediately by default)
                await asaasService.createSubscription(
                    asaasCustomer.id,
                    plan,
                    cardDataWithIp,
                    creditCardHolderInfo,
                    null, // Let Asaas decide (usually today)
                    client.id
                );
            }

            // 5. Create Connection
            const connection = await Connection.create({
                name: client.name,
                cpf: client.cpf,
                phone: client.whatsapp,
                email: client.email,
                total_connections: plan.total_connections || 1,
                data_limit: plan.dataLimit,
                status: 'active', // Payment successful
                internet: true,
                ClientId: client.id,
                PlanId: plan.id
            }, { transaction: t });

            await t.commit();

            res.json({ success: true, clientId: client.id, connectionId: connection.id });

        } catch (error) {
            await t.rollback();
            console.error('Checkout Error:', error);
            res.status(500).json({ error: error.message || 'Erro ao processar checkout' });
        }
    }
};

module.exports = checkoutController;
