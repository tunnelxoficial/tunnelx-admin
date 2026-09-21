const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const Client = require('../models/Client');
const Connection = require('../models/Connection');
const ConnectionShare = require('../models/ConnectionShare');
const Plan = require('../models/Plan');
const { SECRET_KEY } = require('../middleware/auth');
const { onlyDigits } = require('../utils/password');
const {
    duracaoValida, listarDuracoes, validadeDoConvite, fimDoAcesso,
    podeAceitar, descreverPrazo, DURACOES, VALIDADE_DO_CONVITE_MIN
} = require('../utils/shareRules');
const { vagasParaConvite, vagasParaAceite, varrerExpirados } = require('../services/shareService');

/**
 * Compartilhar o túnel com a família.
 *
 * Um plano de 8 não são 8 túneis: é UM túnel que até 8 pessoas usam, com a mesma
 * configuração. O dono gera um convite, define por quanto tempo vale e mostra o
 * QR; quem escaneia entra no mesmo túnel, ocupando uma vaga.
 *
 * O QR carrega um TOKEN, nunca o .conf. A diferença é a feature inteira: um QR
 * com a configuração dentro daria acesso permanente a quem fotografasse a tela —
 * sem prazo, sem contagem de vaga e sem revogação, porque a chave privada já
 * estaria na mão da pessoa e não há como pedi-la de volta. Com token, quem decide
 * é o servidor a cada passo: confere a vaga, aplica o prazo, entrega a
 * configuração só a quem aceitou, e corta quando o dono mandar.
 */

const EXPIRACAO = '10y'; // ver a nota em appAuthController

/** O que o app do convidado lê da câmera. */
function montarPayloadQr(token) {
    return `tunnelx://share/${token}`;
}

function novoToken() {
    return crypto.randomBytes(32).toString('hex');
}

/** Primeiro nome só: o convidado não precisa do nome completo de quem convidou. */
function primeiroNome(nome) {
    return String(nome || '').trim().split(/\s+/)[0] || 'Titular';
}

function serializarShare(share) {
    return {
        id: share.id,
        status: share.status,
        guest_label: share.guest_label,
        duration_key: share.duration_key,
        duration_label: share.duration_label,
        expires_at: share.expires_at,
        expires_text: descreverPrazo(share),
        accepted_at: share.accepted_at,
        invite_expires_at: share.invite_expires_at,
        qr_payload: share.status === 'PENDING' ? montarPayloadQr(share.token) : null,
        guest: share.Guest ? { id: share.Guest.id, name: share.Guest.name } : null,
        createdAt: share.createdAt
    };
}

/** A conexão precisa ser do dono do token — nunca de um id vindo da requisição. */
async function conexaoDoDono(connectionId, clientId) {
    return Connection.findOne({ where: { id: connectionId, ClientId: clientId } });
}

/* ------------------------------------------------------------------ dono -- */

/**
 * Painel de compartilhamento de um túnel: vagas, convites e prazos possíveis.
 *
 * As durações vêm daqui e não ficam fixas no app: mudar a lista no servidor
 * atinge quem já tem o app instalado, e um app antigo não consegue pedir um
 * prazo que o servidor não aceite.
 */
exports.overview = async (req, res) => {
    try {
        const conexao = await conexaoDoDono(req.params.id, req.client.id);
        if (!conexao) return res.status(404).json({ message: 'Conexao nao encontrada.' });

        const vagas = await vagasParaConvite(conexao);

        const shares = await ConnectionShare.findAll({
            where: {
                ConnectionId: conexao.id,
                status: { [Op.in]: ['PENDING', 'ACTIVE'] }
            },
            include: [{ model: Client, as: 'Guest', attributes: ['id', 'name'] }],
            order: [['id', 'DESC']]
        });

        res.json({
            connection: { id: conexao.id, name: conexao.name },
            slots: {
                total: vagas.total,
                // O dono ocupa uma vaga do plano — ele também usa o túnel, e
                // agora com um peer próprio, contado como os demais.
                owner: 1,
                guests_active: vagas.ativos,
                invites_pending: vagas.pendentes,
                free: vagas.livres
            },
            durations: listarDuracoes(),
            invite_ttl_minutes: VALIDADE_DO_CONVITE_MIN,
            shares: shares.map(serializarShare)
        });
    } catch (error) {
        console.error('[app/shares/overview]', error);
        res.status(500).json({ message: 'Erro ao carregar o compartilhamento.' });
    }
};

