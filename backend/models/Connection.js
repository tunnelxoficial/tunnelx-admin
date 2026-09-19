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
    data_limit: { // Pacote de dados (1MB - 1000MB)
        type: DataTypes.INTEGER,
        allowNull: false
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'payment_pending' // active, inactive, payment_pending
    },
    internet: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    config: {
        type: DataTypes.TEXT('long'), // VARCHAR(MAX) equivalent in Sequelize for MSSQL
        allowNull: true
    },
    qrcode: {
        type: DataTypes.BLOB, // Imagem
        allowNull: true
    },
    status_queue: {
        type: DataTypes.ENUM('WAIT', 'CREATED'),
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
