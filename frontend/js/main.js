class AppLayout {
    constructor() {
        this.sidebarItems = [
            { label: 'Início', icon: 'fa-solid fa-house', link: 'index.html' },
            { label: 'Conexões', icon: 'fa-solid fa-network-wired', link: 'conexoes.html' },
            { label: 'Clientes', icon: 'fa-solid fa-users', link: 'clientes.html' },
            { label: 'Produtos', icon: 'fa-solid fa-box', link: 'produtos.html' },
            { label: 'Estoque', icon: 'fa-solid fa-boxes-stacked', link: 'estoque.html' },
            { label: 'Planos', icon: 'fa-solid fa-clipboard-list', link: 'planos.html' }
        ];
        this.init();
    }

    init() {
        if (this.isPublicPage()) return;
        this.checkAuth();
        this.renderLayout();
        this.setupMobileNav();
        this.highlightCurrentPage();
    }

    isPublicPage() {
        const path = window.location.pathname;
        return path.includes('login.html') || path.includes('register.html');
    }

    checkAuth() {
        const isAuth = localStorage.getItem('tunnelx_auth');
        if (!isAuth) {
            window.location.href = 'login.html';
        }
    }

    renderLayout() {
        const app = document.getElementById('app');
        if (!app) return;

        // Create main structure
        app.innerHTML = `
            <div class="dashboard-container">
                <div class="sidebar-overlay"></div>
                ${this.getSidebarHTML()}
                <div class="main-content">
                    ${this.getHeaderHTML()}
                    <div class="content-body" id="page-content">
                        <!-- Page specific content goes here -->
                    </div>
                </div>
                ${this.getBottomNavHTML()}
            </div>
            <div id="modal-container"></div>
        `;
    }

    getSidebarHTML() {
        return `
            <aside class="sidebar">
                <div class="sidebar-header">
                    <div class="logo-area">
                        <img src="img/logo.png" alt="TunnelX" style="height: 32px;">
                        <span>TunnelX</span>
                    </div>
                </div>
                <nav class="sidebar-nav">
                    <ul>
                        ${this.sidebarItems.map(item => `
                            <li>
                                <a href="${item.link}" class="${this.isActive(item.link) ? 'active' : ''}">
                                    <i class="${item.icon}"></i>
                                    <span>${item.label}</span>
                                </a>
                            </li>
                        `).join('')}
                    </ul>
                </nav>
                <div class="sidebar-footer">
                    <a href="#" id="logout-btn">
                        <i class="fa-solid fa-right-from-bracket"></i>
                        <span>Sair</span>
                    </a>
                </div>
            </aside>
        `;
    }

    getHeaderHTML() {
        const user = JSON.parse(localStorage.getItem('tunnelx_user') || '{}');
        const name = user.username || 'Admin';
        return `
            <header class="top-header">
                <div class="header-left">
                    <button id="mobile-menu-toggle" class="d-md-none">
                        <i class="fa-solid fa-bars"></i>
                    </button>
                    <h2>${this.getPageTitle()}</h2>
                </div>
                <div class="header-right">
                    <div class="user-profile">
                        <img src="https://ui-avatars.com/api/?name=${name}&background=random" alt="${name}">
                        <span>${name}</span>
                    </div>
                </div>
            </header>
        `;
    }

    getBottomNavHTML() {
        return `
            <nav class="bottom-nav d-md-none">
                ${this.sidebarItems.map(item => `
                    <a href="${item.link}" class="bottom-nav-item ${this.isActive(item.link) ? 'active' : ''}">
                        <i class="${item.icon}"></i>
                        <span>${item.label}</span>
                    </a>
                `).join('')}
                <a href="#" id="mobile-logout-btn" class="bottom-nav-item">
                    <i class="fa-solid fa-right-from-bracket"></i>
                    <span>Sair</span>
                </a>
            </nav>
        `;
    }

    getPageTitle() {
        const path = window.location.pathname;
        if (path.includes('index.html')) return 'Início';
        if (path.includes('conexoes.html')) return 'Gerenciar Conexões';
        if (path.includes('clientes.html')) return 'Gerenciar Clientes';
        if (path.includes('produtos.html')) return 'Gerenciar Produtos';
        if (path.includes('estoque.html')) return 'Controle de Estoque';
        if (path.includes('planos.html')) return 'Gerenciar Planos';
        return 'Dashboard';
    }

    isActive(link) {
        return window.location.pathname.includes(link);
    }

    highlightCurrentPage() {
        // Handled by isActive in HTML generation
    }

    setupMobileNav() {
        // Logout logic
        const handleLogout = (e) => {
            e.preventDefault();
            localStorage.removeItem('tunnelx_auth');
            localStorage.removeItem('tunnelx_token');
            localStorage.removeItem('tunnelx_user');
            window.location.href = 'login.html';
        };

        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

        const mobileLogoutBtn = document.getElementById('mobile-logout-btn');
        if (mobileLogoutBtn) mobileLogoutBtn.addEventListener('click', handleLogout);
        
        // Mobile Sidebar Toggle
        const toggleBtn = document.getElementById('mobile-menu-toggle');
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');

        if (toggleBtn && sidebar && overlay) {
            toggleBtn.addEventListener('click', () => {
                sidebar.classList.add('show');
                overlay.classList.add('show');
            });

            overlay.addEventListener('click', () => {
                sidebar.classList.remove('show');
                overlay.classList.remove('show');
            });
            
            // Close when clicking a link (optional but good UX)
            const links = sidebar.querySelectorAll('a');
            links.forEach(link => {
                link.addEventListener('click', () => {
                     sidebar.classList.remove('show');
                     overlay.classList.remove('show');
                });
            });
        }
    }
}

