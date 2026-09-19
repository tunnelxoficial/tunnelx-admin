const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const Client = require('./Client');
const Connection = require('./Connection');

/**
 * Convite de acesso a um túnel de outra pessoa.
 *
 * O dono gera um convite, define por quanto tempo vale e mostra o QR. Quem
 * escaneia entra no MESMO túnel — mesmo .conf, mesma chave — ocupando uma das
 * vagas do plano (`Connection.total_connections`).
 *
 * O QR carrega este `token`, e NAO a configuracao do WireGuard. A diferenca e o
 * que torna o gerenciamento possivel: um QR com o .conf dentro daria acesso
 * permanente a quem fotografasse a tela, sem prazo, sem vaga e sem revogacao —
 * e uma vez fotografado nao haveria como desfazer, porque a chave ja estaria com
 * a pessoa. Com token, quem manda e o servidor: ele confere a vaga, aplica o
 * prazo, entrega a configuracao so a quem aceitou, e pode cortar depois.
 */
const ConnectionShare = sequelize.define('ConnectionShare', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },

    /** Túnel compartilhado. */
    ConnectionId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Connections', key: 'id' }
    },

    /** Quem compartilhou — o dono da assinatura que paga por este túnel. */
    OwnerClientId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Clients', key: 'id' }
    },

    /**
     * Quem aceitou. NULL enquanto o convite não foi usado.
     *
     * Um convite serve a UMA pessoa: assim o prazo e a revogacao sao por
     * convidado. Um QR reutilizavel daria o mesmo prazo a todos e tiraria a
     * possibilidade de cortar so um.
     */
    GuestClientId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'Clients', key: 'id' }
    },

    /** Segredo do QR. Aleatorio e unico — e a unica coisa que o QR carrega. */
    token: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true
    },

    /**
     * Ciclo de vida:
     *   PENDING  - convite criado, ninguem escaneou
     *   ACTIVE   - aceito, o convidado usa o tunel
     *   REVOKED  - o dono cortou
     *   EXPIRED  - passou do prazo
     */
    status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'PENDING'
    },

    /**
     * Ate quando o acesso vale. NULL = indefinido.
     *
     * O prazo e escolhido pelo dono na hora de gerar (horas, dias, meses ou sem
     * fim) e conta a partir do ACEITE, nao da criacao: um convite gerado hoje e
     * aceito amanha daria um dia a menos se contasse da criacao.
     */
    expires_at: { type: DataTypes.DATE, allowNull: true },

    /**
     * A duracao ESCOLHIDA, como chave (ver utils/shareRules#DURACOES).
     *
     * Precisa sobreviver da criacao ate o aceite: `expires_at` so pode ser
     * calculado quando alguem aceita, e sem guardar a escolha aqui o prazo se
     * perderia no caminho.
     */
    duration_key: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'indefinido' },

    /** O mesmo prazo por extenso ("30 dias"), para a tela nao ter que traduzir. */
    duration_label: { type: DataTypes.STRING, allowNull: true },

    /**
     * Validade do CONVITE em si (nao do acesso). Um QR que ninguem escaneou nao
     * pode ficar valido para sempre numa foto antiga.
     */
    invite_expires_at: { type: DataTypes.DATE, allowNull: false },

    accepted_at: { type: DataTypes.DATE, allowNull: true },
    revoked_at: { type: DataTypes.DATE, allowNull: true },

    /** Nome que o convidado ve antes de aceitar, e o dono ve na lista. */
    guest_label: { type: DataTypes.STRING, allowNull: true }
}, {
    timestamps: true,
    indexes: [
        { fields: ['token'] },
        { fields: ['ConnectionId'] },
        { fields: ['GuestClientId'] },
        { fields: ['OwnerClientId'] }
    ]
});

/*
 * Associacoes declaradas aqui, e nao no controller.
 *
 * As de Connection/Client moram em connectionController.js por heranca, e isso
 * ja custou: quem faz `include` depende de o controller certo ter sido exigido
 * antes. Como este modelo nasce agora, ele traz as proprias.
 *
 * Dois aliases para a MESMA tabela Clients: o dono e o convidado sao ambos
 * clientes, e sem `as` o Sequelize nao consegue distinguir as duas chaves.
 */
ConnectionShare.belongsTo(Client, { foreignKey: 'OwnerClientId', as: 'Owner' });
ConnectionShare.belongsTo(Client, { foreignKey: 'GuestClientId', as: 'Guest' });
ConnectionShare.belongsTo(Connection, { foreignKey: 'ConnectionId' });

module.exports = ConnectionShare;
