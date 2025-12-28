const express = require('express');
const router = express.Router();
const stockController = require('../controllers/stockController');

router.get('/', stockController.getAll);
router.post('/', stockController.create);
router.post('/:id/movement', stockController.registerMovement); // Nova rota de movimentação
router.get('/:id/history', stockController.getHistory); // Nova rota de histórico
router.put('/:id', stockController.update);
router.delete('/:id', stockController.delete);

module.exports = router;
