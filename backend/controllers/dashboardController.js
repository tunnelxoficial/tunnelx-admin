const Client = require('../models/Client');
const Product = require('../models/Product');
const Stock = require('../models/Stock');
const Plan = require('../models/Plan');
const Connection = require('../models/Connection');
const { Op } = require('sequelize');

const dashboardController = {
    getStats: async (req, res) => {
        try {
            // Clients Stats
            const totalClients = await Client.count();

            // Connections Stats
            const activeConnections = await Connection.count({ where: { status: 'active' } });
            const totalConnections = await Connection.count();

            // Stock Stats
            const stocks = await Stock.findAll({
                include: [{
                    model: Product,
                    attributes: ['valor', 'descricao']
                }]
            });

            let totalStockValue = 0;
            let lowStockItems = [];

            stocks.forEach(item => {
                const quantity = item.quantity || 0;
                const price = item.Product ? parseFloat(item.Product.valor) : 0;
                
                totalStockValue += quantity * price;

                if (quantity < 10) {
                    lowStockItems.push({
                        id: item.stockId || item.id, // Fallback
                        product: item.Product ? item.Product.descricao : 'Desconhecido',
                        quantity: quantity
                    });
                }
            });

            // Plans Stats
            const totalPlans = await Plan.count();

            // Products Stats
            const totalProducts = await Product.count();

            res.json({
                clients: {
                    total: totalClients
                },
                connections: {
                    total: totalConnections,
                    active: activeConnections
                },
                stock: {
                    totalValue: totalStockValue,
                    lowStockCount: lowStockItems.length,
                    lowStockList: lowStockItems.slice(0, 5) // Top 5 low stock items
                },
                plans: {
                    total: totalPlans
                },
                products: {
                    total: totalProducts
                }
            });

        } catch (error) {
            console.error('Erro ao buscar dados do dashboard:', error);
            res.status(500).json({ error: 'Erro ao buscar dados do dashboard' });
        }
    }
};

module.exports = dashboardController;
