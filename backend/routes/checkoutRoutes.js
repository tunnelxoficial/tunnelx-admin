const express = require('express');
const router = express.Router();
const checkoutController = require('../controllers/checkoutController');
const { limitarCadastro } = require('../middleware/rateLimit');

// Publica por definicao (quem contrata ainda nao tem conta), e por isso
// mesmo limitada: cria Client e chama o Asaas a cada requisicao.
router.post('/', limitarCadastro, checkoutController.processCheckout);

module.exports = router;
