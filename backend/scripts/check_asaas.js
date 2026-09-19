const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const axios = require('axios');

/**
 * Confere a integracao com o Asaas SEM criar nada.
 *
 * So chamadas de leitura: valida a chave, diz em qual ambiente ela esta e
 * mostra se os recursos que a assinatura do aplicativo depende — tokenizacao de
 * cartao e Pix Automatico — estao liberados nesta conta. Os dois precisam de
 * habilitacao, e descobrir isso aqui e melhor que descobrir no primeiro cliente
 * tentando pagar.
 *
 * Rodar:  node scripts/check_asaas.js
 */
const CHAVE = process.env.ASAAS_API_KEY;
const URL = process.env.ASAAS_URL || 'https://api.asaas.com/v3';

const api = axios.create({
    baseURL: URL,
    headers: { 'Content-Type': 'application/json', access_token: CHAVE },
    timeout: 20000
});

function detalhe(e) {
    const d = e.response?.data;
    return d?.errors?.[0]?.description || d?.message || e.message;
}

(async () => {
    if (!CHAVE) {
        console.error('ASAAS_API_KEY nao definida no .env.');
        process.exit(1);
    }

    const producao = CHAVE.includes('_prod_');
    console.log('URL:       ', URL);
    console.log('Ambiente:  ', producao ? 'PRODUCAO' : 'SANDBOX/outro');
    console.log('');

    // 1. A chave e valida?
    try {
        const { data } = await api.get('/customers', { params: { limit: 1 } });
        console.log('  ok    chave valida — a conta responde');
        console.log('        clientes cadastrados no Asaas:', data.totalCount ?? '(nao informado)');
    } catch (e) {
        console.error('  FALHA chave recusada:', detalhe(e));
        process.exit(1);
    }

    // 2. Dados da conta.
    try {
        const { data } = await api.get('/myAccount/commercialInfo');
        console.log('  ok    conta:', data.name || data.companyName || '(sem nome)');
    } catch (e) {
        console.log('  --    nao foi possivel ler os dados da conta:', detalhe(e));
    }

    // 3. Assinaturas existentes (o modelo que o app usa no cartao).
    try {
        const { data } = await api.get('/subscriptions', { params: { limit: 1 } });
        console.log('  ok    assinaturas acessiveis — total:', data.totalCount ?? 0);
    } catch (e) {
        console.log('  FALHA assinaturas:', detalhe(e));
    }

    // 4. Pix Automatico liberado? Uma listagem vazia ja responde.
    try {
        await api.get('/pix/automatic/authorizations', { params: { limit: 1 } });
        console.log('  ok    Pix Automatico DISPONIVEL nesta conta');
    } catch (e) {
        const status = e.response?.status;
        console.log('  ATENCAO  Pix Automatico indisponivel (HTTP ' + status + '):', detalhe(e));
        console.log('           O pagamento por Pix vai falhar ate o Asaas liberar o recurso.');
    }

    // 5. Tokenizacao: nao da para testar sem um cartao real, mas o endpoint
    //    responde 400 (dados invalidos) se estiver liberado, e 401/403 se nao.
    try {
        await api.post('/creditCard/tokenize', {});
        console.log('  ok    tokenizacao respondeu (inesperado com corpo vazio)');
    } catch (e) {
        const status = e.response?.status;
        if (status === 400) {
            console.log('  ok    tokenizacao DISPONIVEL (recusou o corpo vazio, como esperado)');
        } else if (status === 401 || status === 403) {
            console.log('  ATENCAO  tokenizacao bloqueada (HTTP ' + status + '):', detalhe(e));
            console.log('           Peca a liberacao ao gerente da conta Asaas.');
        } else {
            console.log('  --    tokenizacao: HTTP ' + status + ' —', detalhe(e));
        }
    }

    console.log('\nNenhuma cobranca foi criada: todas as chamadas acima sao de leitura.');
})();
