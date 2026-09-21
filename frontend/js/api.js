const BASE_URL = 'https://others-tunnelx-backed.pvuzyy.easypanel.host';

class Api {
    static getAuthToken() {
        return localStorage.getItem('tunnelx_token');
    }

    static async request(endpoint, method = 'GET', body = null) {
        const headers = {
            'Content-Type': 'application/json'
        };

        const token = this.getAuthToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const config = {
            method,
            headers,
        };

        if (body) {
            config.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(`${BASE_URL}${endpoint}`, config);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Erro na requisição');
            }

            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }

    static get(endpoint) {
        return this.request(endpoint, 'GET');
    }

    static post(endpoint, body) {
        return this.request(endpoint, 'POST', body);
    }

    static put(endpoint, body) {
        return this.request(endpoint, 'PUT', body);
    }

    static async delete(endpoint) {
        return this.request(endpoint, 'DELETE');
    }
}

// Connections helper
const Connections = {
    async getAll() {
        return await Api.get('/connections');
    },

    async create(data) {
        return await Api.post('/connections', data);
    },

    async update(id, data) {
        return await Api.put(`/connections/${id}`, data);
    },

    async delete(id) {
        return await Api.delete(`/connections/${id}`);
    },

    async getFiles(id) {
        return await Api.get(`/connections/${id}/files`);
    },

    async setPaymentStatus(id, status) {
        return await Api.request(`/connections/${id}/payment`, 'PATCH', { status });
    },

    async reprovision(id, incluirAparelhos = false) {
        return await Api.request(`/connections/${id}/reprovision`, 'PATCH', { incluirAparelhos });
    },

    /*
     * Manda o estado DESEJADO em vez de "inverta".
     *
     * Inverter as cegas e uma corrida: entre a tela desenhar a linha e o clique,
     * o vigia de cobranca pode ter cortado o cliente — e o clique que pretendia
     * cortar acabaria liberando. Com o valor explicito, a ordem vale o que diz.
     */
    async setInternet(id, ligada) {
        return await Api.request(`/connections/${id}/toggle-internet`, 'PATCH', { internet: !!ligada });
    },

    /** Compatibilidade: sem corpo, o backend mantem o comportamento de inverter. */
    async toggleInternet(id) {
        return await Api.request(`/connections/${id}/toggle-internet`, 'PATCH');
    }
};

// Clients helper
const Clients = {
    async getAll() {
        return await Api.get('/clients');
    },

    async create(data) {
        return await Api.post('/clients', data);
    },

    async update(id, data) {
        return await Api.put(`/clients/${id}`, data);
    },

    async delete(id) {
        return await Api.delete(`/clients/${id}`);
    },

    // Gera a senha de acesso do cliente ao aplicativo. A senha em claro vem SO
    // nesta resposta - o banco guarda apenas o hash. Nao ha como consulta-la
    // depois; a unica saida e gerar outra.
    async generatePassword(id) {
        return await Api.post(`/clients/${id}/password`, {});
    },

    // Revoga o acesso ao app sem apagar o cadastro nem as conexoes.
    async revokeAccess(id) {
        return await Api.delete(`/clients/${id}/password`);
    }
};

// Products helper
const Products = {
    async getAll() {
        return await Api.get('/products');
    },

    async create(data) {
        return await Api.post('/products', data);
    },

    async update(id, data) {
        return await Api.put(`/products/${id}`, data);
    },

    async delete(id) {
        return await Api.delete(`/products/${id}`);
    }
};

// Stocks helper
const Stocks = {
    async getAll() {
        return await Api.get('/stocks');
    },

    async create(data) {
        return await Api.post('/stocks', data);
    },

    async update(id, data) {
        return await Api.put(`/stocks/${id}`, data);
    },

    async registerMovement(id, type, quantity, reason) {
        return await Api.post(`/stocks/${id}/movement`, { type, quantity, reason });
    },

    async getHistory(id) {
        return await Api.get(`/stocks/${id}/history`);
    },

    async delete(id) {
        return await Api.delete(`/stocks/${id}`);
    }
};

// Plans helper
const Plans = {
    async getAll() {
        return await Api.get('/plans');
    },

    async create(data) {
        return await Api.post('/plans', data);
    },

    async update(id, data) {
        return await Api.put(`/plans/${id}`, data);
    },

    async delete(id) {
        return await Api.delete(`/plans/${id}`);
    }
};

// Dashboard helper
const Dashboard = {
    async getStats() {
        return await Api.get('/dashboard/stats');
    }
};

// Auth specific helper
const Auth = {
    async login(email, password) {
        try {
            const result = await Api.post('/auth/login', { email, password });
            if (result.token) {
                localStorage.setItem('tunnelx_token', result.token);
                localStorage.setItem('tunnelx_user', JSON.stringify(result.user));
                // Keep the old flag for compatibility with main.js or update main.js
                localStorage.setItem('tunnelx_auth', 'true'); 
            }
            return result;
        } catch (error) {
            throw error;
        }
    },

    async register(username, email, password) {
        return await Api.post('/auth/register', { username, email, password });
    },

    logout() {
        localStorage.removeItem('tunnelx_token');
        localStorage.removeItem('tunnelx_user');
        localStorage.removeItem('tunnelx_auth');
        window.location.href = 'login.html';
    },

    isAuthenticated() {
        return !!localStorage.getItem('tunnelx_token');
    }
};
