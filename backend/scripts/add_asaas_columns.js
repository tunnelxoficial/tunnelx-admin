const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { sequelize } = require('../config/db');

async function up() {
    const queryInterface = sequelize.getQueryInterface();
    try {
        await queryInterface.addColumn('Connections', 'asaas_customer_id', {
            type: sequelize.Sequelize.STRING,
            allowNull: true
        });
        await queryInterface.addColumn('Connections', 'asaas_subscription_id', {
            type: sequelize.Sequelize.STRING,
            allowNull: true
        });
        await queryInterface.addColumn('Connections', 'asaas_payment_id', {
            type: sequelize.Sequelize.STRING,
            allowNull: true
        });
        await queryInterface.addColumn('Connections', 'payment_status', {
            type: sequelize.Sequelize.STRING,
            allowNull: true
        });
        console.log('Columns added successfully');
    } catch (error) {
        console.error('Error adding columns:', error);
    } finally {
        await sequelize.close();
    }
}

up();
