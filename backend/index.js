const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { connectDB } = require('./config/db');
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
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Routes
app.use('/auth', authRoutes);
app.use('/connections', connectionRoutes);
app.use('/clients', clientRoutes);
app.use('/products', productRoutes);
app.use('/stocks', stockRoutes);
app.use('/plans', planRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/checkout', checkoutRoutes);
app.use('/webhook', webhookRoutes);
// Aplicativo do cliente (login por CPF). Escopo proprio: cada rota enxerga
// apenas o dono do token - ver routes/appRoutes.js.
app.use('/app', appRoutes);


// Base route
app.get('/', (req, res) => {
    res.send('TunnelX API is running...');
});

// Connect to DB and start server
connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
});
