const { sequelize } = require('../config/db');

async function up() {
    try {
        await sequelize.authenticate();
        console.log('Connection has been established successfully.');

        // Add PlanId column to Connections
        try {
            // Check if column exists first or just try to add it
            // MSSQL: ALTER TABLE Connections ADD PlanId INTEGER NULL;
            await sequelize.query('ALTER TABLE Connections ADD PlanId INTEGER NULL;');
            console.log('Added PlanId column to Connections table.');
            
            // Optional: Add Foreign Key constraint
            // We need to be careful about the schema of Plans table. It is 'tunnelx.Plans'.
            try {
                await sequelize.query(`
                    ALTER TABLE Connections 
                    ADD CONSTRAINT FK_Connections_Plans 
                    FOREIGN KEY (PlanId) 
                    REFERENCES tunnelx.Plans(id);
                `);
                console.log('Added Foreign Key constraint FK_Connections_Plans.');
            } catch (fkError) {
                console.log('Could not add FK constraint (might already exist or other issue):', fkError.message);
            }

        } catch (e) {
            console.log('PlanId column might already exist or error:', e.message);
        }

    } catch (error) {
        console.error('Unable to connect to the database:', error);
    } finally {
        await sequelize.close();
    }
}

up();
