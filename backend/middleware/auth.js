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

module.exports = { protectAdmin, protectClient, protectClientForPasswordChange, SECRET_KEY };
