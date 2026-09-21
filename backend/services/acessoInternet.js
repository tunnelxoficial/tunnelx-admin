/**
 * Corta e devolve a internet de uma conexao — e o UNICO lugar que decide isso.
 *
 * Antes o corte era um `update({ internet: !internet })` solto no controller, e
 * nada mais no sistema lia esse campo: o botao do painel invertia um booleano no
 * banco enquanto o peer seguia no tunel e o cliente seguia navegando.
 *
 * Agora `Connections.internet` e o ESTADO DESEJADO de acesso, e o provisionador
 * reconcilia o tunel com ele a cada ciclo. Quem escreve nesse campo passa por
 * aqui, por um motivo simples: existem duas fontes de corte — a mao do operador
 * e a falta de pagamento — e elas se atropelam se cada uma escrever do seu
 * jeito.
 *
 * A regra que evita o atropelo:
 *
 *   corte 'overdue'   o pagamento libera sozinho
 *   corte 'operator'  so a mao do operador desfaz
 *
 * O caso que ela protege e real: o operador corta um cliente de proposito, e
 * dias depois uma cobranca antiga e confirmada no Asaas. Sem o motivo gravado, a
 * liberacao automatica devolveria o acesso a quem foi cortado de proposito.
 */

const MOTIVO_OPERADOR = 'operator';
const MOTIVO_INADIMPLENCIA = 'overdue';

/**
 * Corta o acesso.
 *
 * @param {object} connection  instancia de Connection
 * @param {string} motivo      MOTIVO_OPERADOR ou MOTIVO_INADIMPLENCIA
 * @returns {Promise<boolean>} true se ESTE chamado mudou alguma coisa
 */
async function bloquear(connection, motivo) {
    if (motivo !== MOTIVO_OPERADOR && motivo !== MOTIVO_INADIMPLENCIA) {
        throw new Error(`motivo de bloqueio invalido: ${motivo}`);
    }

    // Ja cortado pelo operador: a inadimplencia nao rebaixa o motivo. Se o
    // sobrescrevesse, o proximo pagamento liberaria um corte deliberado.
    if (!connection.internet &&
        connection.internet_block_reason === MOTIVO_OPERADOR &&
        motivo === MOTIVO_INADIMPLENCIA) {
        return false;
    }

    if (!connection.internet && connection.internet_block_reason === motivo) {
        return false;                       // ja esta como se quer: nao escreve
    }

    await connection.update({
        internet: false,
        internet_block_reason: motivo,
        // Preserva a data do corte original quando so o motivo muda de
        // 'overdue' para 'operator' — o cliente esta sem internet desde antes.
        internet_blocked_at: connection.internet_blocked_at || new Date()
    });

    console.log(`[acesso] conexao ${connection.id} CORTADA (${motivo})`);
    return true;
}

/**
 * Devolve o acesso.
 *
 * @param {object} connection
 * @param {object} [opcoes]
 * @param {string} [opcoes.somenteSeMotivo]  so libera se o corte tiver ESTE
 *        motivo. E o que o pagamento usa, para nao desfazer corte do operador.
 * @returns {Promise<boolean>} true se ESTE chamado mudou alguma coisa
 */
async function liberar(connection, opcoes = {}) {
    const { somenteSeMotivo } = opcoes;

    if (connection.internet) {
        // Ja liberada. Ainda assim limpa motivo orfao, se sobrou de um estado
        // anterior — sem isso a tela mostraria "cortada por inadimplencia" numa
        // linha com internet ligada.
        if (connection.internet_block_reason || connection.internet_blocked_at) {
            await connection.update({
                internet_block_reason: null,
                internet_blocked_at: null
            });
        }
        return false;
    }

    if (somenteSeMotivo && connection.internet_block_reason !== somenteSeMotivo) {
        console.log(
            `[acesso] conexao ${connection.id} segue cortada: ` +
            `motivo e "${connection.internet_block_reason}", nao "${somenteSeMotivo}"`
        );
        return false;
    }

    await connection.update({
        internet: true,
        internet_block_reason: null,
        internet_blocked_at: null
    });

    console.log(`[acesso] conexao ${connection.id} LIBERADA`);
    return true;
}

/**
 * Rotulo pronto para a tela e para o aplicativo.
 * Mantido aqui junto da regra para os textos nao divergirem dela.
 */
function descrever(connection) {
    if (connection.internet) return { bloqueada: false, motivo: null, texto: 'Internet ativa' };

    if (connection.internet_block_reason === MOTIVO_INADIMPLENCIA) {
        return {
            bloqueada: true,
            motivo: MOTIVO_INADIMPLENCIA,
            texto: 'Cortada por falta de pagamento'
        };
    }

    return { bloqueada: true, motivo: MOTIVO_OPERADOR, texto: 'Cortada pelo operador' };
}

module.exports = {
    bloquear,
    liberar,
    descrever,
    MOTIVO_OPERADOR,
    MOTIVO_INADIMPLENCIA
};