/** Gera o convite: é o que vira QR na tela do dono. */
exports.create = async (req, res) => {
    try {
        const { duration, guest_label } = req.body || {};

        if (!duracaoValida(duration)) {
            return res.status(400).json({ message: 'Escolha um periodo de acesso valido.' });
        }

        const conexao = await conexaoDoDono(req.params.id, req.client.id);
        if (!conexao) return res.status(404).json({ message: 'Conexao nao encontrada.' });

        const vagas = await vagasParaConvite(conexao);
        if (vagas.livres <= 0) {
            // Recusa aqui, e não na cara de quem escaneia: o limite é do plano do
            // dono, e é ele quem pode resolver (remover alguém ou subir de plano).
            return res.status(409).json({
                code: 'SEM_VAGA',
                message: vagas.total <= 1
                    ? 'Seu plano nao permite compartilhar. Troque de plano para liberar vagas.'
                    : `Todas as ${vagas.total} vagas do seu plano estao ocupadas. Remova alguem para liberar.`
            });
        }

        const share = await ConnectionShare.create({
            ConnectionId: conexao.id,
            OwnerClientId: req.client.id,
            token: novoToken(),
            status: 'PENDING',
            // expires_at fica NULO aqui: o prazo do acesso conta do ACEITE. Só a
            // duração escolhida é guardada, e vira data quando alguém aceitar.
            expires_at: null,
            duration_key: duration,
            duration_label: DURACOES[duration].label,
            invite_expires_at: validadeDoConvite(),
            guest_label: guest_label ? String(guest_label).trim().slice(0, 60) : null
        });

        res.status(201).json({
            share: serializarShare(share),
            qr_payload: montarPayloadQr(share.token),
            invite_expires_at: share.invite_expires_at,
            free_slots_after: vagas.livres - 1
        });
    } catch (error) {
        console.error('[app/shares/create]', error);
        res.status(500).json({ message: 'Erro ao gerar o convite.' });
    }
};

/**
 * Corta o acesso de um convidado (ou cancela um convite não usado).
 *
 * Revogar só marca o banco; o túnel em si continua o mesmo, com a mesma chave.
 * Quem já baixou a configuração continua conseguindo subir o WireGuard até o
 * peer ser reprovisionado — por isso `revoke` NÃO é uma garantia técnica contra
 * um convidado mal-intencionado, e sim o controle de quem está autorizado. Para
 * cortar de verdade é preciso trocar a chave do túnel, o que derrubaria todo
 * mundo, inclusive o dono.
 */
exports.revoke = async (req, res) => {
    try {
        const share = await ConnectionShare.findOne({
            where: { id: req.params.shareId, OwnerClientId: req.client.id }
        });
        if (!share) return res.status(404).json({ message: 'Convite nao encontrado.' });

        if (share.status === 'REVOKED') {
            return res.json({ message: 'Este acesso ja estava removido.', share: serializarShare(share) });
        }

        await share.update({ status: 'REVOKED', revoked_at: new Date() });

        /*
         * Corta tambem o APARELHO, e nao so o convite.
         *
         * O peer do convidado continua vivo no servidor WireGuard ate o
         * provisionador remove-lo. Marcar so o convite deixaria o peer de pe: o
         * convidado removido seguiria navegando, e o titular teria uma vaga
         * ocupada por alguem que ele achou que tinha tirado.
         */
        try {
            const { revogarPorShare } = require('../services/deviceService');
            const cortados = await revogarPorShare(share.id);
            if (cortados) console.log(`[app/shares/revoke] ${cortados} aparelho(s) na fila de remocao`);
        } catch (e) {
            console.error('[app/shares/revoke] falha ao cortar o aparelho:', e.message);
        }

        res.json({
            message: share.accepted_at ? 'Acesso removido.' : 'Convite cancelado.',
            share: serializarShare(share)
        });
    } catch (error) {
        console.error('[app/shares/revoke]', error);
        res.status(500).json({ message: 'Erro ao remover o acesso.' });
    }
};

/* ------------------------------------------------------------- convidado -- */

/**
 * O que o QR revela ANTES de entrar na conta — deliberadamente pouco.
 *
 * Rota pública: quem escaneou ainda pode não ter conta, e exigir login antes de
 * mostrar o que é o convite deixaria a pessoa fazendo cadastro às cegas.
 *
 * Por ser pública, devolve só o primeiro nome de quem convidou e o nome do
 * túnel. Nada de CPF, e-mail, plano ou configuração: um token vazado não pode
 * virar consulta de dados de terceiro.
 */
exports.preview = async (req, res) => {
    try {
        const share = await ConnectionShare.findOne({
            where: { token: String(req.params.token || '') }
        });

        const veredito = podeAceitar(share);
        if (!veredito.ok) {
            return res.status(410).json({ code: veredito.code, message: veredito.message });
        }

        const [dono, conexao] = await Promise.all([
            Client.findByPk(share.OwnerClientId, { attributes: ['id', 'name'] }),
            Connection.findByPk(share.ConnectionId)
        ]);
        if (!conexao) {
            return res.status(410).json({ code: 'NAO_ENCONTRADO', message: 'Este convite nao e mais valido.' });
        }

        const livres = await vagasParaAceite(conexao);
        if (livres <= 0) {
            return res.status(409).json({
                code: 'SEM_VAGA',
                message: 'Este tunel esta cheio. Peca ao titular para liberar uma vaga.'
            });
        }

        res.json({
            owner_name: primeiroNome(dono?.name),
            connection_name: conexao.name,
            duration_label: share.duration_label || 'Sem prazo',
            guest_label: share.guest_label,
            invite_expires_at: share.invite_expires_at
        });
    } catch (error) {
        console.error('[app/shares/preview]', error);
        res.status(500).json({ message: 'Erro ao ler o convite.' });
    }
};

