const Connection = require('../models/Connection');
const { sequelize } = require('../config/db');

const webhookController = {
    handleWebhook: async (req, res) => {
        try {
            const { event, payment } = req.body;

            console.log('Webhook received:', event, payment.id);

            // We can identify the connection by asaas_customer_id or externalReference
            // Ideally we stored asaas IDs in Connection.
            
            // Find connection
            // Strategy: 
            // 1. Try finding by asaas_payment_id
            // 2. Try finding by asaas_subscription_id (if payment has subscription field)
            // 3. Try finding by asaas_customer_id (might return multiple, need to filter)
            // 4. Try finding by ClientId using externalReference (if it's the client ID)

            let connection = null;

            // 1. Direct match on payment ID (if we stored it)
            if (payment.id) {
                connection = await Connection.findOne({ where: { asaas_payment_id: payment.id } });
            }

            // 2. Match by Subscription
            if (!connection && payment.subscription) {
                connection = await Connection.findOne({ where: { asaas_subscription_id: payment.subscription } });
            }

            // 3. Match by Customer
            if (!connection && payment.customer) {
                // This might be risky if a customer has multiple connections, but assuming 1 active connection per customer for now
                connection = await Connection.findOne({ 
                    where: { asaas_customer_id: payment.customer },
                    order: [['createdAt', 'DESC']]
                });
            }

            if (!connection) {
                console.warn('Connection not found for webhook payment:', payment.id);
                return res.status(200).json({ received: true }); // Acknowledge anyway
            }

            // Update Status based on Event
            if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
                await connection.update({ 
                    payment_status: 'PAID',
                    status: 'active' 
                });
                console.log(`Connection ${connection.id} activated via webhook.`);
            } else if (event === 'PAYMENT_OVERDUE') {
                 await connection.update({ 
                    payment_status: 'OVERDUE',
                    status: 'payment_pending' // or inactive
                });
                console.log(`Connection ${connection.id} marked overdue.`);
            } else if (event === 'PAYMENT_DELETED' || event === 'PAYMENT_REFUNDED') {
                 await connection.update({ 
                    payment_status: 'REFUNDED',
                    status: 'inactive' 
                });
            }

            res.status(200).json({ received: true });
        } catch (error) {
            console.error('Webhook Error:', error);
            res.status(500).json({ error: 'Webhook processing failed' });
        }
    }
};

module.exports = webhookController;
