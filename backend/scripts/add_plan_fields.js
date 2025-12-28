const { sequelize } = require('../config/db');

async function up() {
    try {
        await sequelize.authenticate();
        console.log('Connection has been established successfully.');

        // Add total_connections column
        try {
            await sequelize.query('ALTER TABLE Plans ADD total_connections INTEGER DEFAULT 1;');
            console.log('Added total_connections column.');
        } catch (e) {
            console.log('total_connections column might already exist or error:', e.message);
        }

        // Add product_ids column
        try {
            await sequelize.query('ALTER TABLE Plans ADD product_ids NVARCHAR(MAX);');
             console.log('Added product_ids column.');
        } catch (e) {
            console.log('product_ids column might already exist or error:', e.message);
        }

    } catch (error) {
        console.error('Unable to connect to the database:', error);
    } finally {
        await sequelize.close();
    }
}

up();
