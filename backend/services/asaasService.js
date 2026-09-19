const axios = require('axios');

/**
 * Integração com o Asaas.
 *
 * A chave saiu do código. Ela estava escrita aqui e commitada — chave de
 * PRODUÇÃO, no histórico do repositório, visível para quem clonasse. Agora vem
 * de ASAAS_API_KEY no .env (que já é ignorado pelo git).
 *
 * Trocar a chave de lugar não desfaz a exposição: a que estava no código
 * precisa ser revogada no painel do Asaas, porque continua no histórico do git
 * para sempre.
 */
const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_URL = process.env.ASAAS_URL || 'https://api.asaas.com/v3';

if (!ASAAS_API_KEY) {
    // Aviso no boot, não exceção: o painel tem muita tela que não toca em
    // pagamento, e derrubar a API inteira por causa disso seria pior.
    console.warn(
        '[asaas] ASAAS_API_KEY nao definida. Assinaturas e cobrancas vao falhar. ' +
        'Defina no .env antes de usar o checkout do aplicativo.'
    );
}

const asaasApi = axios.create({
    baseURL: ASAAS_URL,
    headers: {
        'Content-Type': 'application/json',
        access_token: ASAAS_API_KEY
    },
    timeout: 20000
});

/** Erro do Asaas vem em errors[].description; sem isto o app mostra "[object Object]". */
function mensagemDoErro(error, padrao) {
    const dados = error.response?.data;
    const descricao = dados?.errors?.[0]?.description;
    return descricao || dados?.message || error.message || padrao;
}

