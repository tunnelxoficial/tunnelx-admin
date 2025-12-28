const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

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
        defaultValue: 'active' // active, inactive
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
    }
}, {
    timestamps: true
});

module.exports = Connection;
