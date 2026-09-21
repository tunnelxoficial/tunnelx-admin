/**
 * Testa a regra de corte e liberacao de internet. NAO toca no banco.
 *
 * O que esta coberto e o que decide se um cliente tem ou nao internet — a regra
 * mais cara de errar do sistema inteiro. Errar para um lado deixa devedor
 * navegando de graca; errar para o outro corta quem pagou.
 *
 * Tres camadas:
 *   subscriptionAccess  quando uma assinatura da ou tira acesso (carencia)
 *   acessoInternet      quem manda quando operador e cobranca discordam
 *   vigiaCobranca       a varredura periodica, com models dublados
 *   toggleInternet      o handler do botao do painel
 *
 * Uso:  node scripts/testar_acesso.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DIA = 24 * 60 * 60 * 1000;
const AGORA = new Date('2026-09-21T12:00:00Z');

let falhas = 0;
function ok(nome, cond, extra) {
    if (cond) console.log('  ok    ' + nome);
    else { console.log('  FALHA ' + nome + (extra ? '  -> ' + extra : '')); falhas++; }
}

/** Dublê de uma linha de Connection, com contagem de escritas. */
function conexao(campos) {
    return {
        id: 1,
        internet: true,
        internet_block_reason: null,
        internet_blocked_at: null,
        payment_status: null,
        ClientId: 1,
        escritas: 0,
        ...campos,
        async update(m) { Object.assign(this, m); this.escritas++; },
        async reload() {},
        toJSON() {
            const { update, reload, toJSON, ...resto } = this;
            return resto;
        }
    };
}

