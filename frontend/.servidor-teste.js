const http = require('http');
const fs = require('fs');
const path = require('path');
const tipos = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.jpg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml' };
http.createServer((req, res) => {
  const rota = decodeURIComponent(req.url.split('?')[0]);
  const alvo = path.join(__dirname, rota === '/' ? 'index.html' : rota);
  fs.readFile(alvo, (e, buf) => {
    if (e) { res.writeHead(404); return res.end('nao encontrado'); }
    res.writeHead(200, { 'Content-Type': tipos[path.extname(alvo)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(4599, () => console.log('http://localhost:4599'));
