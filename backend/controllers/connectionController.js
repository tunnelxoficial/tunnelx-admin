const Connection = require('../models/Connection');
const Client = require('../models/Client');
const Plan = require('../models/Plan');

// Define associations if not defined elsewhere
Client.hasMany(Connection, { foreignKey: 'ClientId' });
Connection.belongsTo(Client, { foreignKey: 'ClientId' });
Plan.hasMany(Connection, { foreignKey: 'PlanId' });
Connection.belongsTo(Plan, { foreignKey: 'PlanId' });

exports.getAll = async (req, res) => {
    try {
        const connections = await Connection.findAll({
            include: [
                { model: Client, attributes: ['name', 'email', 'cpf', 'whatsapp'] },
                { model: Plan, attributes: ['name', 'dataLimit'] }
            ]
        });
        res.json(connections);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar conexões.' });
    }
};

exports.create = async (req, res) => {
    try {
        const { name, cpf, phone, email, status, clientId, planId } = req.body;
        
        let clientData = { name, cpf, phone, email };
        let finalDataLimit = 0;
        let finalTotalConnections = 1;

        if (clientId) {
            const client = await Client.findByPk(clientId);
            if (client) {
                clientData = {
                    name: client.name,
                    cpf: client.cpf,
                    phone: client.whatsapp,
                    email: client.email
                };
            }
        }

        if (planId) {
            const plan = await Plan.findByPk(planId);
            if (plan) {
                finalDataLimit = plan.dataLimit;
                finalTotalConnections = plan.total_connections;
            }
        }

        // Status queue defaults to WAIT, config and qrcode defaults to null as requested
        const newConnection = await Connection.create({
            name: clientData.name,
            cpf: clientData.cpf,
            phone: clientData.phone,
            email: clientData.email,
            total_connections: finalTotalConnections,
            data_limit: finalDataLimit,
            status: status || 'payment_pending',
            ClientId: clientId,
            PlanId: planId
        });

        res.status(201).json(newConnection);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar conexão.' });
    }
};

exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, cpf, phone, email, status, internet, clientId, planId } = req.body;

        const connection = await Connection.findByPk(id);
        if (!connection) {
            return res.status(404).json({ message: 'Conexão não encontrada.' });
        }

        let clientData = { name, cpf, phone, email };
        let finalDataLimit = connection.data_limit;
        let finalTotalConnections = connection.total_connections;

        if (clientId) {
            const client = await Client.findByPk(clientId);
            if (client) {
                clientData = {
                    name: client.name,
                    cpf: client.cpf,
                    phone: client.whatsapp,
                    email: client.email
                };
            }
        }

        if (planId) {
            const plan = await Plan.findByPk(planId);
            if (plan) {
                finalDataLimit = plan.dataLimit;
                finalTotalConnections = plan.total_connections;
            }
        }

        await connection.update({
            name: clientData.name,
            cpf: clientData.cpf,
            phone: clientData.phone,
            email: clientData.email,
            total_connections: finalTotalConnections,
            data_limit: finalDataLimit,
            status,
            internet,
            ClientId: clientId,
            PlanId: planId
        });

        res.json(connection);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao atualizar conexão.' });
    }
};

exports.delete = async (req, res) => {
    try {
        const { id } = req.params;
        const connection = await Connection.findByPk(id);
        
        if (!connection) {
            return res.status(404).json({ message: 'Conexão não encontrada.' });
        }

        await connection.destroy();
        res.json({ message: 'Conexão removida com sucesso.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao remover conexão.' });
    }
};

exports.toggleInternet = async (req, res) => {
    try {
        const { id } = req.params;
        const connection = await Connection.findByPk(id);
        
        if (!connection) {
            return res.status(404).json({ message: 'Conexão não encontrada.' });
        }

        await connection.update({ internet: !connection.internet });
        res.json(connection);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao alterar status da internet.' });
    }
};