function logar(contexto, error) {
    console.error(`[asaas] ${contexto}:`, error.response ? error.response.data : error.message);
}

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
            logar('createCustomer', error);
            throw new Error(mensagemDoErro(error, 'Erro ao criar cliente no Asaas'));
        }
    },

    /**
     * Tokeniza o cartão.
     *
     * O número do cartão entra aqui e não sai mais: o que voltamos a guardar é
     * o token, que cobra as próximas mensalidades sem pedir os dados de novo. É
     * o que faz o débito automático funcionar sem o app nunca tocar no PAN.
     *
     * Em produção a tokenização precisa ser liberada pelo gerente da conta
     * Asaas — em sandbox já vem ativa.
     */
    async tokenizeCard(customerId, cardData, holderInfo) {
        try {
            const response = await asaasApi.post('/creditCard/tokenize', {
                customer: customerId,
                creditCard: {
                    holderName: cardData.holderName,
                    number: cardData.number,
                    expiryMonth: cardData.expiryMonth,
                    expiryYear: cardData.expiryYear,
                    ccv: cardData.ccv
                },
                creditCardHolderInfo: holderInfo,
                remoteIp: cardData.remoteIp
            });
            // { creditCardNumber: '4242', creditCardBrand: 'VISA', creditCardToken: '...' }
            return response.data;
        } catch (error) {
            logar('tokenizeCard', error);
            throw new Error(mensagemDoErro(error, 'Nao foi possivel validar o cartao'));
        }
    },

    /**
     * Assinatura recorrente no cartão, cobrada com o token.
     *
     * Sem `endDate`, o Asaas cobra indefinidamente — é o "sem fim" que a
     * assinatura precisa ter. Quem encerra é o cancelamento.
     */
    async createCardSubscription({ customerId, plan, creditCardToken, nextDueDate, externalReference, remoteIp }) {
        try {
            const response = await asaasApi.post('/subscriptions', {
                customer: customerId,
                billingType: 'CREDIT_CARD',
                value: plan.price,
                cycle: cicloDoPlano(plan.cycle),
                description: `Assinatura Plano ${plan.name}`,
                externalReference: String(externalReference),
                creditCardToken,
                remoteIp,
                ...(nextDueDate ? { nextDueDate } : { nextDueDate: hoje() })
            });
            return response.data;
        } catch (error) {
            logar('createCardSubscription', error);
            throw new Error(mensagemDoErro(error, 'Erro ao criar assinatura no Asaas'));
        }
    },

    /**
     * Pix Automático: autorização de débito recorrente.
     *
     * Devolve um `immediateQrCode` — o cliente paga esse QR no app do banco, e é
     * esse pagamento que registra o consentimento. Depois disso a autorização
     * vira ACTIVE e, com `paymentCreationMode: SUBSCRIPTION`, o próprio Asaas
     * emite as cobranças seguintes. Não existe "PIX recorrente" sem essa
     * autorização: o banco do cliente precisa consentir com o débito futuro.
     */
    async createPixAuthorization({ customerId, plan, subscriptionId, startDate }) {
        const valor = Number(plan.price);
        // Este texto aparece no app do banco do pagador, na tela de
        // autorizacao e em cada cobranca. Leva a marca para ele reconhecer de
        // onde vem o debito.
        const descricao = descricaoCurta(`TunnelX · ${plan.name}`);

        try {
            const response = await asaasApi.post('/pix/automatic/authorizations', {
                // `customerId`, e nao `customer`: este endpoint usa nome
                // diferente do resto da API do Asaas.
                customerId,

                /*
                 * Identificador do contrato, obrigatorio e limitado a 35
                 * caracteres. E o que o banco do pagador exibe como "objeto da
                 * autorizacao" na tela de consentimento.
                 *
                 * Usamos o id da nossa assinatura: estavel, unico e curto —
                 * permite achar a assinatura a partir da autorizacao mesmo se o
                 * pix_authorization_id se perder.
                 */
                contractId: `TUNNELX-SUB-${subscriptionId}`,

                frequency: frequenciaPixDoPlano(plan.cycle),
                startDate: startDate || hoje(),
                // sem finishDate: autorizacao por tempo indeterminado

                // SUBSCRIPTION: o Asaas cria as cobrancas sozinho. Em MANUAL
                // seriamos nos, entre 2 e 10 dias uteis antes de cada vencimento.
                // Este modo EXIGE `value`.
                paymentCreationMode: 'SUBSCRIPTION',
                value: valor,
                description: descricao,

                /*
                 * A primeira cobranca vai no proprio pedido de autorizacao.
                 * E ela que o cliente paga no app do banco, e e esse pagamento
                 * que registra o consentimento do debito recorrente — sem este
                 * objeto nao ha o que escanear e a autorizacao nunca ativa.
                 */
                immediateQrCode: {
                    expirationSeconds: 3600, // 1h para pagar; depois e so refazer
                    originalValue: valor,
                    description: descricao
                },

                // Tenta de novo quando a cobranca falha (saldo insuficiente, por
                // exemplo). Sem isso uma falha unica encerraria a recorrencia.
                retryPolicy: 'ALLOW_THREE_IN_SEVEN_DAYS'
            });
            return response.data;
        } catch (error) {
            logar('createPixAuthorization', error);
            throw new Error(mensagemDoErro(error, 'Nao foi possivel iniciar o Pix automatico'));
        }
    },

    async getPixAuthorization(id) {
        try {
            const response = await asaasApi.get(`/pix/automatic/authorizations/${id}`);
            return response.data;
        } catch (error) {
            logar('getPixAuthorization', error);
            throw new Error(mensagemDoErro(error, 'Erro ao consultar a autorizacao Pix'));
        }
    },

    /**
     * Encerra a assinatura SEM apagar o que já foi cobrado.
     *
     * `status: INACTIVE` em vez de DELETE: o DELETE remove também as cobranças
     * pendentes e vencidas, o que apagaria a dívida de quem cancela devendo.
     * INACTIVE só interrompe a geração de novas — e é o que sustenta "o acesso
     * vale até o fim do período já pago".
     */
    async deactivateSubscription(subscriptionId) {
        try {
            const response = await asaasApi.put(`/subscriptions/${subscriptionId}`, {
                status: 'INACTIVE'
            });
            return response.data;
        } catch (error) {
            logar('deactivateSubscription', error);
            throw new Error(mensagemDoErro(error, 'Erro ao cancelar a assinatura'));
        }
    },

    async cancelPixAuthorization(authorizationId) {
        try {
            const response = await asaasApi.delete(`/pix/automatic/authorizations/${authorizationId}`);
            return response.data;
        } catch (error) {
            logar('cancelPixAuthorization', error);
            throw new Error(mensagemDoErro(error, 'Erro ao cancelar a autorizacao Pix'));
        }
    },

    async getPayment(paymentId) {
        try {
            const response = await asaasApi.get(`/payments/${paymentId}`);
            return response.data;
        } catch (error) {
            logar('getPayment', error);
            return null;
        }
    },

    /** QR e copia-e-cola de uma cobrança PIX avulsa (regularizar atraso). */
    async getPixQrCode(paymentId) {
        try {
            const response = await asaasApi.get(`/payments/${paymentId}/pixQrCode`);
            return response.data; // { encodedImage, payload, expirationDate }
        } catch (error) {
            logar('getPixQrCode', error);
            return null;
        }
    },

    // ---- compatibilidade com o checkout web (pre-cadastro.html) --------------
    // Mantidos porque a página pública ainda os usa; o app não passa por aqui.

    async createSubscription(customerId, plan, cardData, creditCardHolderInfo, nextDueDate, externalReference) {
        try {
            const body = {
                customer: customerId,
                billingType: 'CREDIT_CARD',
                value: plan.price,
                cycle: cicloDoPlano(plan.cycle),
                description: `Assinatura Plano ${plan.name}`,
                externalReference,
                creditCard: {
                    holderName: cardData.holderName,
                    number: cardData.number,
                    expiryMonth: cardData.expiryMonth,
                    expiryYear: cardData.expiryYear,
                    ccv: cardData.ccv
                },
                creditCardHolderInfo,
                remoteIp: cardData.remoteIp
            };
            if (nextDueDate) body.nextDueDate = nextDueDate;

            const response = await asaasApi.post('/subscriptions', body);
            return response.data;
        } catch (error) {
            logar('createSubscription', error);
            throw new Error(mensagemDoErro(error, 'Erro ao criar assinatura no Asaas'));
        }
    },

    async createPayment(customerId, amount, cardData, creditCardHolderInfo, description, externalReference) {
        try {
            const response = await asaasApi.post('/payments', {
                customer: customerId,
                billingType: 'CREDIT_CARD',
                value: amount,
                dueDate: hoje(),
                description,
                externalReference,
                creditCard: {
                    holderName: cardData.holderName,
                    number: cardData.number,
                    expiryMonth: cardData.expiryMonth,
                    expiryYear: cardData.expiryYear,
                    ccv: cardData.ccv
                },
                creditCardHolderInfo,
                remoteIp: cardData.remoteIp
            });
            return response.data;
        } catch (error) {
            logar('createPayment', error);
            throw new Error(mensagemDoErro(error, 'Erro ao processar pagamento no Asaas'));
        }
    }
};

