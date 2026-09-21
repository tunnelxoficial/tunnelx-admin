const express = require('express');
const router = express.Router();
const connectionController = require('../controllers/connectionController');

/*
 * Todas as rotas deste arquivo exigem token de admin.
 *
 * A exigencia e feita no ponto de montagem, em index.js — nao aqui. Uma rota
 * acrescentada abaixo ja nasce protegida.
 *
 * Isto nao era verdade ate agora: estas rotas respondiam a qualquer um, e
 * GET /:id/files entrega a chave privada WireGuard do cliente.
 */

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
