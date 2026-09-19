const jwt = require('jsonwebtoken');

const SECRET_KEY = process.env.JWT_SECRET || 'tunnelx_super_secret_key';

/**
 * Dois publicos, um segredo, duas portas.
 *
 * O token do painel (`kind: 'admin'`) e o do aplicativo (`kind: 'client'`) sao
 * assinados com a mesma chave, entao a assinatura sozinha nao diz quem e quem.
 * Sem checar o `kind`, um token de cliente - que qualquer pessoa obtem com CPF e
 * senha - abriria as rotas administrativas. E o inverso tambem: um token de
 * admin nao pode virar identidade de cliente e baixar a chave privada dele.
 */
function readToken(req) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return null;
    try {
        return jwt.verify(header.slice(7), SECRET_KEY);
    } catch {
        return null;
    }
}

function protectAdmin(req, res, next) {
    const payload = readToken(req);
    if (!payload) return res.status(401).json({ message: 'Autenticacao necessaria.' });
    // Tokens antigos do painel nao tem `kind` - emitidos antes desta separacao.
    // Aceitos porque so o painel os possui; os do app sempre nascem marcados.
    if (payload.kind && payload.kind !== 'admin') {
        return res.status(403).json({ message: 'Este token nao tem acesso ao painel.' });
    }
    req.user = payload;
    next();
}

function protectClient(req, res, next) {
    const payload = readToken(req);
    if (!payload) return res.status(401).json({ message: 'Autenticacao necessaria.' });
    if (payload.kind !== 'client') {
        return res.status(403).json({ message: 'Este token nao pertence a um cliente.' });
    }
    // Token emitido contra a senha que o operador entregou. Ele abre uma unica
    // porta: a troca de senha. Barrar aqui, e nao so na tela do app, e o que
    // impede que a senha dita por WhatsApp baixe o .conf - e com ele a chave
    // privada do peer - na mao de quem ouviu.
    if (payload.pwd === 'provisional') {
        return res.status(403).json({
            code: 'PASSWORD_CHANGE_REQUIRED',
            message: 'Defina uma nova senha para concluir o primeiro acesso.'
        });
    }
    req.client = payload;
    next();
}

/**
 * Variante usada so em /app/change-password.
 *
 * E a unica rota que precisa aceitar o token provisorio: exigir token pleno aqui
 * trancaria o cliente do lado de fora - sem troca nao ha token pleno, e sem
 * token pleno nao haveria troca.
 */
function protectClientForPasswordChange(req, res, next) {
    const payload = readToken(req);
    if (!payload) return res.status(401).json({ message: 'Autenticacao necessaria.' });
    if (payload.kind !== 'client') {
        return res.status(403).json({ message: 'Este token nao pertence a um cliente.' });
    }
    req.client = payload;
    next();
}

/**
 * Portao da assinatura: so passa quem tem acesso liberado.
 *
 * A decisao NAO e tomada aqui - vem de utils/subscriptionAccess, o mesmo lugar
 * que responde ao app qual tela mostrar. Duas implementacoes da mesma regra
 * divergem no primeiro ajuste, e divergir aqui significa entregar a chave
 * privada do tunel para quem parou de pagar.
 *
 * Responde 402 com o veredito inteiro: o app usa o campo `state` para escolher
 * entre a tela de planos, o aviso de atraso e a tela de bloqueio.
 */
async function requireActiveSubscription(req, res, next) {
    try {
        const Subscription = require('../models/Subscription');
        const { evaluateAccess } = require('../utils/subscriptionAccess');

        const sub = await Subscription.findOne({
            where: { ClientId: req.client.id },
            order: [['id', 'DESC']]
        });

        const acesso = evaluateAccess(sub);
        if (acesso.allowed) {
            // Segue adiante para a rota poder devolver o aviso de carencia
            // junto com as conexoes.
            req.subscriptionAccess = acesso;
            return next();
        }

        return res.status(402).json({
            code: 'SUBSCRIPTION_REQUIRED',
            access: acesso,
            message: acesso.message
        });
    } catch (error) {
        console.error('[auth] falha ao verificar a assinatura:', error);
        // Falhou a verificacao: nega. Num controle de acesso pago, o erro
        // fecha a porta - liberar "na duvida" e dar o produto de graca.
        return res.status(503).json({ message: 'Nao foi possivel verificar sua assinatura.' });
    }
}

module.exports = { protectAdmin, protectClient, protectClientForPasswordChange, requireActiveSubscription, SECRET_KEY };
