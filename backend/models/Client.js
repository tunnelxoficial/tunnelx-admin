const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Client = sequelize.define('Client', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    cpf: {
        type: DataTypes.STRING,
        allowNull: true
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            isEmail: true
        }
    },
    whatsapp: {
        type: DataTypes.STRING,
        allowNull: false
    },
    cep: {
        type: DataTypes.STRING,
        allowNull: true
    },
    uf: {
        type: DataTypes.STRING(2),
        allowNull: true
    },
    cidade: {
        type: DataTypes.STRING,
        allowNull: true
    },
    bairro: {
        type: DataTypes.STRING,
        allowNull: true
    },
    logradouro: {
        type: DataTypes.STRING,
        allowNull: true
    },
    complemento: {
        type: DataTypes.STRING,
        allowNull: true
    },
    password_hash: {
        type: DataTypes.STRING,
        allowNull: true
    },
    /**
     * A senha atual foi gerada pelo operador, nao escolhida pelo cliente.
     *
     * Toda senha que sai de `generatePassword` nasce provisoria: ela foi lida em
     * voz alta ou mandada por WhatsApp, entao ate o cliente trocar existe uma
     * copia dela fora do aparelho dele. Enquanto a marca estiver de pe o token
     * emitido no login so serve para trocar a senha - nao para baixar o .conf,
     * que carrega a chave privada do peer.
     *
     * Volta a false quando o proprio cliente define a senha dele pelo app.
     */
    password_is_provisional: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    }
}, {
    timestamps: true,
    /**
     * password_hash fora de toda consulta por padrao.
     *
     * GET /clients devolvia o hash de todo mundo para quem chamasse a rota. Hash
     * bcrypt nao e senha, mas e material para ataque offline - e nao ha motivo
     * nenhum para uma listagem de clientes carregar isso.
     *
     * Quem precisa do hash pede explicitamente: Client.scope('withPassword').
     */
    defaultScope: {
        attributes: { exclude: ['password_hash'] }
    },
    scopes: {
        withPassword: {}
    }
});

/*
 * NAO existe mais o hook beforeCreate que gravava '123456'.
 *
 * Ele dava a TODO cliente novo a mesma senha conhecida. Enquanto o app nao tinha
 * login isso era inofensivo; a partir de /app/login seria acesso liberado a chave
 * privada WireGuard de qualquer cliente por quem soubesse o CPF. Agora o cliente
 * nasce sem senha (password_hash NULL) e sem acesso ao app - o operador gera a
 * senha no momento de entregar o acesso.
 */

module.exports = Client;
