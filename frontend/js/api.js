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

    async toggleInternet(id) {
        // Since toggle uses PATCH and our Api class doesn't have it explicitly mapped, 
        // we can add it or just use custom request. Let's add patch support to Api class implicitly 
        // or just use request here.
        // Assuming Api class needs PATCH method. Let's add it quickly or use request.
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
