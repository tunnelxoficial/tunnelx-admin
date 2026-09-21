const express = require('express');
const router = express.Router();
const planController = require('../controllers/planController');
const { protectAdmin } = require('../middleware/auth');

/*
 * Leitura publica, escrita fechada.
 *
 * A pagina de pre-cadastro (frontend/js/pre-cadastro.js) lista os planos SEM
 * login — e a vitrine de vendas, quem contrata ainda nao tem conta. Fechar a
 * rota inteira derrubava o funil de vendas.
 *
 * Os dados aqui sao de catalogo: nome, preco, ciclo. Os mesmos que o
 * aplicativo ja mostra e que estao no material de venda.
 */
router.get('/', planController.getAll);

// Alterar o catalogo continua sendo ato de operador.
router.post('/', protectAdmin, planController.create);
router.put('/:id', protectAdmin, planController.update);
router.delete('/:id', protectAdmin, planController.delete);

module.exports = router;
