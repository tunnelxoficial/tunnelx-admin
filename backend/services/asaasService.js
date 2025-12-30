const axios = require('axios');

const ASAAS_API_KEY = '$aact_prod_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OjViYWVhYTQ1LTQ5Y2EtNDFjMi1iMzg0LTczYjNiOTc4MTE3YTo6JGFhY2hfYzI5ZTFlMWYtNGE1ZS00NWE5LWI4MjctZWU0NzI3ZGYzMzI0';
const ASAAS_URL = 'https://api-sandbox.asaas.com/v3';

const asaasApi = axios.create({
    baseURL: ASAAS_URL,
    headers: {
        'Content-Type': 'application/json',
        'access_token': ASAAS_API_KEY
    }
});

const asaasService = {
    async createCustomer(clientData) {
        try {
            // First check if customer exists by CPF/CNPJ
            const { data: searchData } = await asaasApi.get('/customers', {
                params: { cpfCnpj: clientData.cpf }
            });

            if (searchData.data && searchData.data.length > 0) {
                return searchData.data[0];
            }

            // Create new customer
            const response = await asaasApi.post('/customers', {
                name: clientData.name,
                email: clientData.email,
                cpfCnpj: clientData.cpf,
                mobilePhone: clientData.whatsapp,
                postalCode: clientData.cep,
                address: clientData.logradouro,
                addressNumber: clientData.numero,
                complement: clientData.complemento,
                province: clientData.bairro,
                externalReference: clientData.id // ID from our database
            });

            return response.data;
        } catch (error) {
            console.error('Error creating Asaas customer:', error.response ? error.response.data : error.message);
            throw new Error('Erro ao criar cliente no Asaas');
        }
    },

    async createSubscription(customerId, plan, cardData, creditCardHolderInfo, nextDueDate, externalReference) {
        try {
            const body = {
                customer: customerId,
                billingType: 'CREDIT_CARD',
                value: plan.price,
                cycle: 'MONTHLY', // Assuming monthly for now based on user prompt, can be dynamic
                description: `Assinatura Plano ${plan.name}`,
                externalReference: externalReference,
                creditCard: {
                    holderName: cardData.holderName,
                    number: cardData.number,
                    expiryMonth: cardData.expiryMonth,
                    expiryYear: cardData.expiryYear,
                    ccv: cardData.ccv
                },
                creditCardHolderInfo: creditCardHolderInfo,
                remoteIp: cardData.remoteIp
            };

            if (nextDueDate) {
                body.nextDueDate = nextDueDate;
            }

            const response = await asaasApi.post('/subscriptions', body);
            return response.data;
        } catch (error) {
            console.error('Error creating Asaas subscription:', error.response ? error.response.data : error.message);
            throw new Error('Erro ao criar assinatura no Asaas');
        }
    },

    async createPayment(customerId, amount, cardData, creditCardHolderInfo, description, externalReference) {
        try {
            const response = await asaasApi.post('/payments', {
                customer: customerId,
                billingType: 'CREDIT_CARD',
                value: amount,
                dueDate: new Date().toISOString().split('T')[0], // Today
                description: description,
                externalReference: externalReference,
                creditCard: {
                    holderName: cardData.holderName,
                    number: cardData.number,
                    expiryMonth: cardData.expiryMonth,
                    expiryYear: cardData.expiryYear,
                    ccv: cardData.ccv
                },
                creditCardHolderInfo: creditCardHolderInfo,
                remoteIp: cardData.remoteIp
            });
            return response.data;
        } catch (error) {
            console.error('Error creating Asaas payment:', error.response ? error.response.data : error.message);
            throw new Error('Erro ao processar pagamento no Asaas');
        }
    }
};

module.exports = asaasService;
