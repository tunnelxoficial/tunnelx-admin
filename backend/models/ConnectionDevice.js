const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const Client = require('./Client');
const Connection = require('./Connection');

/**
 * Um peer WireGuard por APARELHO — a correção da causa raiz.
 *
 * O modelo anterior dava um par de chaves por Connection (por PLANO), e as N
 * pessoas do plano recebiam o mesmo `.conf`. O WireGuard não suporta isso: ele
 * guarda, por peer, UM único `endpoint` — o IP:porta de onde veio o último
 * pacote autenticado. Com 8 aparelhos na mesma chave, cada um reescrevia esse
 * campo, e todo o tráfego de retorno passava a sair para quem falou por último.
 * As outras 7 pessoas paravam de receber resposta.
 *
 * Eram três falhas empilhadas, não uma:
 *
 *   1. Roubo de endpoint. Com `PersistentKeepalive = 15` no .conf, cada
 *      aparelho manda pacote a cada 15s MESMO PARADO — o revezamento era
 *      contínuo e determinístico, não ocasional. É a "oscilação" relatada.
 *   2. Disputa de sessão. O peer guarda poucos slots de keypair; a partir de 3
 *      aparelhos os handshakes se expulsam, gerando falha de decriptação e
 *      rehandshake em laço.
 *   3. Mesmo IP interno. Todos recebiam o mesmo /32, então o conntrack do NAT
 *      colidia e o retorno de um fluxo podia ir para quem não o abriu — falha
 *      que existiria mesmo com o endpoint estável.
 *
 * Aqui cada aparelho tem chave, IP e peer próprios. As três somem de uma vez, e
 * só então passa a ser possível medir consumo e aplicar limite de banda por
 * pessoa (`wg show` conta por peer).
 *
 * A CHAVE NATURAL É (ConnectionId, ClientId), não um id de instalação.
 *
 * A sessão única já garante uma conta por aparelho (ver Client.active_session_id),
 * então "aparelho" e "cliente naquele túnel" são a mesma coisa. Isso resolve de
 * graça o problema que um id gerado no app teria: reinstalar o aplicativo criaria
 * uma linha nova e vazaria uma vaga do plano a cada reinstalação. Com esta chave,
 * reinstalar reencontra o mesmo peer.
 *
 * `Plan.total_connections` passa a ser o limite de DEVICES por conexão — que é o
 * que a venda sempre significou ("8 pessoas no mesmo túnel"). A cobrança não muda.
 */
const ConnectionDevice = sequelize.define('ConnectionDevice', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },

    /** O túnel/plano a que este aparelho pertence. */
    ConnectionId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Connections', key: 'id' }
    },

    /** Quem usa este aparelho: o titular, ou um convidado. */
    ClientId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Clients', key: 'id' }
    },

    /**
     * O convite que deu origem a este aparelho, quando houver.
     *
     * Serve para o corte: revogar o convite precisa remover o peer, e sem esta
     * ligação seria preciso adivinhar qual device pertence a qual convite.
     */
    ConnectionShareId: {
        type: DataTypes.INTEGER,
        allowNull: true
    },

    /** Só para o painel e para a tela do titular dizerem "Moto G54". */
    device_name: { type: DataTypes.STRING(120), allowNull: true },

    /** Preenchidos pelo provisionador. Nulos enquanto na fila. */
    public_key: { type: DataTypes.STRING(64), allowNull: true },
    address: { type: DataTypes.STRING(32), allowNull: true },
    config: { type: DataTypes.TEXT, allowNull: true },
    qrcode: { type: DataTypes.BLOB, allowNull: true },

    /**
     * Mesma máquina de estados da fila de Connections.
     *
     *   WAIT → PROCESSING → CREATED   caminho normal
     *   WAIT → PROCESSING → WAIT      falha transitória
     *   WAIT → PROCESSING → FAILED    5 tentativas, para de girar
     */
    status_queue: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'WAIT'
    },
    queue_claimed_at: { type: DataTypes.DATE, allowNull: true },
    queue_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

    /**
     * Aparelho desativado: o titular removeu o convidado, ou a assinatura caiu.
     *
     * A linha não é apagada. O peer precisa ser removido do túnel pelo
     * provisionador, e sem um estado intermediário ninguém saberia que há
     * trabalho a fazer — o registro sumiria do banco com o peer ainda vivo no
     * servidor, exatamente o vazamento que já aconteceu antes neste produto.
     */
    revoked_at: { type: DataTypes.DATE, allowNull: true }
}, {
    timestamps: true,
    indexes: [
        { fields: ['ConnectionId'] },
        { fields: ['ClientId'] },
        { fields: ['status_queue'] }
    ]
});

ConnectionDevice.belongsTo(Connection, { foreignKey: 'ConnectionId' });
ConnectionDevice.belongsTo(Client, { foreignKey: 'ClientId' });

module.exports = ConnectionDevice;
