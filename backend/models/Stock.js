const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const Product = require('./Product');

const Stock = sequelize.define('Stock', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    productId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: Product,
            key: 'id'
        },
        unique: true // Ensure one stock record per product for now
    },
    quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    }
}, {
    schema: 'tunnelx',
    tableName: 'Stocks',
    timestamps: true
});

Stock.belongsTo(Product, { foreignKey: 'productId' });
Product.hasOne(Stock, { foreignKey: 'productId' });

module.exports = Stock;
