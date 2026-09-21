const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { connectDB, sequelize } = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const connectionRoutes = require('./routes/connectionRoutes');
const clientRoutes = require('./routes/clientRoutes');
const productRoutes = require('./routes/productRoutes');
const stockRoutes = require('./routes/stockRoutes');
const planRoutes = require('./routes/planRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const checkoutRoutes = require('./routes/checkoutRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const appRoutes = require('./routes/appRoutes');
/*
 * Modelos exigidos no boot, de proposito.
 *
 * ConnectionDevice so era carregado dentro dos handlers (require tardio em
 * deviceService). Isso o deixava fora do registro do Sequelize no boot, e
 * DB_SYNC nao criava a tabela — virava um no-op silencioso. Num ambiente onde
 * a migracao nao tivesse rodado, TODA chamada de /app/connections responderia
 * 500 com "Invalid object name ConnectionDevices", sem nada no boot avisando.
 */
require('./models/ConnectionDevice');
require('./models/ConnectionShare');

const { protectAdmin } = require('./middleware/auth');
const { limitarLogin, limitarCadastro, limitarConsulta } = require('./middleware/rateLimit');
const vigiaCobranca = require('./services/vigiaCobranca');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

/*
 * Atras de um proxy (EasyPanel/Traefik), req.ip sem isto e o IP do proxy —
 * o mesmo para todo mundo. O limitador por IP contaria a base inteira como
 * um cliente so e derrubaria todos juntos na primeira rajada.
 */
app.set('trust proxy', 1);

// Middleware
app.use(cors());

/*
 * Teto no corpo da requisicao.
 *
 * O padrao do body-parser e 100kb, mas explicitar aqui documenta a decisao:
 * nenhuma rota desta API recebe payload grande — o maior e o cadastro, com
 * endereco. Um teto baixo tira do ar o jeito mais barato de derrubar um
 * processo Node: mandar um JSON de 50 MB e deixar o parser comer a memoria.
 */
app.use(bodyParser.json({ limit: '64kb' }));

/* =============================================================================
   Superficies publicas

   Tres, e so estas tres. Cada uma tem a propria autenticacao, ou nao precisa
   de nenhuma por definicao.
   ========================================================================== */

// Login do painel. Aberto por definicao: e onde o token nasce.
app.use('/auth', authRoutes);

// Chamado pelo Asaas, nao por gente. Autenticado pelo header
// asaas-access-token dentro do proprio controller.
app.use('/webhook', webhookRoutes);

// Pre-cadastro do cliente final: quem contrata ainda nao tem conta.
app.use('/checkout', checkoutRoutes);

// Aplicativo do cliente (login por CPF). Escopo proprio: cada rota enxerga
// apenas o dono do token - ver routes/appRoutes.js.
app.use('/app', appRoutes);

/* =============================================================================
   Painel administrativo — tudo daqui para baixo exige token de admin

   O portao fica AQUI, no ponto de montagem, e nao rota a rota. Antes cada
   arquivo de rotas decidia sozinho, e o resultado foi que seis deles nao
   decidiram nada: /connections, /plans, /products, /stocks, /dashboard e
   quase todo o /clients respondiam a qualquer pessoa na internet.

   O caso mais grave era GET /connections/:id/files, que entrega o .conf de
   um cliente — e o .conf carrega a CHAVE PRIVADA do peer WireGuard. Bastava
   enumerar ids de 1 em diante para baixar a chave de toda a base.

   Montando o middleware no ponto de montagem de cada grupo, uma rota nova
   nasce protegida: nao ha o que esquecer de escrever.
   ========================================================================== */
app.use('/connections', protectAdmin, connectionRoutes);
app.use('/clients', protectAdmin, clientRoutes);
app.use('/products', protectAdmin, productRoutes);
app.use('/stocks', protectAdmin, stockRoutes);
// /plans e o unico grupo com portao POR ROTA: o GET e publico (a pagina de
// pre-cadastro lista o catalogo sem login) e a escrita e de admin.
// Ver routes/planRoutes.js.
app.use('/plans', planRoutes);
app.use('/dashboard', protectAdmin, dashboardRoutes);


/*
 * Health check de verdade: responde 503 quando o banco esta fora.
 *
 * A rota raiz respondia 200 com texto fixo, sem tocar em nada. Para um
 * balanceador ou um monitor isso significa "esta tudo bem" — inclusive com o
 * SQL Server inalcancavel e toda requisicao real falhando. Um health check
 * que nao pode falhar nao e um health check.
 */
app.get('/health', async (req, res) => {
    const inicio = Date.now();
    try {
        await sequelize.query('SELECT 1');
        res.json({
            status: 'ok',
            db_ms: Date.now() - inicio,
            uptime_s: Math.round(process.uptime())
        });
    } catch (error) {
        console.error('[health] banco inacessivel:', error.message);
        res.status(503).json({ status: 'degraded', db: 'unreachable' });
    }
});

// Base route
app.get('/', (req, res) => {
    res.send('TunnelX API is running...');
});

// Connect to DB and start server
connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });

    /*
     * So depois do banco de pe: o vigia consulta assinaturas e conexoes na
     * primeira passada, e subir antes so renderia erro no log.
     *
     * E ele que corta o inadimplente quando a carencia vence e devolve a
     * internet de quem pagou — sem depender de webhook chegar. Ate aqui o
     * backend nao tinha agendador nenhum.
     */
    vigiaCobranca.iniciar();
});
