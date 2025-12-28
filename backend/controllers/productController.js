const Product = require('../models/Product');

const productController = {
    // Listar todos os produtos
    getAll: async (req, res) => {
        try {
            const products = await Product.findAll({
                order: [['createdAt', 'DESC']]
            });
            res.json(products);
        } catch (error) {
            console.error('Erro ao buscar produtos:', error);
            res.status(500).json({ error: 'Erro ao buscar produtos' });
        }
    },

    // Criar novo produto
    create: async (req, res) => {
        try {
            const { tipo, descricao, valor } = req.body;
            
            if (!tipo || !descricao || !valor) {
                return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
            }

            const newProduct = await Product.create({
                tipo,
                descricao,
                valor
            });

            res.status(201).json(newProduct);
        } catch (error) {
            console.error('Erro ao criar produto:', error);
            res.status(500).json({ error: 'Erro ao criar produto' });
        }
    },

    // Atualizar produto
    update: async (req, res) => {
        try {
            const { id } = req.params;
            const { tipo, descricao, valor } = req.body;

            const product = await Product.findByPk(id);

            if (!product) {
                return res.status(404).json({ error: 'Produto não encontrado' });
            }

            await product.update({
                tipo,
                descricao,
                valor
            });

            res.json(product);
        } catch (error) {
            console.error('Erro ao atualizar produto:', error);
            res.status(500).json({ error: 'Erro ao atualizar produto' });
        }
    },

    // Deletar produto
    delete: async (req, res) => {
        try {
            const { id } = req.params;
            const product = await Product.findByPk(id);

            if (!product) {
                return res.status(404).json({ error: 'Produto não encontrado' });
            }

            await product.destroy();
            res.json({ message: 'Produto removido com sucesso' });
        } catch (error) {
            console.error('Erro ao deletar produto:', error);
            res.status(500).json({ error: 'Erro ao deletar produto' });
        }
    }
};

module.exports = productController;
