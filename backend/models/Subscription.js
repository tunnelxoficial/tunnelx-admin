const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * Assinatura do cliente — a fonte da verdade sobre quem pode usar o aplicativo.
 *
 * Por que uma tabela nova, e nao mais colunas em Connection: a assinatura existe
 * ANTES da conexao. O cliente escolhe o plano e paga, e so entao a conexao e
 * criada e entra na fila do provisionador. Guardar o pagamento dentro de
 * Connection obrigaria a criar uma conexao vazia so para ter onde anotar a
 * cobranca - e ela ja entraria na fila do worker sem estar paga.
 *
 * Tambem separa os ciclos de vida: cancelar a assinatura nao apaga a conexao
 * (ela morre no fim do periodo pago), e trocar de plano nao recria o tunel.
 */
const Subscription = sequelize.define('Subscription', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    ClientId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Clients', key: 'id' }
    },
    PlanId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Plans', key: 'id' }
    },

    /**
     * CREDIT_CARD  -> assinatura Asaas comum, debitada sozinha todo ciclo.
     * PIX          -> Pix Automatico: o cliente autoriza uma vez no app do
     *                 banco e o Asaas passa a debitar sozinho.
     */
    billing_type: {
        type: DataTypes.STRING,
        allowNull: false
    },

    /**
     * Ciclo de vida:
     *   PENDING   - criada, aguardando o primeiro pagamento/autorizacao
     *   ACTIVE    - em dia, cliente usa o app
     *   OVERDUE   - venceu e nao pagou; durante a carencia ainda usa, com aviso
     *   BLOCKED   - carencia esgotada, app bloqueado
     *   CANCELED  - encerrada (por cancelamento ou estorno)
     */
    status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'PENDING'
    },

    asaas_customer_id: { type: DataTypes.STRING, allowNull: true },

    /** Assinatura Asaas (cartao) — é o que se cancela para parar as cobranças. */
    asaas_subscription_id: { type: DataTypes.STRING, allowNull: true },

    /** Autorizacao do Pix Automatico — o equivalente da assinatura no PIX. */
    pix_authorization_id: { type: DataTypes.STRING, allowNull: true },

    /**
     * Cartao tokenizado. O numero NUNCA e guardado aqui: o Asaas devolve este
     * token na primeira cobranca e ele substitui os dados do cartao nas
     * proximas. E o que permite o debito automatico sem repedir nada ao cliente.
     */
    credit_card_token: { type: DataTypes.STRING, allowNull: true },

    /** Ultimos 4 digitos e bandeira, so para a tela dizer "Visa •••• 4242". */
    card_last4: { type: DataTypes.STRING(4), allowNull: true },
    card_brand: { type: DataTypes.STRING, allowNull: true },

    /**
     * Fim do periodo ja pago. Manda em duas decisoes:
     *   - cancelamento: o acesso vai ate esta data, nao acaba no clique
     *   - carencia: a contagem dos 3 dias comeca aqui
     */
    current_period_end: { type: DataTypes.DATE, allowNull: true },

    /**
     * Quando a inadimplencia comecou. NULL enquanto estiver em dia.
     * A carencia e medida a partir daqui — ver utils/subscriptionAccess.js.
     */
    overdue_since: { type: DataTypes.DATE, allowNull: true },

    /**
     * Cancelou, mas segue valendo ate current_period_end. A assinatura no Asaas
     * ja esta INACTIVE (nao gera novas cobrancas) e o acesso continua ate o fim
     * do que foi pago.
     */
    cancel_at_period_end: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    canceled_at: { type: DataTypes.DATE, allowNull: true },

    /** Ultima cobranca vista, para o app mostrar QR/link de pagamento pendente. */
    last_payment_id: { type: DataTypes.STRING, allowNull: true },
    last_payment_status: { type: DataTypes.STRING, allowNull: true }
}, {
    timestamps: true,
    indexes: [
        { fields: ['ClientId'] },
        { fields: ['asaas_subscription_id'] },
        { fields: ['pix_authorization_id'] }
    ]
});

module.exports = Subscription;