async function main() {
    /* ------------------------------------------- 1. carencia da assinatura -- */
    console.log('-- subscriptionAccess (carencia) --');
    const { evaluateAccess } = require('../utils/subscriptionAccess');

    ok('ACTIVE em dia libera',
        evaluateAccess({ status: 'ACTIVE', current_period_end: new Date(+AGORA + 10 * DIA) }, AGORA).allowed);
    ok('ACTIVE vencido ontem ainda tem carencia',
        evaluateAccess({ status: 'ACTIVE', current_period_end: new Date(+AGORA - DIA) }, AGORA).state === 'GRACE');
    ok('ACTIVE vencido ha 5 dias e BLOCKED',
        evaluateAccess({ status: 'ACTIVE', current_period_end: new Date(+AGORA - 5 * DIA) }, AGORA).state === 'BLOCKED');
    ok('ACTIVE sem data nao e cortado por falta de dado',
        evaluateAccess({ status: 'ACTIVE', current_period_end: null }, AGORA).allowed);
    ok('OVERDUE ha 1 dia: restam 2',
        evaluateAccess({ status: 'OVERDUE', overdue_since: new Date(+AGORA - DIA) }, AGORA).daysLeft === 2);
    ok('OVERDUE ha 3 dias corta',
        evaluateAccess({ status: 'OVERDUE', overdue_since: new Date(+AGORA - 3 * DIA) }, AGORA).allowed === false);
    ok('cancelada dentro do periodo segue valendo',
        evaluateAccess({ status: 'ACTIVE', cancel_at_period_end: true,
                         current_period_end: new Date(+AGORA + 5 * DIA) }, AGORA).allowed);
    ok('sem assinatura nega', evaluateAccess(null, AGORA).allowed === false);
    ok('status desconhecido nega', evaluateAccess({ status: 'SEI_LA' }, AGORA).allowed === false);

    /* --------------------------------- 2. operador x cobranca --------------- */
    console.log('');
    console.log('-- acessoInternet (quem manda) --');
    const { bloquear, liberar, descrever,
            MOTIVO_OPERADOR, MOTIVO_INADIMPLENCIA } = require('../services/acessoInternet');

    let c = conexao({});
    ok('corta por inadimplencia', await bloquear(c, MOTIVO_INADIMPLENCIA) === true);
    ok('  motivo gravado', c.internet === false && c.internet_block_reason === 'overdue');
    ok('  data gravada', !!c.internet_blocked_at);
    ok('repetir nao regrava', await bloquear(c, MOTIVO_INADIMPLENCIA) === false);
    ok('pagar libera', await liberar(c, { somenteSeMotivo: MOTIVO_INADIMPLENCIA }) === true);
    ok('  motivo e data limpos',
        c.internet === true && c.internet_block_reason === null && c.internet_blocked_at === null);

    c = conexao({});
    await bloquear(c, MOTIVO_OPERADOR);
    ok('inadimplencia NAO rebaixa corte do operador',
        await bloquear(c, MOTIVO_INADIMPLENCIA) === false && c.internet_block_reason === 'operator');
    ok('pagamento NAO desfaz corte do operador',
        await liberar(c, { somenteSeMotivo: MOTIVO_INADIMPLENCIA }) === false && c.internet === false);
    ok('operador desfaz o proprio corte', await liberar(c) === true && c.internet === true);

    c = conexao({ internet: true, internet_block_reason: 'overdue' });
    await liberar(c);
    ok('limpa motivo orfao', c.internet_block_reason === null);

    ok('motivo invalido explode',
        await bloquear(conexao({}), 'qualquer').then(() => false, () => true));

    ok('descrever: ativa', descrever(conexao({})).texto === 'Internet ativa');
    ok('descrever: inadimplencia',
        descrever(conexao({ internet: false, internet_block_reason: 'overdue' })).motivo === 'overdue');
    ok('descrever: operador',
        descrever(conexao({ internet: false, internet_block_reason: 'operator' })).motivo === 'operator');

    /* --------------------------------- 3. a varredura ----------------------- */
    console.log('');
    console.log('-- vigiaCobranca.varrer --');

    const CONEXOES = [
        conexao({ id: 10, ClientId: 1 }),
        conexao({ id: 11, ClientId: 2 }),
        conexao({ id: 12, ClientId: 3 }),
        conexao({ id: 13, ClientId: 4, internet: false, internet_block_reason: 'overdue' }),
        conexao({ id: 14, ClientId: 5, internet: false, internet_block_reason: 'operator' }),
        conexao({ id: 15, ClientId: 9 }),
        conexao({ id: 16, ClientId: 9, payment_status: 'OVERDUE' }),

        // O caso do checkout web: SEM linha em Subscriptions. Foi cortada por
        // atraso, o cliente pagou, e o rotulo virou PAID. Nenhum caminho de
        // pagamento dessas conexoes chama liberar — se o vigia tambem nao
        // liberar, o corte fica permanente e o cliente paga sem internet.
        conexao({ id: 17, ClientId: 8, internet: false,
                  internet_block_reason: 'overdue', payment_status: 'PAID' }),

        // Mesma situacao, mas o corte foi do operador: pagar nao pode desfazer.
        conexao({ id: 18, ClientId: 8, internet: false,
                  internet_block_reason: 'operator', payment_status: 'PAID' }),

        // Estorno/chargeback numa conexao sem assinatura.
        conexao({ id: 19, ClientId: 8, payment_status: 'REFUNDED' })
    ];

    const ASSINATURAS = [
        { id: 1, ClientId: 1, status: 'ACTIVE',  current_period_end: new Date(+AGORA + 10 * DIA) },
        { id: 2, ClientId: 2, status: 'OVERDUE', overdue_since: new Date(+AGORA - 9 * DIA) },
        { id: 3, ClientId: 3, status: 'OVERDUE', overdue_since: new Date(+AGORA - 1 * DIA) },
        { id: 4, ClientId: 4, status: 'ACTIVE',  current_period_end: new Date(+AGORA + 20 * DIA) },
        { id: 5, ClientId: 5, status: 'ACTIVE',  current_period_end: new Date(+AGORA + 20 * DIA) },
        // Assinatura velha cancelada do MESMO cliente 1: nao pode cortar quem tem
        // outra em dia.
        { id: 6, ClientId: 1, status: 'CANCELED' }
    ];

    const Connection = require('../models/Connection');
    const Subscription = require('../models/Subscription');
    const findAllConn = Connection.findAll;
    const findAllSub = Subscription.findAll;
    Connection.findAll = async () => CONEXOES;
    Subscription.findAll = async () => ASSINATURAS;

    const vigia = require('../services/vigiaCobranca');
    const r = await vigia.varrer(AGORA);

    ok('corta inadimplente fora da carencia',
        CONEXOES[1].internet === false && CONEXOES[1].internet_block_reason === 'overdue');
    ok('NAO corta quem esta na carencia', CONEXOES[2].internet === true);
    ok('NAO mexe em quem esta em dia', CONEXOES[0].internet === true);
    ok('assinatura cancelada velha nao derruba quem tem outra em dia',
        CONEXOES[0].internet === true && CONEXOES[0].escritas === 0);
    ok('devolve a internet de quem pagou', CONEXOES[3].internet === true);
    ok('respeita corte do operador mesmo com pagamento em dia',
        CONEXOES[4].internet === false && CONEXOES[4].internet_block_reason === 'operator');
    ok('ignora conexao sem assinatura e sem atraso',
        CONEXOES[5].internet === true && CONEXOES[5].escritas === 0);
    ok('corta conexao avulsa com payment_status OVERDUE',
        CONEXOES[6].internet === false && CONEXOES[6].internet_block_reason === 'overdue');
    ok('conexao SEM assinatura que pagou recebe a internet de volta',
        CONEXOES[7].internet === true && CONEXOES[7].internet_block_reason === null);
    ok('  mas o corte do operador continua de pe',
        CONEXOES[8].internet === false && CONEXOES[8].internet_block_reason === 'operator');
    ok('estorno corta conexao sem assinatura',
        CONEXOES[9].internet === false && CONEXOES[9].internet_block_reason === 'overdue');
    ok('contagem bate', r.cortadas === 3 && r.liberadas === 2, JSON.stringify(r));

    const antes = CONEXOES.map((x) => x.escritas);
    await vigia.varrer(AGORA);
    ok('segunda passada nao escreve nada (idempotente)',
        CONEXOES.every((x, i) => x.escritas === antes[i]));

    Connection.findAll = findAllConn;
    Subscription.findAll = findAllSub;

    /* --------------------------------- 4. o handler do botao ---------------- */
    console.log('');
    console.log('-- toggleInternet (o botao do painel) --');

    const ctrl = require('../controllers/connectionController');
    const LINHAS = new Map();
    const findByPkOriginal = Connection.findByPk;
    Connection.findByPk = async (id) => LINHAS.get(Number(id)) || null;

    const por = (campos) => { const x = conexao(campos); LINHAS.set(x.id, x); return x; };
    const resposta = () => {
        const res = { codigo: 200, corpo: null };
        res.status = (v) => { res.codigo = v; return res; };
        res.json = (b) => { res.corpo = b; return res; };
        return res;
    };

    por({ id: 1 });
    let res = resposta();
    await ctrl.toggleInternet({ params: { id: 1 }, body: { internet: false } }, res);
    ok('corta quando o corpo pede false', res.codigo === 200 && res.corpo.internet === false);
    ok('  motivo operator', LINHAS.get(1).internet_block_reason === 'operator');
    ok('  devolve o descritivo para a tela',
        res.corpo.acesso && res.corpo.acesso.motivo === 'operator');

    res = resposta();
    await ctrl.toggleInternet({ params: { id: 1 }, body: { internet: true } }, res);
    ok('libera quando o corpo pede true',
        res.corpo.internet === true && LINHAS.get(1).internet_block_reason === null);

    por({ id: 2 });
    res = resposta();
    await ctrl.toggleInternet({ params: { id: 2 }, body: undefined }, res);
    ok('sem corpo ainda inverte (tela velha segue funcionando)', res.corpo.internet === false);

    por({ id: 3, internet: false, internet_block_reason: 'overdue', payment_status: 'OVERDUE' });
    res = resposta();
    await ctrl.toggleInternet({ params: { id: 3 }, body: { internet: true } }, res);
    ok('operador consegue liberar corte automatico', res.corpo.internet === true);
    ok('  e e avisado de que sera cortado de novo',
        typeof res.corpo.aviso === 'string' && res.corpo.aviso.indexOf('cortar') >= 0,
        JSON.stringify(res.corpo.aviso));

    por({ id: 4, internet: false, internet_block_reason: 'operator', payment_status: 'PAID' });
    res = resposta();
    await ctrl.toggleInternet({ params: { id: 4 }, body: { internet: true } }, res);
    ok('sem pendencia nao gera aviso', res.corpo.aviso === null);

    res = resposta();
    await ctrl.toggleInternet({ params: { id: 999 }, body: {} }, res);
    ok('404 para conexao inexistente', res.codigo === 404);

    Connection.findByPk = findByPkOriginal;
}

main()
    .then(() => {
        console.log('');
        console.log(falhas === 0 ? 'Todos passaram' : falhas + ' FALHA(S)');
        process.exit(falhas ? 1 : 0);
    })
    .catch((e) => {
        console.error('ERRO:', e);
        process.exit(1);
    });
