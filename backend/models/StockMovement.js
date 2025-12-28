const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const Stock = require('./Stock');

const StockMovement = sequelize.define('StockMovement', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    stockId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: Stock,
            key: 'id'
        }
    },
    type: {
        type: DataTypes.STRING, // 'ENTRY' or 'EXIT'
        allowNull: false
    },
    quantity: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    reason: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    schema: 'tunnelx',
    tableName: 'StockMovements',
    timestamps: true
});

StockMovement.belongsTo(Stock, { foreignKey: 'stockId' });
Stock.hasMany(StockMovement, { foreignKey: 'stockId' });

module.exports = StockMovement;
