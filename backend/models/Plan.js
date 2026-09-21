const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Plan = sequelize.define('Plan', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    description: {
        type: DataTypes.STRING,
        allowNull: true
    },
    cycle: {
        type: DataTypes.STRING, // e.g., 'Mensal', 'Trimestral', 'Anual'
        allowNull: false
    },
    price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    /**
     * VELOCIDADE do plano, em megabits por segundo.
     *
     * O nome da coluna e historico e enganoso: nunca foi pacote de dados. Os
     * valores vendidos hoje sao 8, 16 e 50 — as faixas de uma operadora
     * brasileira. Megabyte e quantidade; aqui o numero e taxa.
     */
    dataLimit: {
        type: DataTypes.INTEGER, // Mbps
        allowNull: false
    },
    total_connections: {
        type: DataTypes.INTEGER,
        defaultValue: 1
    },
    product_ids: {
        type: DataTypes.TEXT, // JSON string: "[1, 2, 3]"
        allowNull: true
    }
}, {
    schema: 'tunnelx',
    tableName: 'Plans',
    timestamps: true
});

module.exports = Plan;
