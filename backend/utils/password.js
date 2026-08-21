const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/**
 * Senha de acesso do cliente ao aplicativo.
 *
 * O alfabeto exclui de proposito 0/O, 1/I/L e 5/S: a senha e gerada aqui, lida
 * em voz alta ou por WhatsApp e digitada num teclado de celular. Ambiguidade
 * visual vira chamado de suporte.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRTUVWXYZ23456789';
const GRUPOS = 2;
const POR_GRUPO = 4;

function generatePassword() {
    // randomInt do crypto, e nao Math.random: senha e material de autenticacao.
    const sortear = () => ALFABETO[crypto.randomInt(0, ALFABETO.length)];
    return Array.from({ length: GRUPOS }, () =>
        Array.from({ length: POR_GRUPO }, sortear).join('')
    ).join('-');
}

async function hashPassword(plain) {
    return bcrypt.hash(plain, 10);
}

async function checkPassword(plain, hash) {
    if (!hash) return false;
    return bcrypt.compare(plain, hash);
}

/**
 * CPF sempre comparado por digito.
 *
 * A base de hoje guarda '064.767.391-66' porque a mascara do admin vai junto no
 * POST. O app manda o que o usuario digitou. Normalizar dos dois lados e o que
 * evita o login que falha sem motivo aparente.
 */
function onlyDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

/** Valida CPF pelos digitos verificadores - erro de digitacao para antes do banco. */
function isValidCpf(value) {
    const cpf = onlyDigits(value);
    if (cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    const digito = (ate) => {
        let soma = 0;
        for (let i = 0; i < ate; i++) soma += Number(cpf[i]) * (ate + 1 - i);
        const resto = (soma * 10) % 11;
        return resto === 10 ? 0 : resto;
    };

    return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

module.exports = { generatePassword, hashPassword, checkPassword, onlyDigits, isValidCpf };
