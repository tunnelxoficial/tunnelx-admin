/**
 * Quem pode usar o aplicativo, e por quê.
 *
 * Esta é a ÚNICA função que decide isso. O app também precisa saber (para
 * mostrar aviso ou tela de bloqueio), mas ele recebe a resposta pronta daqui em
 * vez de recalcular: duas implementações da mesma regra divergem no primeiro
 * ajuste, e divergir aqui significa app liberado com assinatura vencida — ou
 * cliente em dia vendo tela de bloqueio.
 */

/** Dias de tolerância depois do vencimento antes de bloquear o app. */
const DIAS_DE_CARENCIA = 3;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * @param {object|null} sub  a assinatura do cliente, ou null se não tem
 * @param {Date} [agora]     injetável para teste
 * @returns {{
 *   allowed: boolean,          // pode usar as conexões?
 *   state: string,             // NONE | PENDING | ACTIVE | GRACE | BLOCKED | CANCELED
 *   daysLeft: number|null,     // dias restantes de carência, quando em GRACE
 *   message: string|null       // texto pronto para o app exibir
 * }}
 */
function evaluateAccess(sub, agora = new Date()) {
    if (!sub) {
        return {
            allowed: false,
            state: 'NONE',
            daysLeft: null,
            message: 'Escolha um plano para ativar sua conexão.'
        };
    }

    if (sub.status === 'CANCELED') {
        return {
            allowed: false,
            state: 'CANCELED',
            daysLeft: null,
            message: 'Sua assinatura foi encerrada. Escolha um plano para voltar a usar.'
        };
    }

    if (sub.status === 'PENDING') {
        return {
            allowed: false,
            state: 'PENDING',
            daysLeft: null,
            message: sub.billing_type === 'PIX'
                ? 'Conclua a autorização do Pix no app do seu banco para liberar o acesso.'
                : 'Estamos confirmando seu pagamento. Isso costuma levar alguns instantes.'
        };
    }

    // Cancelada mas dentro do período pago: continua valendo até o fim.
    if (sub.cancel_at_period_end && sub.current_period_end) {
        if (new Date(sub.current_period_end) > agora) {
            return {
                allowed: true,
                state: 'ACTIVE',
                daysLeft: null,
                message: 'Sua assinatura foi cancelada e vale até ' +
                    formatarData(sub.current_period_end) + '.'
            };
        }
        return {
            allowed: false,
            state: 'CANCELED',
            daysLeft: null,
            message: 'Sua assinatura terminou. Escolha um plano para voltar a usar.'
        };
    }

    if (sub.status === 'OVERDUE' || sub.status === 'BLOCKED') {
        // A carência conta do vencimento, não de quando o webhook chegou: um
        // webhook atrasado não pode render dias extras de acesso.
        return emAtraso(sub.overdue_since ? new Date(sub.overdue_since) : agora, agora);
    }

    if (sub.status === 'ACTIVE') {
        /*
         * ACTIVE com período vencido também é atraso.
         *
         * Antes este ramo devolvia allowed:true sem olhar a data, e o único
         * caminho para OVERDUE era o webhook PAYMENT_OVERDUE do Asaas chegar.
         * Webhook que não chega — token trocado, endpoint fora do ar, evento não
         * assinado no painel — deixava a assinatura ACTIVE para sempre: período
         * encerrado há meses e acesso liberado, sem ninguém perceber.
         *
         * A carência é a mesma, contada do fim do período. Só vale quando a data
         * existe: sem ela não há o que comparar, e presumir atraso cortaria
         * cliente em dia por falta de dado.
         */
        if (sub.current_period_end && new Date(sub.current_period_end) < agora) {
            return emAtraso(new Date(sub.current_period_end), agora);
        }

        return { allowed: true, state: 'ACTIVE', daysLeft: null, message: null };
    }

    // Status desconhecido: nega. Num controle de acesso, o caso não previsto
    // fecha a porta em vez de abrir.
    return {
        allowed: false,
        state: 'NONE',
        daysLeft: null,
        message: 'Não foi possível verificar sua assinatura. Fale com o suporte.'
    };
}

/**
 * Pagamento vencido: carência primeiro, bloqueio depois.
 *
 * @param {Date} inicio  quando o atraso começou (vencimento, não detecção)
 * @param {Date} agora
 */
function emAtraso(inicio, agora) {
    const diasCorridos = Math.floor((agora - inicio) / MS_POR_DIA);
    const restantes = DIAS_DE_CARENCIA - diasCorridos;

    if (restantes > 0) {
        return {
            allowed: true,
            state: 'GRACE',
            daysLeft: restantes,
            message: restantes === 1
                ? 'Pagamento em atraso. Regularize hoje para não perder o acesso.'
                : `Pagamento em atraso. Você tem ${restantes} dias para regularizar.`
        };
    }

    return {
        allowed: false,
        state: 'BLOCKED',
        daysLeft: 0,
        message: 'Acesso bloqueado por falta de pagamento. Regularize para voltar a usar.'
    };
}

function formatarData(d) {
    const data = new Date(d);
    return String(data.getDate()).padStart(2, '0') + '/' +
        String(data.getMonth() + 1).padStart(2, '0') + '/' +
        data.getFullYear();
}

module.exports = { evaluateAccess, DIAS_DE_CARENCIA };
