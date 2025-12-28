const Plan = require('../models/Plan');

const planController = {
    // List all plans
    getAll: async (req, res) => {
        try {
            const plans = await Plan.findAll({
                order: [['name', 'ASC']]
            });
            res.json(plans);
        } catch (error) {
            console.error('Erro ao buscar planos:', error);
            res.status(500).json({ error: 'Erro ao buscar planos' });
        }
    },

    // Create a new plan
    create: async (req, res) => {
        try {
            const { name, description, cycle, price, dataLimit } = req.body;

            if (!name || !cycle || !price || !dataLimit) {
                return res.status(400).json({ error: 'Nome, ciclo, valor e pacote de dados são obrigatórios' });
            }

            const newPlan = await Plan.create({
                name,
                description,
                cycle,
                price,
                dataLimit
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
            const { name, description, cycle, price, dataLimit } = req.body;

            const plan = await Plan.findByPk(id);

            if (!plan) {
                return res.status(404).json({ error: 'Plano não encontrado' });
            }

            await plan.update({
                name,
                description,
                cycle,
                price,
                dataLimit
            });

            res.json(plan);
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
