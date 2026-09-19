const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/**
 * Senha de acesso do cliente ao aplicativo: somente digitos.
 *
 * Era 'XXXX-XXXX' com letras. Numerica e mais facil de ditar por telefone, de
 * mandar por WhatsApp e de digitar — o celular abre o teclado numerico e nao ha
 * duvida entre maiuscula e minuscula, nem entre O e 0.
 *
 * O preco e o espaco de busca: de 30^8 (~6,5 x 10^11) para 10^8 (10^8). Como
 * /app/login ainda nao tem limite de tentativas (ver docs/ACESSO-APP.md), e o
 * limite por IP e por CPF que sustenta esse tamanho — ele passou de "bom ter"
 * para "precisa existir antes de escalar a base".
 */
const DIGITOS = 8;

function generatePassword() {
    // randomInt do crypto, e nao Math.random: senha e material de autenticacao.
    // Faixa completa de uma vez, em vez de sortear digito a digito: o proprio
    // randomInt ja distribui uniformemente, e o padStart garante o comprimento
    // quando o sorteio cai num numero baixo (ex.: 00412735).
    const maximo = 10 ** DIGITOS;
    return String(crypto.randomInt(0, maximo)).padStart(DIGITOS, '0');
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
