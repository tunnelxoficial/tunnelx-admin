const User = require('../models/Users');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const SECRET_KEY = process.env.JWT_SECRET || 'tunnelx_super_secret_key';

/*
 * Dez anos. Na pratica, sessao que nao expira.
 *
 * A troca e consciente: ninguem precisa refazer login, e some a fricção de
 * sessao vencida no meio do uso. O custo e que um token vazado (aparelho
 * perdido, backup do celular, log de proxy) vale por uma decada, e nao existe
 * revogacao — o JWT e auto-contido, nao ha lista de tokens invalidados.
 *
 * O jeito de cortar acesso hoje: trocar o JWT_SECRET (derruba TODAS as sessoes
 * de uma vez) ou, para um cliente so, revogar a senha pelo painel e cancelar a
 * assinatura, ja que /app/connections exige assinatura em dia a cada chamada.
 */
const EXPIRACAO_ADMIN = '10y';

exports.register = async (req, res) => {
    try {
        const { username, email, password } = req.body;

        // Check if user exists
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ message: 'Email já cadastrado.' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const newUser = await User.create({
            username,
            email,
            password: hashedPassword
        });

        res.status(201).json({ message: 'Usuário registrado com sucesso!', userId: newUser.id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro no servidor ao registrar usuário.' });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user
        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(401).json({ message: 'Credenciais inválidas.' });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Credenciais inválidas.' });
        }

        // Generate Token
        const token = jwt.sign(
            // `kind` separa este token do emitido em /app/login: mesma chave de
            // assinatura, publicos diferentes. Ver middleware/auth.js.
            { id: user.id, email: user.email, role: user.role, kind: 'admin' },
            SECRET_KEY,
            { expiresIn: EXPIRACAO_ADMIN }
        );

        res.status(200).json({
            message: 'Login realizado com sucesso!',
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro no servidor ao realizar login.' });
    }
};
