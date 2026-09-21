const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { limitarLogin } = require('../middleware/rateLimit');
const { protectAdmin } = require('../middleware/auth');

/*
 * Criar operador do painel exige JA ser operador do painel.
 *
 * Esta rota era publica. Ela nao devolve token, o que fazia parecer inofensiva
 * — mas cria uma linha em Users, e /auth/login entrega a QUEM TEM essa linha um
 * token kind:"admin". Ou seja: qualquer pessoa se cadastrava e entrava no
 * painel inteiro. Isso anularia por completo o portao montado em index.js.
 *
 * Para criar o primeiro operador num banco vazio, use
 * scripts/create_admin.js — um caminho que exige acesso ao servidor, nao a
 * internet.
 */
router.post('/register', protectAdmin, authController.register);
router.post('/login', limitarLogin, authController.login);

module.exports = router;
