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
    dataLimit: {
        type: DataTypes.INTEGER, // MB
        allowNull: false
    }
}, {
    schema: 'tunnelx',
    tableName: 'Plans',
    timestamps: true
});

module.exports = Plan;
