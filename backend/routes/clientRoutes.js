const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');
const { protectAdmin } = require('../middleware/auth');

router.get('/', clientController.getAll);
router.post('/', clientController.create);
router.put('/:id', clientController.update);
router.delete('/:id', clientController.delete);

/**
 * Credenciais de acesso ao aplicativo - unicas rotas de cliente exigindo token.
 *
 * Quem cria uma senha aqui cria, na pratica, uma identidade capaz de baixar a
 * chave privada WireGuard do cliente em /app/connections. Deixar isso aberto
 * como o resto do CRUD seria entregar acesso a rede de qualquer cliente a quem
 * conhecesse a URL da API.
 *
 * As rotas acima seguem sem protecao porque ja estavam assim e o painel usa token
 * de 1 dia sem renovacao: fecha-las agora derrubaria o operador com sessao antiga
 * no meio do expediente. Isso continua pendente - ver docs/ACESSO-APP.md.
 */
router.post('/:id/password', protectAdmin, clientController.setPassword);
router.delete('/:id/password', protectAdmin, clientController.revokePassword);

module.exports = router;
