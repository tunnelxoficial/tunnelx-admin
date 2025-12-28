const express = require('express');
const router = express.Router();
const planController = require('../controllers/planController');

router.get('/', planController.getAll);
router.post('/', planController.create);
router.put('/:id', planController.update);
router.delete('/:id', planController.delete);

module.exports = router;
