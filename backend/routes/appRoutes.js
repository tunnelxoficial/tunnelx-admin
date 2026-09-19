const express = require('express');
const router = express.Router();
const appAuthController = require('../controllers/appAuthController');
const appSubscriptionController = require('../controllers/appSubscriptionController');
const { protectClient, protectClientForPasswordChange, requireActiveSubscription } = require('../middleware/auth');

/**
 * Superficie do aplicativo do cliente.
 *
 * Namespace proprio (/app) em vez de reaproveitar /auth e /connections: as rotas
 * administrativas listam TODOS os clientes e TODAS as conexoes, enquanto estas
 * enxergam somente o dono do token. Misturar os dois publicos no mesmo prefixo e
 * como um `where` de escopo acaba esquecido.
 *
 * Tres niveis de acesso, do mais aberto ao mais restrito:
 *   publico                        -> login
 *   token de cliente               -> trocar senha, ver/assinar plano
 *   token + assinatura em dia      -> conexoes (o produto pago)
 */
router.post('/login', appAuthController.login);

// Unica rota que aceita o token do primeiro acesso - ver middleware/auth.js.
router.post('/change-password', protectClientForPasswordChange, appAuthController.changePassword);

router.get('/me', protectClient, appAuthController.me);

// Assinatura: precisa de token, mas NAO de assinatura em dia — e justamente
// aqui que quem esta sem plano ou bloqueado vem resolver.
router.get('/plans', protectClient, appSubscriptionController.listPlans);
router.get('/subscription', protectClient, appSubscriptionController.current);
router.post('/subscription', protectClient, appSubscriptionController.subscribe);
router.post('/subscription/cancel', protectClient, appSubscriptionController.cancel);
router.get('/subscription/payment', protectClient, appSubscriptionController.pendingPayment);

// O produto em si. `requireActiveSubscription` e o portao: sem assinatura em
// dia (ou dentro da carencia de 3 dias) a configuracao do tunel nao sai daqui.
router.get('/connections', protectClient, requireActiveSubscription, appAuthController.connections);

module.exports = router;
