const fs = require('path') && require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

/**
 * Prepara o .env para o Asaas em PRODUCAO.
 *
 * A chave nao e digitada aqui nem passada por argumento: ela e extraida do
 * proprio historico do git, de onde estava escrita em services/asaasService.js
 * antes de sair do codigo. O valor nunca e impresso — so o hash curto, para
 * conferencia.
 *
 * Isto NAO resolve o vazamento. A chave esta no historico do repositorio e
 * continuara la; ela precisa ser REVOGADA no painel do Asaas e substituida.
 * Este script so para de exigir que ela viva dentro do codigo-fonte.
 *
 * Rodar:  node scripts/setup_asaas_env.js
 */

const RAIZ = path.join(__dirname, '..');
const ENV = path.join(RAIZ, '.env');

function chaveDoHistorico() {
    try {
        // Ultimo commit que ainda tinha a chave no arquivo.
        const commit = execSync(
            'git log --format=%H -S "aact_prod" -1 -- backend/services/asaasService.js',
            { cwd: path.join(RAIZ, '..'), encoding: 'utf8' }
        ).trim();
        if (!commit) return null;

        const conteudo = execSync(
            `git show ${commit}:backend/services/asaasService.js`,
            { cwd: path.join(RAIZ, '..'), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
        );

        const m = conteudo.match(/ASAAS_API_KEY\s*=\s*'([^']+)'/);
        return m ? m[1] : null;
    } catch (e) {
        console.error('Nao foi possivel ler a chave do historico:', e.message);
        return null;
    }
}

function impressaoDigital(valor) {
    return crypto.createHash('sha256').update(valor).digest('hex').slice(0, 12);
}

function main() {
    let env = fs.readFileSync(ENV, 'utf8');
    if (!env.endsWith('\n')) env += '\n';

    const jaTemChave = /^ASAAS_API_KEY=/m.test(env);
    const jaTemToken = /^ASAAS_WEBHOOK_TOKEN=/m.test(env);
    const jaTemUrl = /^ASAAS_URL=/m.test(env);

    const adicoes = [];

    if (!jaTemUrl) {
        adicoes.push('');
        adicoes.push('# Asaas — ambiente de PRODUCAO');
        adicoes.push('ASAAS_URL=https://api.asaas.com/v3');
    }

    if (jaTemChave) {
        console.log('ASAAS_API_KEY ja estava no .env — mantida.');
    } else {
        const chave = chaveDoHistorico();
        if (!chave) {
            console.log('AVISO: chave nao encontrada no historico. Adicione ASAAS_API_KEY a mao.');
            adicoes.push('ASAAS_API_KEY=');
        } else {
            adicoes.push('ASAAS_API_KEY=' + chave);
            console.log('ASAAS_API_KEY definida a partir do historico do git.');
            console.log('  ambiente:   PRODUCAO (prefixo ' + chave.slice(0, 11) + '...)');
            console.log('  impressao:  ' + impressaoDigital(chave) + '  (sha256 curto, para conferir sem expor)');
        }
    }

    let token = null;
    if (jaTemToken) {
        console.log('ASAAS_WEBHOOK_TOKEN ja estava no .env — mantido.');
    } else {
        token = crypto.randomBytes(32).toString('hex');
        adicoes.push('ASAAS_WEBHOOK_TOKEN=' + token);
    }

    if (adicoes.length) {
        fs.writeFileSync(ENV, env + adicoes.join('\n') + '\n');
        console.log('\n.env atualizado.');
    } else {
        console.log('\nNada a fazer: .env ja estava configurado.');
    }

    if (token) {
        console.log('\n' + '='.repeat(68));
        console.log('TOKEN DO WEBHOOK — cole este valor no painel do Asaas');
        console.log('(Integracoes > Webhooks > campo "Token de autenticacao")');
        console.log('='.repeat(68));
        console.log(token);
        console.log('='.repeat(68));
        console.log('Sem esse token igual nos dois lados, o webhook RECUSA tudo');
        console.log('e nenhum pagamento vai ativar assinatura.');
    }

    console.log('\nLEMBRETE: a chave acima esteve commitada no repositorio.');
    console.log('Revogue-a no painel do Asaas e troque por uma nova.');
}

main();
