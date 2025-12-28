const Connection = require('../models/Connection');

exports.getAll = async (req, res) => {
    try {
        const connections = await Connection.findAll();
        res.json(connections);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar conexões.' });
    }
};

exports.create = async (req, res) => {
    try {
        const { name, cpf, phone, email, total_connections, data_limit } = req.body;
        
        // Status queue defaults to WAIT, config and qrcode defaults to null as requested
        const newConnection = await Connection.create({
            name,
            cpf,
            phone,
            email,
            total_connections,
            data_limit
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
        const { name, cpf, phone, email, total_connections, data_limit, status, internet } = req.body;

        const connection = await Connection.findByPk(id);
        if (!connection) {
            return res.status(404).json({ message: 'Conexão não encontrada.' });
        }

        await connection.update({
            name,
            cpf,
            phone,
            email,
            total_connections,
            data_limit,
            status,
            internet
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