/**
 * Aceita o convite. Exige token de cliente, mas NÃO exige assinatura.
 *
 * É o ponto da feature: o convidado não paga nada. Quem paga é o titular, e o
 * plano dele já cobre estas pessoas.
 */
exports.accept = async (req, res) => {
    try {
        const share = await ConnectionShare.findOne({
            where: { token: String(req.params.token || '') }
        });

        const veredito = podeAceitar(share);
        if (!veredito.ok) {
            return res.status(410).json({ code: veredito.code, message: veredito.message });
        }

        // O dono aceitando o próprio convite ocuparia uma vaga extra e listaria o
        // túnel duas vezes na tela dele.
        if (share.OwnerClientId === req.client.id) {
            return res.status(400).json({
                code: 'CONVITE_PROPRIO',
                message: 'Este tunel ja e seu. Compartilhe o QR com quem vai usar.'
            });
        }

        const conexao = await Connection.findByPk(share.ConnectionId);
        if (!conexao) {
            return res.status(410).json({ code: 'NAO_ENCONTRADO', message: 'Este convite nao e mais valido.' });
        }

        // Mesma pessoa, segundo convite: sem isto, cada QR novo consumiria mais
        // uma vaga do plano para quem já está dentro.
        const jaDentro = await ConnectionShare.findOne({
            where: {
                ConnectionId: conexao.id,
                GuestClientId: req.client.id,
                status: 'ACTIVE'
            }
        });
        if (jaDentro) {
            return res.status(409).json({
                code: 'JA_TEM_ACESSO',
                message: 'Voce ja tem acesso a este tunel.'
            });
        }

        // Revalidação da vaga no momento do aceite: entre gerar o QR e alguém
        // escanear, outro convidado pode ter entrado.
        const livres = await vagasParaAceite(conexao);
        if (livres <= 0) {
            return res.status(409).json({
                code: 'SEM_VAGA',
                message: 'Este tunel esta cheio. Peca ao titular para liberar uma vaga.'
            });
        }

        const agora = new Date();
        const chaveDuracao = share.duration_key || 'indefinido';

        await share.update({
            GuestClientId: req.client.id,
            status: 'ACTIVE',
            accepted_at: agora,
            // Agora sim vira data: o prazo conta do aceite.
            expires_at: fimDoAcesso(chaveDuracao, agora)
        });

        const dono = await Client.findByPk(share.OwnerClientId, { attributes: ['name'] });

        /*
         * O aparelho do convidado nasce aqui.
         *
         * E o momento certo: o convite acabou de ser aceito, a vaga ja foi
         * conferida, e o peer entra na fila enquanto a pessoa ainda esta na tela.
         * Quando ela chegar na lista de tuneis, a configuracao provavelmente ja
         * existe.
         *
         * Antes daqui o convidado recebia o .conf DO TITULAR — mesma chave, mesmo
         * /32 — e os dois aparelhos passavam a disputar o unico endpoint do peer.
         */
        try {
            const { garantirDevice } = require('../services/deviceService');
            await garantirDevice({
                connectionId: conexao.id,
                clientId: req.client.id,
                shareId: share.id
            });
        } catch (e) {
            // Falhar aqui nao pode desfazer o aceite: /app/connections garante o
            // device de novo na primeira listagem.
            console.error('[app/shares/accept] nao foi possivel criar o aparelho:', e.message);
        }

        res.json({
            message: 'Acesso liberado.',
            share: {
                id: share.id,
                connection_name: conexao.name,
                owner_name: primeiroNome(dono?.name),
                expires_at: share.expires_at,
                expires_text: descreverPrazo(share, agora)
            }
        });
    } catch (error) {
        console.error('[app/shares/accept]', error);
        res.status(500).json({ message: 'Erro ao aceitar o convite.' });
    }
};

/**
 * O convidado desiste de um acesso que recebeu.
 *
 * Mesma ação do `revoke`, mas pela outra ponta: só o dono podia remover, e sem
 * isto quem foi convidado ficaria preso a um túnel alheio na lista até o prazo
 * vencer, sem poder devolver a vaga.
 */
exports.leave = async (req, res) => {
    try {
        const share = await ConnectionShare.findOne({
            where: { id: req.params.shareId, GuestClientId: req.client.id, status: 'ACTIVE' }
        });
        if (!share) return res.status(404).json({ message: 'Acesso nao encontrado.' });

        await share.update({ status: 'REVOKED', revoked_at: new Date() });

        // Mesma razao do revoke: sem cortar o aparelho, o peer fica vivo no
        // servidor e a vaga do titular continua ocupada.
        try {
            const { revogarPorShare } = require('../services/deviceService');
            await revogarPorShare(share.id);
        } catch (e) {
            console.error('[app/shares/leave] falha ao cortar o aparelho:', e.message);
        }

        res.json({ message: 'Voce saiu deste tunel.' });
    } catch (error) {
        console.error('[app/shares/leave]', error);
        res.status(500).json({ message: 'Erro ao sair do tunel.' });
    }
};

module.exports = exports;
