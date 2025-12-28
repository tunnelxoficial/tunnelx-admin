const Stock = require('../models/Stock');
const Product = require('../models/Product');
const StockMovement = require('../models/StockMovement');

const stockController = {
    // Listar todo o estoque com dados do produto
    getAll: async (req, res) => {
        try {
            const stocks = await Stock.findAll({
                include: [{
                    model: Product,
                    attributes: ['id', 'descricao', 'tipo', 'valor']
                }],
                order: [['updatedAt', 'DESC']]
            });
            res.json(stocks);
        } catch (error) {
            console.error('Erro ao buscar estoque:', error);
            res.status(500).json({ error: 'Erro ao buscar estoque' });
        }
    },

    // Registrar movimentação (Entrada/Saída)
    registerMovement: async (req, res) => {
        try {
            const { id } = req.params;
            const { type, quantity, reason } = req.body;

            if (!['ENTRY', 'EXIT'].includes(type) || !quantity || quantity <= 0) {
                return res.status(400).json({ error: 'Dados inválidos para movimentação' });
            }

            const stock = await Stock.findByPk(id);
            if (!stock) {
                return res.status(404).json({ error: 'Registro de estoque não encontrado' });
            }

            let newQuantity = stock.quantity;
            if (type === 'ENTRY') {
                newQuantity += parseInt(quantity);
            } else {
                if (stock.quantity < quantity) {
                    return res.status(400).json({ error: 'Estoque insuficiente para saída' });
                }
                newQuantity -= parseInt(quantity);
            }

            // Update stock
            await stock.update({ quantity: newQuantity });

            // Create movement record
            await StockMovement.create({
                stockId: id,
                type,
                quantity,
                reason
            });

            // Return updated stock
            const updated = await Stock.findByPk(id, { include: [Product] });
            res.json(updated);

        } catch (error) {
            console.error('Erro ao registrar movimentação:', error);
            res.status(500).json({ error: 'Erro ao registrar movimentação' });
        }
    },

    // Buscar histórico de movimentações
    getHistory: async (req, res) => {
        try {
            const { id } = req.params;
            
            const history = await StockMovement.findAll({
                where: { stockId: id },
                order: [['createdAt', 'DESC']]
            });

            res.json(history);
        } catch (error) {
            console.error('Erro ao buscar histórico:', error);
            res.status(500).json({ error: 'Erro ao buscar histórico' });
        }
    },

    // Criar ou atualizar estoque (Legado/Inicialização)
    create: async (req, res) => {
        try {
            const { productId, quantity } = req.body;
            
            if (!productId || quantity === undefined) {
                return res.status(400).json({ error: 'Produto e quantidade são obrigatórios' });
            }

            // Check if stock already exists
            const existingStock = await Stock.findOne({ where: { productId } });

            if (existingStock) {
                // Update existing
                await existingStock.update({ quantity });
                // Fetch with product for response
                const updated = await Stock.findByPk(existingStock.id, {
                    include: [Product]
                });
                return res.json(updated);
            }

            // Create new
            const newStock = await Stock.create({
                productId,
                quantity
            });

            const created = await Stock.findByPk(newStock.id, {
                include: [Product]
            });

            res.status(201).json(created);
        } catch (error) {
            console.error('Erro ao criar estoque:', error);
            res.status(500).json({ error: 'Erro ao criar estoque' });
        }
    },

    // Atualizar quantidade (pode ser usado via PUT /:id)
    update: async (req, res) => {
        try {
            const { id } = req.params;
            const { quantity } = req.body;

            const stock = await Stock.findByPk(id);

            if (!stock) {
                return res.status(404).json({ error: 'Registro de estoque não encontrado' });
            }

            await stock.update({ quantity });
            
            const updated = await Stock.findByPk(id, { include: [Product] });
            res.json(updated);
        } catch (error) {
            console.error('Erro ao atualizar estoque:', error);
            res.status(500).json({ error: 'Erro ao atualizar estoque' });
        }
    },

    // Deletar registro de estoque
    delete: async (req, res) => {
        try {
            const { id } = req.params;
            const stock = await Stock.findByPk(id);

            if (!stock) {
                return res.status(404).json({ error: 'Registro de estoque não encontrado' });
            }

            await stock.destroy();
            res.json({ message: 'Registro de estoque removido' });
        } catch (error) {
            console.error('Erro ao deletar estoque:', error);
            res.status(500).json({ error: 'Erro ao deletar estoque' });
        }
    }
};

module.exports = stockController;
