const Client = require('../models/Client');

exports.getAll = async (req, res) => {
    try {
        const clients = await Client.findAll();
        res.json(clients);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar clientes.' });
    }
};

exports.create = async (req, res) => {
    try {
        const { name, cpf, email, whatsapp, cep, uf, cidade, bairro, logradouro, complemento } = req.body;
        
        const newClient = await Client.create({
            name,
            cpf,
            email,
            whatsapp,
            cep,
            uf,
            cidade,
            bairro,
            logradouro,
            complemento
        });

        res.status(201).json(newClient);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar cliente.' });
    }
};

exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, cpf, email, whatsapp, cep, uf, cidade, bairro, logradouro, complemento } = req.body;

        const client = await Client.findByPk(id);
        if (!client) {
            return res.status(404).json({ message: 'Cliente não encontrado.' });
        }

        await client.update({
            name,
            cpf,
            email,
            whatsapp,
            cep,
            uf,
            cidade,
            bairro,
            logradouro,
            complemento
        });

        res.json(client);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao atualizar cliente.' });
    }
};

exports.delete = async (req, res) => {
    try {
        const { id } = req.params;
        const client = await Client.findByPk(id);
        
        if (!client) {
            return res.status(404).json({ message: 'Cliente não encontrado.' });
        }

        await client.destroy();
        res.json({ message: 'Cliente removido com sucesso.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao remover cliente.' });
    }
};