function hoje() {
    return new Date().toISOString().split('T')[0];
}

/** O plano guarda o ciclo em português; o Asaas espera o enum dele. */
function cicloDoPlano(cycle) {
    const mapa = {
        mensal: 'MONTHLY',
        bimestral: 'BIMONTHLY',
        trimestral: 'QUARTERLY',
        semestral: 'SEMIANNUALLY',
        anual: 'YEARLY'
    };
    return mapa[String(cycle || '').trim().toLowerCase()] || 'MONTHLY';
}

/**
 * Frequencia do Pix Automatico.
 *
 * O enum e MENOR que o de assinatura por cartao: WEEKLY, MONTHLY, QUARTERLY,
 * SEMIANNUALLY e ANNUALLY — NAO existe bimestral. Um plano bimestral cairia num
 * default silencioso e passaria a cobrar todo mes, ou seja, o dobro do
 * combinado. Por isso aqui e erro explicito em vez de fallback.
 */
function frequenciaPixDoPlano(cycle) {
    const mapa = {
        semanal: 'WEEKLY',
        mensal: 'MONTHLY',
        trimestral: 'QUARTERLY',
        semestral: 'SEMIANNUALLY',
        anual: 'ANNUALLY'
    };
    const c = String(cycle || '').trim().toLowerCase();
    const f = mapa[c];
    if (!f) {
        throw new Error(
            `O ciclo "${cycle}" nao e aceito no Pix automatico. ` +
            'Use cartao de credito neste plano, ou mude o ciclo para mensal, trimestral, semestral ou anual.'
        );
    }
    return f;
}

/** `description` e `contractId` do Pix Automatico param em 35 caracteres. */
function descricaoCurta(texto) {
    const s = String(texto || '').trim();
    return s.length <= 35 ? s : s.slice(0, 34) + '…';
}

module.exports = asaasService;
