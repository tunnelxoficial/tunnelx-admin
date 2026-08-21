const Connection = require('../models/Connection');
const Client = require('../models/Client');
const Plan = require('../models/Plan');

// Define associations if not defined elsewhere
Client.hasMany(Connection, { foreignKey: 'ClientId' });
Connection.belongsTo(Client, { foreignKey: 'ClientId' });
Plan.hasMany(Connection, { foreignKey: 'PlanId' });
Connection.belongsTo(Plan, { foreignKey: 'PlanId' });

exports.getAll = async (req, res) => {
    try {
        // config contem a chave PRIVADA do peer e qrcode e um BLOB serializado como
        // array de inteiros (~5 bytes de JSON por byte). Nenhum dos dois e usado na
        // listagem: a tela busca os dois sob demanda em GET /connections/:id/files.
        const connections = await Connection.findAll({
            attributes: { exclude: ['config', 'qrcode'] },
            include: [
                { model: Client, attributes: ['name', 'email', 'cpf', 'whatsapp'] },
                { model: Plan, attributes: ['name', 'dataLimit'] }
            ],
            order: [['id', 'DESC']]
        });
        res.json(connections);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar conexões.' });
    }
};

exports.create = async (req, res) => {
    try {
        const { status, clientId, planId } = req.body;

        // Antes, cliente ou plano inexistente passavam em silencio: a conexao nascia
        // com campos NOT NULL undefined (erro 500 generico) ou com data_limit 0, e
        // mesmo assim entrava na fila de provisionamento.
        if (!clientId) return res.status(400).json({ message: 'Selecione um cliente.' });
        const client = await Client.findByPk(clientId);
        if (!client) return res.status(404).json({ message: 'Cliente nao encontrado.' });

        if (!planId) return res.status(400).json({ message: 'Selecione um plano.' });
        const plan = await Plan.findByPk(planId);
        if (!plan) return res.status(404).json({ message: 'Plano nao encontrado.' });
        if (!plan.dataLimit || plan.dataLimit <= 0) {
            return res.status(400).json({ message: 'Plano sem pacote de dados definido.' });
        }

        const newConnection = await Connection.create({
            name: client.name,
            cpf: client.cpf,
            phone: client.whatsapp,
            email: client.email,
            total_connections: plan.total_connections || 1,
            data_limit: plan.dataLimit,
            status: status || 'payment_pending',
            payment_status: 'WAIT',
            status_queue: 'WAIT',
            ClientId: clientId,
            PlanId: planId
        });

        res.status(201).json(newConnection);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar conexão.', detail: error.message });
    }
};

exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, cpf, phone, email, status, internet, clientId, planId } = req.body;

        const connection = await Connection.findByPk(id);
        if (!connection) {
            return res.status(404).json({ message: 'Conexão não encontrada.' });
        }

        let clientData = { name, cpf, phone, email };
        let finalDataLimit = connection.data_limit;
        let finalTotalConnections = connection.total_connections;

        if (clientId) {
            const client = await Client.findByPk(clientId);
            if (client) {
                clientData = {
                    name: client.name,
                    cpf: client.cpf,
                    phone: client.whatsapp,
                    email: client.email
                };
            }
        }

        if (planId) {
            const plan = await Plan.findByPk(planId);
            if (plan) {
                finalDataLimit = plan.dataLimit;
                finalTotalConnections = plan.total_connections;
            }
        }

        await connection.update({
            name: clientData.name,
            cpf: clientData.cpf,
            phone: clientData.phone,
            email: clientData.email,
            total_connections: finalTotalConnections,
            data_limit: finalDataLimit,
            status,
            internet,
            ClientId: clientId,
            PlanId: planId
        });

        res.json(connection);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao atualizar conexão.' });
    }
};

exports.delete = async (req, res) => {
    try {
        const { id } = req.params;
        const connection = await Connection.findByPk(id);
        
        if (!connection) {
            return res.status(404).json({ message: 'Conexão não encontrada.' });
        }

        await connection.destroy();
        res.json({ message: 'Conexão removida com sucesso.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao remover conexão.' });
    }
};

exports.toggleInternet = async (req, res) => {
    try {
        const { id } = req.params;
        const connection = await Connection.findByPk(id);
        
        if (!connection) {
            return res.status(404).json({ message: 'Conexão não encontrada.' });
        }

        await connection.update({ internet: !connection.internet });
        res.json(connection);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao alterar status da internet.' });
    }
};


// Entrega config (.conf) e QR de UMA conexao, ja prontos para consumo no browser.
// Antes a tela baixava GET /connections inteiro e filtrava no cliente, recebendo o
// BLOB como {type:'Buffer',data:[...]} e tentando reconstruir com
// String.fromCharCode.apply -- que estoura a pilha em PNG grande.
exports.getFiles = async (req, res) => {
    try {
        const connection = await Connection.findByPk(req.params.id, {
            attributes: ['id', 'name', 'status_queue', 'config', 'qrcode', 'updatedAt']
        });
        if (!connection) return res.status(404).json({ message: 'Conexão não encontrada.' });

        res.json({
            id: connection.id,
            name: connection.name,
            status_queue: connection.status_queue,
            updatedAt: connection.updatedAt,
            config: connection.config || null,
            qrcode_base64: connection.qrcode ? Buffer.from(connection.qrcode).toString('base64') : null
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao obter arquivos da conexão.' });
    }
};

// Devolve a conexao para a fila de provisionamento. O worker (TunnelX Manager) so
// enxerga status_queue = 'WAIT', entao 'CREATED' era um estado terminal: config e
// qrcode ficavam congelados com o Endpoint vigente no momento da geracao, e a unica
// saida era apagar a conexao e refazer a venda.
exports.reprovision = async (req, res) => {
    try {
        const connection = await Connection.findByPk(req.params.id);
        if (!connection) return res.status(404).json({ message: 'Conexão não encontrada.' });

        if (connection.status_queue === 'WAIT') {
            return res.status(409).json({ message: 'Esta conexão já está na fila de provisionamento.' });
        }

        // config/qrcode sao mantidos ate o worker sobrescrever, para nao deixar o
        // operador sem arquivo nenhum durante o intervalo de 60s do timer.
        await connection.update({ status_queue: 'WAIT' });

        res.json({
            message: 'Conexão reenviada para a fila de provisionamento.',
            id: connection.id,
            status_queue: connection.status_queue
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao reenfileirar a conexão.' });
    }
};
