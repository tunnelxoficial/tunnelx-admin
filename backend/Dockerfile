# Build determinístico do backend TunnelX.
#
# Substitui o buildpack (pack build), que falhava de forma intermitente no
# estágio de export com "invalid diffID for layer N". O problema é agravado
# pelo node_modules versionado no repositório: o buildpack o detectava
# ("node_modules -> Found") e trocava a instalação por 'npm rebuild', gerando
# camadas que não batem com o cache. Aqui o node_modules do repo é ignorado
# via .dockerignore e as dependências são instaladas do zero a partir do lock.

FROM node:24-alpine

ENV NODE_ENV=production

WORKDIR /app

# Manifestos primeiro: a camada de dependências só é reconstruída quando
# package.json ou package-lock.json mudam, não a cada alteração de código.
COPY package*.json ./

# npm ci exige o lock em sincronia com o package.json e é o caminho preferido
# por ser reproduzível. Se o lock estiver defasado, cai para npm install em vez
# de derrubar o deploy — vale revisar o lock quando esse fallback for acionado.
RUN npm ci --omit=dev --no-audit --no-fund \
 || npm install --omit=dev --no-audit --no-fund

COPY . .

# index.js: const PORT = process.env.PORT || 3000
EXPOSE 3000

# O script "start" do package.json roda nodemon, que é ferramenta de
# desenvolvimento (reinicia o processo a cada alteração de arquivo e mantém um
# supervisor no PID 1). Em produção o node executa direto.
CMD ["node", "index.js"]
