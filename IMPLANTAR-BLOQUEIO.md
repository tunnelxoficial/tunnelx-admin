# Implantar o corte de internet

A ordem importa. O passo 1 precisa rodar **antes** do provisionador novo subir.

---

## Por que o botão não funcionava

Duas causas independentes, as duas confirmadas no código:

1. `PATCH /connections/:id/toggle-internet` apenas invertia a coluna
   `Connections.internet`. **Nenhum processo lia essa coluna.** Nem o backend, nem
   o provisionador. O ícone ficava vermelho na tela e o cliente seguia navegando.

2. `BlockClientInternet` criava regras do Windows Firewall. Elas **nunca
   bloquearam nada**: o Windows Firewall filtra tráfego que *termina* na máquina,
   e o tráfego do cliente é *roteado* (TunnelX → IP forwarding → NAT → placa
   física). A própria Microsoft documenta que ele "cannot filter traffic in the
   forwarding path". Além disso o filtro de interface recebia o GUID do adaptador
   onde a API exige o nome amigável — então nem para tráfego local casaria.

Quem sempre cortou de verdade foi `RemovePeer` (`wg set peer ... remove`), usado
só pelo menu da grade do provisionador.

Para inadimplência não havia corte nenhum: o webhook marcava `OVERDUE`, a API do
aplicativo devolvia 402 e fechava **a tela** — mas o `.conf` já estava no
aparelho e o peer no servidor.

---

## Como funciona agora

```
painel / webhook / vigia  →  Connections.internet  →  provisionador  →  wg
       (a intenção)            (a fonte da verdade)     (reconcilia)    (o fato)
```

- `Connections.internet` passou a ser o **estado desejado de acesso**.
- `internet_block_reason` guarda **por quê**: `operator` ou `overdue`.
  - corte `overdue` → o pagamento desfaz sozinho;
  - corte `operator` → só a mão do operador desfaz.
- O provisionador compara esse campo com a saída do `wg show` a cada ciclo
  (~60 s) e aplica só a diferença. É reconciliação, não fila de comandos: uma
  ordem perdida se conserta sozinha na passada seguinte.
- O corte é `RemovePeer`. A volta é `AddPeer` com **a mesma chave e o mesmo IP** —
  o `.conf` e o QR que o cliente já tem continuam valendo, e a internet volta em
  segundos sem ele tocar em nada.

---

## Passos

### 1. Banco (antes de tudo)

```bash
node scripts/add_internet_block_columns.js
```

Adiciona `internet_block_reason` e `internet_blocked_at`.

**Leia a saída.** Ela lista as conexões que estavam com `internet = 0` herdado.
Esses clientes **têm internet agora** — o botão nunca cortou ninguém. Por padrão
o script iguala o banco à realidade (`internet = 1`) para o provisionador novo
não derrubar todos de uma vez, e imprime a lista para você cortar no painel as
que realmente devem ficar sem acesso.

Se preferir honrar os cortes antigos: `node scripts/add_internet_block_columns.js --manter-cortes`

### 2. Backend

```bash
node scripts/testar_acesso.js
```

Depois publique e reinicie. No log do boot deve aparecer:

```
[vigia] cobranca vigiada a cada 300s
```

Intervalo ajustável por `VIGIA_COBRANCA_MS` no `.env`.

### 3. Frontend do admin

Publique `conexoes.html`, `js/api.js` e `css/style.css`.

### 4. Provisionador (servidor do túnel)

Leve o `tunnelx.exe` novo e reinicie. Rode antes, uma vez, a limpeza das regras
de firewall acumuladas (simula sem `-Aplicar`):

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File C:\tunnelx-project\tunnelx-manager-application\limpar-regras-firewall.ps1
```

---

## Como verificar que funcionou

1. No painel, corte uma conexão de teste. A coluna INTERNET deve virar
   **"Cortada pelo operador"**.
2. Em até ~60 s, no log do provisionador:
   `conexao <id>: internet cortada`
3. No servidor, `wg show TunnelX` não deve mais listar aquele peer.
4. O aparelho continua dizendo "conectado" (é UDP, não há sessão), mas não
   trafega nada e o "último handshake" para de atualizar.
5. Libere pelo painel. Em até ~60 s: `conexao <id>: internet devolvida`, o peer
   reaparece e o cliente volta **sem reimportar nada**.

---

## Cuidados

- **O menu "Desativar conexão" do provisionador agora grava no banco.** Precisa
  ser assim: a reconciliação compara o túnel com o banco, então um corte que não
  chegasse ao banco seria desfeito em ~60 s. Se a gravação falhar, aparece um
  aviso na tela dizendo que o corte não vai durar.

- **Liberar um corte automático é exceção, não conserto.** O cliente continua
  inadimplente e o vigia corta de novo na próxima passada. O modal avisa. Para
  liberar em definitivo, registre o pagamento no selo da coluna Pagamento.

- **Carência de 3 dias** (`DIAS_DE_CARENCIA`, em `utils/subscriptionAccess.js`),
  contada do vencimento e não de quando o webhook chegou.

---

## O que ficou de fora (precisa de decisão sua)

**O botão "Já paguei" do aplicativo aceita pagamento antigo.**
`appSubscriptionController.sync` procura *qualquer* pagamento CONFIRMED/RECEIVED
no histórico inteiro da assinatura, sem filtrar por período nem comparar com
`last_payment_id`; no Pix, aceita a autorização estar ACTIVE — que é consentimento
permanente, não pagamento do ciclo. Com o corte funcionando, isso virou um jeito
de recuperar a internet sem pagar o mês.

Não corrigi porque envolve uma decisão sua: o que conta como pagamento válido do
ciclo. Pelo menos duas saídas razoáveis — exigir pagamento com data dentro do
período vigente, ou exigir `id` diferente de `last_payment_id`. Diga qual e eu
implemento.
