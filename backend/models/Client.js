const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const bcrypt = require('bcryptjs');

const Client = sequelize.define('Client', {
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
        allowNull: true
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            isEmail: true
        }
    },
    whatsapp: {
        type: DataTypes.STRING,
        allowNull: false
    },
    cep: {
        type: DataTypes.STRING,
        allowNull: true
    },
    uf: {
        type: DataTypes.STRING(2),
        allowNull: true
    },
    cidade: {
        type: DataTypes.STRING,
        allowNull: true
    },
    bairro: {
        type: DataTypes.STRING,
        allowNull: true
    },
    logradouro: {
        type: DataTypes.STRING,
        allowNull: true
    },
    complemento: {
        type: DataTypes.STRING,
        allowNull: true
    },
    password_hash: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    timestamps: true,
    hooks: {
        beforeCreate: async (client) => {
            if (!client.password_hash) {
                const salt = await bcrypt.genSalt(10);
                client.password_hash = await bcrypt.hash('123456', salt);
            }
        }
    }
});

module.exports = Client;