// Global Modal Component
class Modal {
    static show({ title, content, confirmText = 'Confirmar', onConfirm, type = 'primary' }) {
        const container = document.getElementById('modal-container');
        if (!container) return;

        const modalHTML = `
            <div class="modal-overlay show">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>${title}</h3>
                        <button class="close-modal">&times;</button>
                    </div>
                    <div class="modal-body">
                        ${content}
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary modal-cancel">Cancelar</button>
                        <button class="btn btn-${type} modal-confirm">${confirmText}</button>
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = modalHTML;

        // Event Listeners
        const overlay = container.querySelector('.modal-overlay');
        const closeBtn = container.querySelector('.close-modal');
        const cancelBtn = container.querySelector('.modal-cancel');
        const confirmBtn = container.querySelector('.modal-confirm');

        const close = () => {
            container.innerHTML = '';
        };

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        closeBtn.addEventListener('click', close);
        cancelBtn.addEventListener('click', close);

        confirmBtn.addEventListener('click', async () => {
            if (onConfirm) {
                await onConfirm();
                close();
            }
        });
    }
}

// Global Masks Helper
window.Masks = {
    cpf(value) {
        if (!value) return "";
        return value
            .replace(/\D/g, '') // Remove tudo que não é dígito
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d{1,2})/, '$1-$2')
            .replace(/(-\d{2})\d+?$/, '$1');
    },
    phone(value) {
        if (!value) return "";
        let r = value.replace(/\D/g, "");
        r = r.replace(/^0/, "");
        if (r.length > 10) {
            r = r.replace(/^(\d\d)(\d{5})(\d{4}).*/, "($1) $2-$3");
        } else if (r.length > 5) {
            r = r.replace(/^(\d\d)(\d{4})(\d{0,4}).*/, "($1) $2-$3");
        } else if (r.length > 2) {
            r = r.replace(/^(\d\d)(\d{0,5}).*/, "($1) $2");
        } else {
            r = r.replace(/^(\d*)/, "($1");
        }
        return r;
    },
    cep(value) {
        return value
            .replace(/\D/g, '')
            .replace(/^(\d{5})(\d)/, '$1-$2')
            .slice(0, 9);
    }
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    new AppLayout();
});
