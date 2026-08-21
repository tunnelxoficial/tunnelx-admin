const express = require('express');
const router = express.Router();
const appAuthController = require('../controllers/appAuthController');
const { protectClient } = require('../middleware/auth');

/**
 * Superficie do aplicativo do cliente.
 *
 * Namespace proprio (/app) em vez de reaproveitar /auth e /connections: as rotas
 * administrativas listam TODOS os clientes e TODAS as conexoes, enquanto estas
 * enxergam somente o dono do token. Misturar os dois publicos no mesmo prefixo e
 * como um `where` de escopo acaba esquecido.
 */
router.post('/login', appAuthController.login);

router.get('/me', protectClient, appAuthController.me);
router.get('/connections', protectClient, appAuthController.connections);
router.post('/change-password', protectClient, appAuthController.changePassword);

module.exports = router;
