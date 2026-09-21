const Connection = require('../models/Connection');
const Subscription = require('../models/Subscription');
const { evaluateAccess } = require('../utils/subscriptionAccess');
const { bloquear, liberar, MOTIVO_INADIMPLENCIA } = require('./acessoInternet');

/**
 * Corta inadimplente e devolve a internet de quem pagou, sozinho.
 *
 * Esta era a peca que faltava. O backend inteiro nao tinha UM agendador — nem
 * cron, nem setInterval — e o unico caminho para uma assinatura virar OVERDUE
 * era o webhook do Asaas chegar. Consequencias que isso produzia:
 *
 *   - webhook perdido (token trocado, endpoint fora do ar, evento nao assinado
 *     no painel do Asaas) = cliente inadimplente para sempre marcado como em
 *     dia, usando a internet de graca;
 *   - carencia de 3 dias que vence sem ninguem olhar: o prazo passava e nenhum
 *     processo acordava para aplicar o corte;
 *   - pagamento confirmado fora do webhook nao devolvia nada.
 *
 * O vigia fecha os tres: ele nao espera evento nenhum, ele COMPARA. A cada
 * passada, o estado que deveria valer (evaluateAccess, a mesma regra que o
 * aplicativo usa) e comparado com o estado gravado, e so a diferenca vira
 * escrita.
 *
 * Nao e o vigia que mexe no tunel: ele so acerta `Connections.internet`. Quem
 * reconcilia o WireGuard com esse campo e o provisionador, a cada ciclo. Essa
 * separacao e de proposito — o backend nao tem acesso ao servidor do tunel, e um
 * backend que tentasse mandar em WireGuard por SSH seria bem pior do que um
 * campo no banco que as duas pontas leem.
 */

/*
 * Rotulos de pagamento que, numa conexao SEM assinatura, valem como corte.
 *
 * REFUNDED entra junto de OVERDUE: dinheiro devolvido e dinheiro que nao
 * existe mais. O webhook grava esse rotulo em estorno e em chargeback, e
 * antes ele so mudava Connection.status — campo que nenhum consumidor de
 * acesso le — entao o estornado seguia navegando.
 */
const SEM_ACESSO = new Set(['OVERDUE', 'REFUNDED']);

/** De quanto em quanto tempo passar os olhos. */
const INTERVALO_MS = Number(process.env.VIGIA_COBRANCA_MS || 5 * 60 * 1000);

/** Espera antes da primeira passada, para nao disputar com o boot. */
const ATRASO_INICIAL_MS = 30 * 1000;

let rodando = false;
let timer = null;

/**
 * Uma passada completa.
 *
 * @param {Date} [agora]  injetavel para teste
 * @returns {Promise<{cortadas:number, liberadas:number, avaliadas:number}>}
 */
async function varrer(agora = new Date()) {
    let cortadas = 0;
    let liberadas = 0;
    let avaliadas = 0;

    const assinaturas = await Subscription.findAll();

    // ClientId -> assinatura, para decidir cada conexao sem uma consulta por linha.
    const porCliente = new Map();
    for (const sub of assinaturas) {
        const atual = porCliente.get(sub.ClientId);

        /*
         * Um cliente pode ter mais de uma assinatura na tabela (uma cancelada e
         * uma nova, por exemplo). Vale a que da acesso: cortar alguem por causa
         * de uma assinatura velha enquanto ele tem outra em dia seria pior do
         * que deixar passar.
         */
        if (!atual || (!evaluateAccess(atual, agora).allowed && evaluateAccess(sub, agora).allowed)) {
            porCliente.set(sub.ClientId, sub);
        }
    }

    const conexoes = await Connection.findAll();

    for (const conexao of conexoes) {
        /*
         * Rele a linha antes de decidir.
         *
         * O findAll acima trouxe um retrato; entre ele e este ponto o operador
         * pode ter cortado o cliente pelo painel. Decidir sobre a copia velha
         * e gravar por PK sem condicao sobrescreveria essa decisao — o motivo
         * "operator" viraria "overdue", e ai o proximo pagamento liberaria
         * alguem que o operador cortou de proposito.
         */
        try {
            await conexao.reload();
        } catch (e) {
            // Linha apagada no meio da varredura: nao ha o que decidir.
            continue;
        }

        const sub = porCliente.get(conexao.ClientId);
        let deveTerAcesso;

        if (sub) {
            deveTerAcesso = evaluateAccess(sub, agora).allowed;
        } else if (SEM_ACESSO.has(conexao.payment_status)) {
            // Sem assinatura (conexao do painel ou do checkout web) nao ha data
            // de vencimento para contar carencia: o rotulo e a decisao, e quem o
            // pos ali — webhook ou operador — ja sabia o que fazia.
            deveTerAcesso = false;
        } else {
            /*
             * Sem assinatura e sem pendencia declarada o vigia NAO corta — mas
             * desfaz o corte que ele mesmo fez.
             *
             * Antes havia um `continue` seco aqui, e isso condenava a base
             * inteira vinda do checkout web: aquelas conexoes nao tem linha em
             * Subscriptions, entao nenhum caminho de pagamento delas chama
             * liberar (o webhook so troca o rotulo em webhookController, e o
             * painel so acha assinatura quando ela existe). O cliente pagava,
             * o selo ficava verde, e a internet nao voltava nunca.
             *
             * somenteSeMotivo mantem intocado o corte do operador.
             */
            if (await liberar(conexao, { somenteSeMotivo: MOTIVO_INADIMPLENCIA })) {
                liberadas++;
                avaliadas++;
            }
            continue;
        }

        avaliadas++;

        if (deveTerAcesso) {
            if (await liberar(conexao, { somenteSeMotivo: MOTIVO_INADIMPLENCIA })) liberadas++;
        } else {
            if (await bloquear(conexao, MOTIVO_INADIMPLENCIA)) cortadas++;
        }
    }

    return { cortadas, liberadas, avaliadas };
}

async function passada() {
    // Uma passada lenta nao pode se sobrepor a seguinte: duas varreduras
    // concorrentes leem o mesmo estado e escrevem duas vezes a mesma decisao.
    if (rodando) {
        console.warn('[vigia] passada anterior ainda em andamento; pulando esta.');
        return;
    }

    rodando = true;
    try {
        const r = await varrer();
        if (r.cortadas || r.liberadas) {
            console.log(
                `[vigia] ${r.avaliadas} conexoes avaliadas, ` +
                `${r.cortadas} cortada(s), ${r.liberadas} liberada(s)`
            );
        }
    } catch (erro) {
        // Falhar aqui nao pode derrubar o processo: o vigia e um acessorio, e a
        // API precisa continuar de pe mesmo que o banco oscile.
        console.error('[vigia] falha na passada:', erro.message);
    } finally {
        rodando = false;
    }
}

function iniciar() {
    if (timer) return;

    setTimeout(passada, ATRASO_INICIAL_MS);
    timer = setInterval(passada, INTERVALO_MS);

    // Nao segura o processo vivo sozinho: sem isto um `npm test` ou um encerrar
    // gracioso ficariam pendurados no intervalo.
    if (timer.unref) timer.unref();

    console.log(`[vigia] cobranca vigiada a cada ${Math.round(INTERVALO_MS / 1000)}s`);
}

function parar() {
    if (timer) clearInterval(timer);
    timer = null;
}

module.exports = { iniciar, parar, varrer, INTERVALO_MS, SEM_ACESSO };
