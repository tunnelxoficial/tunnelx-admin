const Connection = require('../models/Connection');
const Client = require('../models/Client');

// Define associations if not defined elsewhere
Client.hasMany(Connection, { foreignKey: 'ClientId' });
Connection.belongsTo(Client, { foreignKey: 'ClientId' });

exports.getAll = async (req, res) => {
    try {
        const connections = await Connection.findAll({
            include: [{ model: Client, attributes: ['name', 'email', 'cpf', 'whatsapp'] }]
        });
        res.json(connections);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar conexões.' });
    }
};

exports.create = async (req, res) => {
    try {
        const { name, cpf, phone, email, total_connections, data_limit, clientId } = req.body;
        
        let clientData = { name, cpf, phone, email };

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

        // Status queue defaults to WAIT, config and qrcode defaults to null as requested
        const newConnection = await Connection.create({
            name: clientData.name,
            cpf: clientData.cpf,
            phone: clientData.phone,
            email: clientData.email,
            total_connections,
            data_limit,
            ClientId: clientId
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
        const { name, cpf, phone, email, total_connections, data_limit, status, internet, clientId } = req.body;

        const connection = await Connection.findByPk(id);
        if (!connection) {
            return res.status(404).json({ message: 'Conexão não encontrada.' });
        }

        let clientData = { name, cpf, phone, email };

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

        await connection.update({
            name: clientData.name,
            cpf: clientData.cpf,
            phone: clientData.phone,
            email: clientData.email,
            total_connections,
            data_limit,
            status,
            internet,
            ClientId: clientId
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
