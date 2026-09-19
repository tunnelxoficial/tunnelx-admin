const express = require('express');
const router = express.Router();
const appAuthController = require('../controllers/appAuthController');
const appSubscriptionController = require('../controllers/appSubscriptionController');
const appRegisterController = require('../controllers/appRegisterController');
const appShareController = require('../controllers/appShareController');
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

// Auto-cadastro: publico por definicao — quem se cadastra ainda nao tem token.
// Criar conta nao da acesso a nada; o portao continua sendo a assinatura paga.
router.post('/register', appRegisterController.register);
router.get('/register/check-cpf', appRegisterController.checkCpf);

// Unica rota que aceita o token do primeiro acesso - ver middleware/auth.js.
router.post('/change-password', protectClientForPasswordChange, appAuthController.changePassword);

router.get('/me', protectClient, appAuthController.me);

// Assinatura: precisa de token, mas NAO de assinatura em dia — e justamente
// aqui que quem esta sem plano ou bloqueado vem resolver.
router.get('/plans', protectClient, appSubscriptionController.listPlans);
router.get('/subscription', protectClient, appSubscriptionController.current);
router.post('/subscription', protectClient, appSubscriptionController.subscribe);
router.post('/subscription/cancel', protectClient, appSubscriptionController.cancel);
// "Ja paguei": consulta o Asaas direto, sem depender do webhook ter chegado.
router.post('/subscription/sync', protectClient, appSubscriptionController.sync);
router.get('/subscription/payment', protectClient, appSubscriptionController.pendingPayment);

// O produto em si. `requireActiveSubscription` e o portao: sem assinatura em
// dia (ou dentro da carencia de 3 dias) a configuracao do tunel nao sai daqui.
// O convidado tambem passa por aqui — ele nao assina, quem pagou foi o titular.
router.get('/connections', protectClient, requireActiveSubscription, appAuthController.connections);

// Resumo barato do mesmo conteudo, para o app perceber mudancas sem baixar as
// configuracoes. E por aqui que o convidado descobre que o titular o removeu.
// Fica acima das rotas com ':id' de proposito: hoje nao ha conflito (os caminhos
// tem numeros de segmentos diferentes), mas um futuro /connections/:id casaria
// com 'state' se viesse antes.
router.get('/connections/state', protectClient, requireActiveSubscription, appAuthController.connectionsState);

/*
 * Acesso provisionado: o titular empresta o tunel para a familia.
 *
 * Duas pontas com exigencias diferentes, e a diferenca e a feature inteira:
 *
 *   dono      -> precisa de assinatura em dia. Compartilhar e um direito do
 *                plano pago; quem esta bloqueado nao pode distribuir acesso
 *                para contornar o proprio bloqueio.
 *
 *   convidado -> NAO precisa de assinatura. E o ponto: ele nao paga nada, e o
 *                plano do titular ja conta essa pessoa como uma das vagas.
 */
router.get('/connections/:id/shares', protectClient, requireActiveSubscription, appShareController.overview);
router.post('/connections/:id/shares', protectClient, requireActiveSubscription, appShareController.create);
router.delete('/shares/:shareId', protectClient, requireActiveSubscription, appShareController.revoke);

// Publica: quem escaneou o QR pode ainda nao ter conta, e mandar a pessoa se
// cadastrar as cegas - sem saber de quem e o convite nem por quanto tempo vale -
// e pedir cadastro a troco de nada. Devolve so o primeiro nome do titular e o
// nome do tunel; nunca a configuracao.
router.get('/share/:token', appShareController.preview);

// Aceitar exige conta (protectClient), mas nao assinatura.
router.post('/share/:token/accept', protectClient, appShareController.accept);

// Devolver a vaga: so o dono podia cortar, e sem isto o convidado ficaria preso
// a um tunel alheio na lista ate o prazo vencer.
router.delete('/share/:shareId/leave', protectClient, appShareController.leave);

module.exports = router;
