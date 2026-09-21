const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const Client = require('./Client');
const Plan = require('./Plan');

const Connection = sequelize.define('Connection', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    cpf: {
        type: DataTypes.STRING,
        allowNull: false
    },
    phone: {
        type: DataTypes.STRING,
        allowNull: false
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            isEmail: true
        }
    },
    total_connections: {
        type: DataTypes.INTEGER,
        defaultValue: 1
    },
    /**
     * VELOCIDADE contratada nesta conexao, em megabits por segundo.
     *
     * Copiada do plano na contratacao. O comentario anterior dizia "Pacote de
     * dados (1MB - 1000MB)" e estava errado: o numero sempre foi taxa, nao
     * volume. A confusao chegou ate a tela do cliente, que anunciava
     * "50 MB de velocidade".
     */
    data_limit: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'payment_pending' // active, inactive, payment_pending
    },
    /*
     * Estado EFETIVO de acesso: e este campo que o provisionador le para decidir
     * se o peer fica ou sai do tunel. Nao e mais enfeite.
     */
    internet: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    /*
     * Por que esta cortado: 'operator' (mao do operador) ou 'overdue' (falta de
     * pagamento). Nulo quando a internet esta ligada.
     *
     * Existe para as duas decisoes nao se atropelarem: o pagamento so desfaz um
     * corte 'overdue'. Um corte que o operador fez de proposito continua de pe
     * mesmo que uma cobranca antiga seja confirmada depois.
     */
    internet_block_reason: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    /** Desde quando esta cortado — primeira pergunta de todo atendimento. */
    internet_blocked_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    config: {
        type: DataTypes.TEXT('long'), // VARCHAR(MAX) equivalent in Sequelize for MSSQL
        allowNull: true
    },
    qrcode: {
        type: DataTypes.BLOB, // Imagem
        allowNull: true
    },
    /**
     * Estado na fila de provisionamento.
     *
     *   WAIT        aguardando o provisionador
     *   PROCESSING  reivindicada por uma instancia (claim atomico)
     *   CREATED     peer criado e config gravada
     *   FAILED      falhou 5 vezes; para de girar ate alguem olhar
     *
     * PROCESSING e FAILED nasceram com o claim atomico. Sem o estado
     * intermediario, duas instancias liam a mesma linha e provisionavam o
     * mesmo cliente duas vezes; sem FAILED, um erro permanente voltava para
     * a fila a cada 60 segundos e escondia as linhas boas atras dele.
     */
    status_queue: {
        type: DataTypes.ENUM('WAIT', 'PROCESSING', 'CREATED', 'FAILED'),
        defaultValue: 'WAIT'
    },
    ClientId: {
        type: DataTypes.INTEGER,
        references: {
            model: 'Clients',
            key: 'id'
        }
    },
    PlanId: {
        type: DataTypes.INTEGER,
        references: {
            model: 'Plans',
            key: 'id'
        },
        allowNull: true
    },
    asaas_customer_id: {
        type: DataTypes.STRING,
        allowNull: true
    },
    asaas_subscription_id: {
        type: DataTypes.STRING,
        allowNull: true
    },
    asaas_payment_id: {
        type: DataTypes.STRING,
        allowNull: true
    },
    payment_status: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    timestamps: true
});

/*
 * Associacoes no modelo, e nao num controller.
 *
 * Elas moravam em controllers/connectionController.js, e isso quebrava por
 * ordem de carregamento: quem faz `include: [Plan]` so funciona se aquele
 * controller do painel tiver sido exigido antes. /app/connections passou a
 * depender de um arquivo que nao tem nada a ver com ele — e a falha aparece
 * como "Plan is not associated to Connection", em runtime, so na rota.
 */
Connection.belongsTo(Client, { foreignKey: 'ClientId' });
Client.hasMany(Connection, { foreignKey: 'ClientId' });
Connection.belongsTo(Plan, { foreignKey: 'PlanId' });
Plan.hasMany(Connection, { foreignKey: 'PlanId' });

module.exports = Connection;
