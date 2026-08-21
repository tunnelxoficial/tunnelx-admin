const express = require('express');
const router = express.Router();
const connectionController = require('../controllers/connectionController');

// Middleware to check auth could be added here later
// const authMiddleware = require('../middleware/auth'); 

router.get('/', connectionController.getAll);
router.post('/', connectionController.create);
router.put('/:id', connectionController.update);
router.delete('/:id', connectionController.delete);
router.patch('/:id/toggle-internet', connectionController.toggleInternet);

// Dados de conexao sob demanda (config em texto + QR em base64)
router.get('/:id/files', connectionController.getFiles);
// Reenfileira a conexao para o worker regerar config/QR com o endpoint atual
router.patch('/:id/reprovision', connectionController.reprovision);

module.exports = router;
