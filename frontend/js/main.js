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
        // pre-cadastro e o checkout do cliente final: nao tem login e nao pode
        // cair no redirecionamento do painel.
        return path.includes('login.html')
            || path.includes('register.html')
            || path.includes('pre-cadastro.html');
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
                        <img src="img/logo.png" alt="TunnelX" style="height: 30px;">
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
                    <button id="mobile-menu-toggle" class="d-md-none" aria-label="Abrir menu">
                        <i class="fa-solid fa-bars"></i>
                    </button>
                    <h2>${this.getPageTitle()}</h2>
                </div>
                <div class="header-right">
                    <div class="user-profile">
                        <span class="d-none-md">${name}</span>
                        <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1356C1&color=fff&bold=true" alt="${name}">
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
            const fechar = () => {
                sidebar.classList.remove('show');
                overlay.classList.remove('show');
            };

            toggleBtn.addEventListener('click', () => {
                sidebar.classList.add('show');
                overlay.classList.add('show');
            });

            overlay.addEventListener('click', fechar);
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });

            // Close when clicking a link (optional but good UX)
            const links = sidebar.querySelectorAll('a');
            links.forEach(link => link.addEventListener('click', fechar));
        }
    }
}

/* =============================================================================
   Avisos (toasts)

   Substituem o alert(). O alert bloqueia a pagina inteira ate o clique, fica no
   meio da tela longe de onde a acao aconteceu e nao distingue erro de sucesso -
   a mensagem chega com a mesma cara nos dois casos.
   ========================================================================== */
window.Toast = {
    ICONES: {
        success: 'fa-solid fa-circle-check',
        error: 'fa-solid fa-circle-exclamation',
        warning: 'fa-solid fa-triangle-exclamation',
        info: 'fa-solid fa-circle-info'
    },

    container() {
        let c = document.getElementById('toast-container');
        if (!c) {
            c = document.createElement('div');
            c.id = 'toast-container';
            document.body.appendChild(c);
        }
        return c;
    },

    /**
     * Deduz o tom pela mensagem.
     *
     * As 28 chamadas de alert() espalhadas pelas paginas nao dizem o tipo - a
     * informacao esta no texto ("Erro ao salvar", "CEP invalido"). Ler o texto
     * evita ter que editar cada chamada adivinhando a intencao, o que seria
     * onde os erros entrariam.
     */
    tipoPeloTexto(msg) {
        const t = String(msg || '').toLowerCase();
        if (/erro|falha|inválid|invalid|não foi possível|nao foi possivel|negad/.test(t)) return 'error';
        if (/sucesso|salvo|criado|atualizado|removido|concluíd|concluid|importad/.test(t)) return 'success';
        if (/selecione|informe|preencha|ainda não|ainda nao|não encontrad|nao encontrad|antes/.test(t)) return 'warning';
        return 'info';
    },

    show(msg, tipo, duracao) {
        if (!msg) return;
        const t = tipo || this.tipoPeloTexto(msg);
        // Erro fica mais tempo: costuma trazer detalhe tecnico para ler.
        const ms = duracao || (t === 'error' ? 7000 : 4000);

        const el = document.createElement('div');
        el.className = `toast toast-${t}`;
        el.setAttribute('role', t === 'error' ? 'alert' : 'status');
        el.innerHTML = `
            <i class="${this.ICONES[t] || this.ICONES.info}"></i>
            <div class="toast-msg"></div>
            <button class="toast-close" aria-label="Fechar">&times;</button>
        `;
        // textContent, e nao innerHTML: a mensagem costuma vir de error.message,
        // que pode carregar texto do servidor.
        el.querySelector('.toast-msg').textContent = msg;

        const sair = () => {
            el.classList.add('is-out');
            setTimeout(() => el.remove(), 200);
        };

        el.querySelector('.toast-close').addEventListener('click', sair);
        this.container().appendChild(el);
        setTimeout(sair, ms);
        return el;
    },

    success(m, d) { return this.show(m, 'success', d); },
    error(m, d) { return this.show(m, 'error', d); },
    warning(m, d) { return this.show(m, 'warning', d); },
    info(m, d) { return this.show(m, 'info', d); }
};

