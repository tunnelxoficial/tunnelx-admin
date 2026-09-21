/**
 * Limite de tentativas por IP, em memória.
 *
 * Existe por causa de uma conta concreta: a senha do cliente tem 8 dígitos
 * numéricos (utils/password.js), ou seja 10^8 combinações. Sem limite, e com o
 * login respondendo em ~100 ms, um atacante varre o espaço inteiro de UM CPF em
 * poucos dias — e a base de CPFs não é segredo. O limite transforma isso em
 * séculos, sem precisar trocar o formato da senha.
 *
 * Em memória, e não no Redis, porque não há Redis aqui e porque o ganho de um
 * contador distribuído é pequeno perto do ganho de ter *algum* contador. A
 * limitação honesta: com várias instâncias da API, cada uma conta em separado,
 * então o teto real é `limite × instâncias`. Ainda assim é três ordens de
 * grandeza melhor que hoje.
 *
 * Não protege contra um atacante com muitos IPs. Protege contra o caso comum —
 * um script num IP só — e contra o cliente que esqueceu a senha e tenta 40
 * vezes seguidas derrubando o pool do banco.
 */

/** Quantas janelas guardar antes de varrer. Limita o custo de memória. */
const LIMPEZA_A_CADA = 5000;

function criarLimitador({ janelaMs, maximo, mensagem, chave }) {
    /** ip -> { contagem, expiraEm } */
    const registros = new Map();
    let desdeALimpeza = 0;

    /**
     * Remove janelas vencidas.
     *
     * Varredura preguiçosa em vez de setInterval: um timer manteria o processo
     * acordado e seguraria uma referência viva do mapa mesmo num servidor
     * ocioso. Aqui o custo só aparece quando há tráfego.
     */
    function varrer(agora) {
        for (const [k, v] of registros) {
            if (v.expiraEm <= agora) registros.delete(k);
        }
    }

    return function limitar(req, res, next) {
        const agora = Date.now();

        if (++desdeALimpeza >= LIMPEZA_A_CADA) {
            desdeALimpeza = 0;
            varrer(agora);
        }

        // req.ip respeita o proxy quando `trust proxy` está ligado (ver index.js).
        // Sem isso, atrás de um proxy TODOS os clientes compartilhariam um IP e o
        // limitador derrubaria a base inteira junto.
        const id = chave ? chave(req) : req.ip;
        const registro = registros.get(id);

        if (!registro || registro.expiraEm <= agora) {
            registros.set(id, { contagem: 1, expiraEm: agora + janelaMs });
            return next();
        }

        registro.contagem += 1;

        if (registro.contagem > maximo) {
            const faltam = Math.ceil((registro.expiraEm - agora) / 1000);
            res.set('Retry-After', String(faltam));
            return res.status(429).json({
                code: 'RATE_LIMITED',
                message: mensagem || `Muitas tentativas. Tente de novo em ${faltam}s.`
            });
        }

        next();
    };
}

/**
 * Login: 10 tentativas a cada 15 minutos por IP.
 *
 * Folgado para quem erra a senha de verdade (o cliente digita 8 dígitos num
 * teclado de celular), apertado para quem está varrendo: 40 tentativas por hora
 * contra 10^8 possibilidades.
 */
const limitarLogin = criarLimitador({
    janelaMs: 15 * 60 * 1000,
    maximo: 10,
    mensagem: 'Muitas tentativas de entrada. Aguarde alguns minutos e tente de novo.'
});

/** Cadastro e pré-cadastro: 5 por hora. Criar conta é raro; script é que repete. */
const limitarCadastro = criarLimitador({
    janelaMs: 60 * 60 * 1000,
    maximo: 5,
    mensagem: 'Muitas contas criadas deste dispositivo. Tente mais tarde.'
});

/**
 * Consulta de CPF: 30 por hora.
 *
 * A rota diz se um CPF já é cliente. Sozinha é pouca informação, mas sem limite
 * vira um jeito de enumerar a base inteira.
 */
const limitarConsulta = criarLimitador({
    janelaMs: 60 * 60 * 1000,
    maximo: 30
});

module.exports = { criarLimitador, limitarLogin, limitarCadastro, limitarConsulta };
