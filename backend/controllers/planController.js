const Plan = require('../models/Plan');
const Connection = require('../models/Connection');
const Product = require('../models/Product');
const Stock = require('../models/Stock');

const planController = {
    // List all plans
    getAll: async (req, res) => {
        try {
            const plans = await Plan.findAll({
                order: [['name', 'ASC']]
            });

            // Parse product_ids and fetch product details for each plan
            const plansWithProducts = await Promise.all(plans.map(async (plan) => {
                const planJson = plan.toJSON();
                let products = [];
                if (plan.product_ids) {
                    try {
                        const ids = JSON.parse(plan.product_ids);
                        if (Array.isArray(ids) && ids.length > 0) {
                            products = await Product.findAll({
                                where: {
                                    id: ids
                                },
                                include: [{ model: Stock }]
                            });
                        }
                    } catch (e) {
                        console.error('Error parsing product_ids for plan', plan.id, e);
                    }
                }
                planJson.products = products;
                return planJson;
            }));

            // Filter plans based on stock availability
            const availablePlans = plansWithProducts.filter(plan => {
                // If no products, it's always available
                if (!plan.products || plan.products.length === 0) {
                    return true;
                }

                // If has products, check if ALL are in stock
                const allProductsInStock = plan.products.every(product => {
                    return product.Stock && product.Stock.quantity > 0;
                });

                return allProductsInStock;
            });

            res.json(availablePlans);
        } catch (error) {
            console.error('Erro ao buscar planos:', error);
            res.status(500).json({ error: 'Erro ao buscar planos' });
        }
    },

    // Create a new plan
    create: async (req, res) => {
        try {
            const { name, description, cycle, price, dataLimit, total_connections,
                    product_ids, aplicarNasConexoes } = req.body;

            if (!name || !cycle || !price || !dataLimit) {
                return res.status(400).json({ error: 'Nome, ciclo, valor e pacote de dados são obrigatórios' });
            }

            const newPlan = await Plan.create({
                name,
                description,
                cycle,
                price,
                dataLimit,
                total_connections: total_connections || 1,
                product_ids: JSON.stringify(product_ids || [])
            });

            res.status(201).json(newPlan);
        } catch (error) {
            console.error('Erro ao criar plano:', error);
            res.status(500).json({ error: 'Erro ao criar plano' });
        }
    },

    // Update a plan
    update: async (req, res) => {
        try {
            const { id } = req.params;
            const { name, description, cycle, price, dataLimit, total_connections, product_ids } = req.body;

            const plan = await Plan.findByPk(id);

            if (!plan) {
                return res.status(404).json({ error: 'Plano não encontrado' });
            }

            // Guardado ANTES do update: depois dele, plan.dataLimit ja e o novo e
            // nao ha como saber se mudou.
            const velocidadeAnterior = plan.dataLimit;

            await plan.update({
                name,
                description,
                cycle,
                price,
                dataLimit,
                total_connections,
                product_ids: JSON.stringify(product_ids || [])
            });

            /*
             * Propagacao para as conexoes do plano — so quando pedida.
             *
             * Cada Connection guarda a propria velocidade em data_limit, copiada do
             * plano na contratacao. Isso existe para o operador poder dar uma
             * velocidade diferente a um cliente sem inventar um plano novo, e e a
             * Connection que manda: o provisionador le
             * ISNULL(con.data_limit, p.dataLimit).
             *
             * Por isso mudar o plano NAO pode retarifar todo mundo por acidente —
             * apagaria silenciosamente cada ajuste individual ja feito. O painel
             * pergunta, e so entao isto roda.
             */
            let conexoesAtualizadas = 0;

            if (aplicarNasConexoes && Number(dataLimit) !== Number(velocidadeAnterior)) {
                const [linhas] = await Connection.update(
                    { data_limit: dataLimit },
                    { where: { PlanId: plan.id } }
                );
                conexoesAtualizadas = linhas || 0;
            }

            /*
             * O provisionador aplica sozinho: o ciclo dele le a velocidade junto da
             * ficha de cada aparelho e regrava o meta.json quando o numero muda.
             * Ou seja, o efeito aparece no proximo ciclo, sem ninguem reprovisionar
             * nada e sem derrubar quem esta conectado.
             */
            res.json({ ...plan.toJSON(), conexoesAtualizadas });
        } catch (error) {
            console.error('Erro ao atualizar plano:', error);
            res.status(500).json({ error: 'Erro ao atualizar plano' });
        }
    },

    // Delete a plan
    delete: async (req, res) => {
        try {
            const { id } = req.params;
            const plan = await Plan.findByPk(id);

            if (!plan) {
                return res.status(404).json({ error: 'Plano não encontrado' });
            }

            await plan.destroy();
            res.json({ message: 'Plano removido com sucesso' });
        } catch (error) {
            console.error('Erro ao remover plano:', error);
            res.status(500).json({ error: 'Erro ao remover plano' });
        }
    }
};

module.exports = planController;
