let currentStep = 1;
const totalSteps = 4;
let cachedPlans = [];

const formData = {
    // Step 1
    name: '',
    cpf: '',
    email: '',
    phone: '', // whatsapp
    
    // Step 2
    cep: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    uf: '',

    // Step 3
    planId: null,

    // Step 4
    cardName: '',
    cardNumber: '',
    cardExpiry: '',
    cardCvc: ''
};

document.addEventListener('DOMContentLoaded', () => {
    init();
});

function init() {
    updateUI();
    loadPlans();
    
    // Masking helpers (simple version)
    setupMasks();
}

function setupMasks() {
    const cpfInput = document.getElementById('cpf');
    if (cpfInput) {
        cpfInput.addEventListener('input', (e) => {
            let v = e.target.value.replace(/\D/g, '');
            if (v.length > 11) v = v.slice(0, 11);
            e.target.value = v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
        });
    }

    const phoneInput = document.getElementById('phone');
    if (phoneInput) {
        phoneInput.addEventListener('input', (e) => {
            let v = e.target.value.replace(/\D/g, '');
            if (v.length > 11) v = v.slice(0, 11);
            if (v.length > 10) {
                 e.target.value = v.replace(/^(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
            } else {
                 e.target.value = v.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
            }
        });
    }

    const cepInput = document.getElementById('cep');
    if (cepInput) {
        cepInput.addEventListener('blur', async (e) => {
            const cep = e.target.value.replace(/\D/g, '');
            if (cep.length === 8) {
                await fetchAddress(cep);
            }
        });
        cepInput.addEventListener('input', (e) => {
            let v = e.target.value.replace(/\D/g, '');
            if (v.length > 8) v = v.slice(0, 8);
            e.target.value = v.replace(/^(\d{5})(\d{3})/, '$1-$2');
        });
    }
    
    // Credit Card Masks
    const ccNumber = document.getElementById('cardNumber');
    if (ccNumber) {
        ccNumber.addEventListener('input', (e) => {
            let v = e.target.value.replace(/\D/g, '');
            if (v.length > 16) v = v.slice(0, 16);
            e.target.value = v.replace(/(\d{4})(?=\d)/g, '$1 ');
            updateCardPreview();
        });
    }
    
    const ccName = document.getElementById('cardName');
    if (ccName) ccName.addEventListener('input', updateCardPreview);
    
    const ccExpiry = document.getElementById('cardExpiry');
    if (ccExpiry) {
        ccExpiry.addEventListener('input', (e) => {
            let v = e.target.value.replace(/\D/g, '');
            if (v.length > 4) v = v.slice(0, 4);
            if (v.length >= 2) {
                e.target.value = v.slice(0, 2) + '/' + v.slice(2);
            } else {
                e.target.value = v;
            }
            updateCardPreview();
        });
    }
}

async function fetchAddress(cep) {
    try {
        document.getElementById('cep').parentElement.classList.add('loading');
        const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const data = await response.json();
        
        if (!data.erro) {
            document.getElementById('logradouro').value = data.logradouro;
            document.getElementById('bairro').value = data.bairro;
            document.getElementById('cidade').value = data.localidade;
            document.getElementById('uf').value = data.uf;
            document.getElementById('numero').focus();
        }
    } catch (error) {
        console.error('Erro ao buscar CEP', error);
    } finally {
        document.getElementById('cep').parentElement.classList.remove('loading');
    }
}

function updateCardPreview() {
    const num = document.getElementById('cardNumber').value || '0000 0000 0000 0000';
    const name = document.getElementById('cardName').value || 'NOME DO TITULAR';
    const expiry = document.getElementById('cardExpiry').value || 'MM/AA';
    
    document.querySelector('.preview-number').textContent = num;
    document.querySelector('.preview-name').textContent = name.toUpperCase();
    document.querySelector('.preview-expiry').textContent = expiry;

    // Detect Card Brand
    const cardIcon = document.querySelector('.credit-card-preview i');
    const cleanNum = num.replace(/\s+/g, '');
    let iconClass = 'fa-brands fa-cc-visa'; // default

    if (/^5[1-5]/.test(cleanNum) || /^2[2-7]/.test(cleanNum)) {
        iconClass = 'fa-brands fa-cc-mastercard';
    } else if (/^3[47]/.test(cleanNum)) {
        iconClass = 'fa-brands fa-cc-amex';
    } else if (/^6(?:011|5)/.test(cleanNum)) {
        iconClass = 'fa-brands fa-cc-discover';
    } else if (/^3(?:0[0-5]|[68])/.test(cleanNum)) {
        iconClass = 'fa-brands fa-cc-diners-club';
    } else if (/^35/.test(cleanNum)) {
        iconClass = 'fa-brands fa-cc-jcb';
    } else if (/^4/.test(cleanNum)) {
        iconClass = 'fa-brands fa-cc-visa';
    }

    cardIcon.className = iconClass;
}

async function loadPlans() {
    try {
        const plans = await Api.get('/plans');
        cachedPlans = plans;
        const container = document.getElementById('plans-container');
        
        if (plans.length === 0) {
            container.innerHTML = '<p>Nenhum plano disponível no momento.</p>';
            return;
        }
        
        container.innerHTML = plans.map(plan => {
            let totalProductPrice = 0;
            let hasProducts = false;
            
            if (plan.products && plan.products.length > 0) {
                totalProductPrice = plan.products.reduce((acc, p) => acc + parseFloat(p.valor), 0);
                hasProducts = true;
            }

            let priceDisplay = '';
            let noteDisplay = '';

            if (hasProducts) {
                priceDisplay = `
                    <div style="display: flex; flex-direction: column; gap: 0.25rem;">
                        <div style="font-size: 1.25rem; font-weight: 700; color: var(--primary-color);">
                            R$ ${totalProductPrice.toFixed(2).replace('.', ',')} <span style="font-size: 0.8rem; font-weight: 400; color: var(--text-color);">hoje</span>
                        </div>
                        <div style="font-size: 0.9rem; color: var(--text-light);">
                            + R$ ${parseFloat(plan.price).toFixed(2).replace('.', ',')}/${plan.cycle.toLowerCase()} (próx. mês)
                        </div>
                    </div>
                `;
                noteDisplay = `<li style="color: var(--primary-color); font-weight: 500;"><i class="fa-solid fa-gift"></i> Inclui equipamentos/instalação</li>`;
            } else {
                priceDisplay = `
                    <div class="plan-price">
                        R$ ${parseFloat(plan.price).toFixed(2).replace('.', ',')}
                        <span style="font-size: 0.8rem; font-weight: 400; color: var(--text-light);">/${plan.cycle.toLowerCase()}</span>
                    </div>
                `;
                noteDisplay = `<li style="color: var(--text-light); font-size: 0.85rem;"><i class="fa-solid fa-calendar-check"></i> Cobrança imediata</li>`;
            }

            return `
            <div class="plan-card" onclick="selectPlan(${plan.id}, this)" data-id="${plan.id}">
                <div class="plan-name">${plan.name}</div>
                ${priceDisplay}
                <div class="plan-data">${plan.dataLimit} MB</div>
                <ul class="plan-features">
                    <li><i class="fa-solid fa-check" style="color: var(--secondary-color)"></i> Conexões: ${plan.total_connections || 1}</li>
                    <li><i class="fa-solid fa-check" style="color: var(--secondary-color)"></i> Suporte 24/7</li>
                    <li><i class="fa-solid fa-check" style="color: var(--secondary-color)"></i> Alta Velocidade</li>
                    ${noteDisplay}
                </ul>
            </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Erro ao carregar planos', error);
        document.getElementById('plans-container').innerHTML = '<p class="error">Erro ao carregar planos.</p>';
    }
}

function selectPlan(id, element) {
    formData.planId = id;
    
    // Update UI
    document.querySelectorAll('.plan-card').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');
}

function nextStep() {
    if (!validateStep(currentStep)) return;
    
    saveStepData(currentStep);
    
    if (currentStep < totalSteps) {
        currentStep++;
        updateUI();
    } else {
        submitForm();
    }
}

function prevStep() {
    if (currentStep > 1) {
        currentStep--;
        updateUI();
    }
}

function validateStep(step) {
    let isValid = true;
    const panel = document.getElementById(`step-${step}`);
    const inputs = panel.querySelectorAll('input[required], select[required]');
    
    inputs.forEach(input => {
        if (!input.value.trim()) {
            isValid = false;
            input.style.borderColor = 'red';
            setTimeout(() => input.style.borderColor = '', 3000);
        }
    });
    
    if (step === 3 && !formData.planId) {
        isValid = false;
        alert('Por favor, selecione um plano.');
    }
    
    return isValid;
}

function saveStepData(step) {
    if (step === 1) {
        formData.name = document.getElementById('name').value;
        formData.email = document.getElementById('email').value;
        formData.phone = document.getElementById('phone').value;
        formData.cpf = document.getElementById('cpf').value;
    } else if (step === 2) {
        formData.cep = document.getElementById('cep').value;
        formData.logradouro = document.getElementById('logradouro').value;
        formData.numero = document.getElementById('numero').value;
        formData.complemento = document.getElementById('complemento').value;
        formData.bairro = document.getElementById('bairro').value;
        formData.cidade = document.getElementById('cidade').value;
        formData.uf = document.getElementById('uf').value;
    } else if (step === 4) {
        formData.cardName = document.getElementById('cardName').value;
        formData.cardNumber = document.getElementById('cardNumber').value;
        formData.cardExpiry = document.getElementById('cardExpiry').value;
        formData.cardCvc = document.getElementById('cardCvc').value;
    }
}

function updateUI() {
    // Update Panels
    document.querySelectorAll('.step-panel').forEach(panel => panel.classList.remove('active'));
    document.getElementById(`step-${currentStep}`).classList.add('active');
    
    // Update Steps Indicator
    document.querySelectorAll('.step-item').forEach((item, index) => {
        const stepNum = index + 1;
        item.classList.remove('active', 'completed');
        if (stepNum === currentStep) item.classList.add('active');
        if (stepNum < currentStep) item.classList.add('completed');
    });
    
    // Update Buttons
    const prevBtn = document.getElementById('btn-prev');
    const nextBtn = document.getElementById('btn-next');
    
    prevBtn.style.visibility = currentStep === 1 ? 'hidden' : 'visible';
    nextBtn.textContent = currentStep === totalSteps ? 'Finalizar Pagamento' : 'Próximo';

    if (currentStep === 4) {
        updateCheckoutSummary();
    }
}

function updateCheckoutSummary() {
    const summary = document.getElementById('checkout-summary');
    if (!summary) return;

    const plan = cachedPlans.find(p => p.id == formData.planId);
    if (!plan) {
        summary.innerHTML = '<p>Plano não selecionado.</p>';
        return;
    }

    let totalProductPrice = 0;
    let hasProducts = false;
    if (plan.products && plan.products.length > 0) {
        totalProductPrice = plan.products.reduce((acc, p) => acc + parseFloat(p.valor), 0);
        hasProducts = true;
    }

    let html = '';
    if (hasProducts) {
        html = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <span style="font-weight: 500;">Plano:</span>
                <span>${plan.name}</span>
            </div>
            <hr style="margin: 0.5rem 0; border-color: var(--border-color); opacity: 0.5;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <span style="color: var(--text-light);">Adesão / Equipamentos:</span>
                <span style="font-weight: 600;">R$ ${totalProductPrice.toFixed(2).replace('.', ',')}</span>
            </div>
             <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-light);">Mensalidade (próx. mês):</span>
                <span>R$ ${parseFloat(plan.price).toFixed(2).replace('.', ',')}</span>
            </div>
            <div style="margin-top: 1rem; text-align: right; font-size: 1.1rem; font-weight: 700; color: var(--primary-color);">
                Total Hoje: R$ ${totalProductPrice.toFixed(2).replace('.', ',')}
            </div>
        `;
    } else {
        html = `
             <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <span style="font-weight: 500;">Plano:</span>
                <span>${plan.name}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-light);">Mensalidade:</span>
                <span style="font-weight: 600;">R$ ${parseFloat(plan.price).toFixed(2).replace('.', ',')}</span>
            </div>
             <div style="margin-top: 1rem; text-align: right; font-size: 1.1rem; font-weight: 700; color: var(--primary-color);">
                Total Hoje: R$ ${parseFloat(plan.price).toFixed(2).replace('.', ',')}
            </div>
        `;
    }

    summary.innerHTML = html;
}

async function submitForm() {
    const nextBtn = document.getElementById('btn-next');
    nextBtn.disabled = true;
    nextBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processando...';
    
    try {
        // Prepare Checkout Data
        const [expMonth, expYear] = formData.cardExpiry.split('/');
        
        const payload = {
            clientData: {
                name: formData.name,
                email: formData.email,
                whatsapp: formData.phone,
                cpf: formData.cpf,
                cep: formData.cep,
                logradouro: formData.logradouro,
                complemento: formData.complemento,
                bairro: formData.bairro,
                cidade: formData.cidade,
                uf: formData.uf
            },
            planId: formData.planId,
            cardData: {
                holderName: formData.cardName,
                number: formData.cardNumber.replace(/\s+/g, ''),
                expiryMonth: expMonth,
                expiryYear: '20' + expYear,
                ccv: formData.cardCvc
            }
        };

        // Call Checkout Endpoint
        const response = await Api.post('/checkout', payload);
        
        // Show Success
        showSuccess();
        
    } catch (error) {
        console.error('Erro no checkout:', error);
        alert('Erro ao processar seu pagamento: ' + (error.message || 'Verifique os dados do cartão e tente novamente.'));
        nextBtn.disabled = false;
        nextBtn.textContent = 'Finalizar Pagamento';
    }
}

function showSuccess() {
    // Hide all steps
    document.querySelectorAll('.step-panel').forEach(panel => panel.classList.remove('active'));
    
    // Show success step
    document.getElementById('step-success').classList.add('active');
    
    // Hide footer
    document.querySelector('.checkout-footer').style.display = 'none';
    
    // Update all steps to completed visual state
    document.querySelectorAll('.step-item').forEach(item => {
        item.classList.remove('active');
        item.classList.add('completed');
    });
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