/* =============================================================================
   Modal
   ========================================================================== */
class Modal {
    /**
     * @param {object}   o
     * @param {string}   o.title
     * @param {string}   o.content      HTML do corpo
     * @param {string}   o.confirmText
     * @param {Function} o.onConfirm    async; devolver false cancela o fechamento
     * @param {string}   o.type         primary | danger | success
     * @param {string}   o.size         sm | md | lg
     * @param {boolean}  o.hideCancel
     * @param {Function} o.onOpen       recebe o elemento do modal ja no DOM
     */
    static show({ title, content, confirmText = 'Confirmar', cancelText = 'Cancelar', onConfirm, onOpen, onClose, type = 'primary', size = '', hideCancel = false }) {
        let container = document.getElementById('modal-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'modal-container';
            document.body.appendChild(container);
        }

        /*
         * Cada modal e dono do PROPRIO elemento, em vez de todos dividirem o
         * innerHTML do container.
         *
         * Com o container compartilhado, um modal aberto de dentro do onConfirm
         * de outro era destruido pelo fechamento do primeiro: a senha gerada
         * aparecia e sumia em ~200ms, que e o tempo da animacao de saida. Agora
         * fechar remove apenas o proprio no, e o que veio depois sobrevive.
         */
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
            <div class="modal-overlay" role="dialog" aria-modal="true">
                <div class="modal-content ${size ? 'modal-' + size : ''}">
                    <div class="modal-header">
                        <h3>${title}</h3>
                        <button class="close-modal" aria-label="Fechar">&times;</button>
                    </div>
                    <div class="modal-body">
                        ${content}
                    </div>
                    <div class="modal-footer">
                        ${hideCancel ? '' : `<button class="btn btn-secondary modal-cancel">${cancelText}</button>`}
                        <button class="btn btn-${type} modal-confirm">${confirmText}</button>
                    </div>
                </div>
            </div>
        `;

        container.appendChild(wrapper);

        const overlay = wrapper.querySelector('.modal-overlay');
        const closeBtn = wrapper.querySelector('.close-modal');
        const cancelBtn = wrapper.querySelector('.modal-cancel');
        const confirmBtn = wrapper.querySelector('.modal-confirm');

        // A classe .show entra no frame seguinte: aplicada junto com o elemento,
        // o navegador nao tem estado anterior para interpolar e a transicao de
        // entrada simplesmente nao acontece.
        requestAnimationFrame(() => overlay.classList.add('show'));

        let fechado = false;
        const close = (confirmado) => {
            if (fechado) return;
            fechado = true;
            overlay.classList.remove('show');
            document.removeEventListener('keydown', aoTeclar);
            // Remove SO o proprio no, depois da animacao de saida.
            setTimeout(() => wrapper.remove(), 200);
            if (onClose) onClose(!!confirmado);
        };

        const aoTeclar = (e) => {
            if (e.key === 'Escape') close();
            // Enter confirma, menos dentro de textarea (onde ele quebra linha).
            if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !e.shiftKey) {
                const ativo = document.activeElement;
                if (ativo && ativo.tagName === 'BUTTON') return;
                e.preventDefault();
                confirmBtn.click();
            }
        };

        document.addEventListener('keydown', aoTeclar);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        closeBtn.addEventListener('click', close);
        if (cancelBtn) cancelBtn.addEventListener('click', close);

        confirmBtn.addEventListener('click', async () => {
            if (!onConfirm) { close(); return; }
            // Trava o botao durante a chamada: sem isso o duplo clique dispara
            // dois POSTs e cria o registro duas vezes.
            confirmBtn.classList.add('is-loading');
            try {
                const r = await onConfirm();
                if (r !== false) close(true);
            } finally {
                confirmBtn.classList.remove('is-loading');
            }
        });

        // Foco no primeiro campo: o operador sai do clique ja digitando.
        const primeiro = wrapper.querySelector('.modal-body input:not([type=hidden]):not([disabled]), .modal-body select, .modal-body textarea');
        if (primeiro) setTimeout(() => primeiro.focus(), 120);

        Masks.bind(wrapper);
        if (onOpen) onOpen(wrapper.querySelector('.modal-content'));
    }

    /**
     * Confirmação curta — devolve Promise<boolean>.
     *
     * Resolve pelo onClose do próprio modal, que dispara tanto no confirmar
     * quanto no cancelar, no Esc e no clique fora. Sondar o DOM para descobrir
     * se fechou deixaria a promise pendurada em qualquer caminho não previsto.
     */
    static confirm({ title, message, confirmText = 'Confirmar', type = 'danger' }) {
        return new Promise((resolve) => {
            Modal.show({
                title,
                size: 'sm',
                content: `<p style="margin:0;color:var(--text-color);">${message}</p>`,
                confirmText,
                type,
                onConfirm: () => {},
                onClose: (confirmado) => resolve(confirmado)
            });
        });
    }
}

/* =============================================================================
   Máscaras

   Aplicadas por atributo (data-mask="cpf") e ligadas sozinhas, inclusive no
   conteudo que chega depois - formulario de modal, linha de tabela renderizada
   por JS. Antes cada campo repetia um oninput="this.value = Masks.cpf(...)" na
   marcacao, e bastava esquecer um para o campo aceitar qualquer coisa.
   ========================================================================== */
window.Masks = {
    cpf(value) {
        if (!value) return '';
        return value
            .replace(/\D/g, '')
            .slice(0, 11)
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    },

    phone(value) {
        if (!value) return '';
        let r = value.replace(/\D/g, '').replace(/^0/, '').slice(0, 11);
        if (r.length > 10) return r.replace(/^(\d\d)(\d{5})(\d{4}).*/, '($1) $2-$3');
        if (r.length > 6) return r.replace(/^(\d\d)(\d{4})(\d{0,4}).*/, '($1) $2-$3');
        if (r.length > 2) return r.replace(/^(\d\d)(\d{0,5}).*/, '($1) $2');
        if (r.length > 0) return r.replace(/^(\d*)/, '($1');
        return '';
    },

    cep(value) {
        if (!value) return '';
        return value.replace(/\D/g, '').slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
    },

    /** Só dígitos — quantidade de estoque, número do endereço. */
    number(value) {
        return String(value || '').replace(/\D/g, '');
    },

    /**
     * Dinheiro, digitado da direita para a esquerda (centavos primeiro).
     *
     * É como quem opera caixa digita, e dispensa achar a vírgula no teclado.
     * O valor limpo para enviar sai de Masks.unmoney().
     */
    money(value) {
        const d = String(value || '').replace(/\D/g, '');
        if (!d) return '';
        const n = (parseInt(d, 10) / 100).toFixed(2);
        return n.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    },

    /** '1.234,56' -> '1234.56' (o que a API espera). */
    unmoney(value) {
        return String(value || '').replace(/\./g, '').replace(',', '.');
    },

    /** Dígitos de qualquer máscara — CPF e telefone viajam limpos na API. */
    digits(value) {
        return String(value || '').replace(/\D/g, '');
    },

    /**
     * Liga as máscaras dentro de `raiz`. Idempotente: o campo já ligado é
     * pulado, então chamar de novo depois de renderizar não duplica o handler.
     */
    bind(raiz = document) {
        raiz.querySelectorAll('[data-mask]').forEach((el) => {
            if (el.dataset.maskBound) return;
            el.dataset.maskBound = '1';

            const fn = this[el.dataset.mask];
            if (typeof fn !== 'function') return;

            const aplicar = () => { el.value = fn.call(this, el.value); };
            el.addEventListener('input', aplicar);
            if (el.value) aplicar();
        });
    }
};

/* Campos que nascem depois (modal, linha de tabela) também são ligados: o
   observador cobre o que o bind inicial não podia ver. */
function observarMascaras() {
    Masks.bind(document);
    new MutationObserver((muts) => {
        for (const m of muts) {
            for (const n of m.addedNodes) {
                if (n.nodeType === 1) Masks.bind(n);
            }
        }
    }).observe(document.body, { childList: true, subtree: true });
}

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    new AppLayout();
    observarMascaras();
});
