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
    req.client = payload;
    next();
}

module.exports = { protectAdmin, protectClient, SECRET_KEY };
