# Acesso do cliente ao aplicativo

Como o cliente sai do cadastro no painel e chega ao app com os túneis já
instalados, e o que ainda falta fechar.

## O caminho

1. O operador cadastra o cliente em `clientes.html` com **CPF** preenchido e
   deixa marcado *"Gerar senha de acesso ao salvar"*.
2. O painel mostra a senha **uma vez**, com botão de copiar.
3. O cliente abre o app, digita CPF e senha.
4. O app chama `POST /app/login`, guarda o token e, em seguida,
   `GET /app/connections`. Cada conexão pronta vira um túnel importado
   automaticamente.

## Por que o login é por CPF

É o dado que o cliente tem na mão no balcão e o mesmo que já identifica a
conexão dele em `Connections.cpf`. E-mail nem sempre existe ou é lembrado.

A coluna guarda os dois formatos — o painel envia com máscara
(`064.767.391-66`), o app envia dígitos. **Toda comparação normaliza os dois
lados**, em `utils/password.js#onlyDigits`. Sem isso o login falharia para todos
os cadastros feitos pelo painel.

Como CPF virou chave de acesso, `clientController` recusa CPF repetido (409) e
CPF com dígito verificador inválido (400). Não há constraint `UNIQUE` no banco:
a checagem é de aplicação, e uma inserção feita por fora do painel ainda pode
criar duplicata. **Criar o índice único é a próxima dívida** — antes disso, vale
rodar a conferência:

```sql
SELECT REPLACE(REPLACE(cpf,'.',''),'-','') AS d, COUNT(*)
  FROM Clients WHERE cpf IS NOT NULL
 GROUP BY REPLACE(REPLACE(cpf,'.',''),'-','') HAVING COUNT(*) > 1;
```

## A senha

Gerada no servidor (`crypto.randomInt`), formato `XXXX-XXXX`, alfabeto sem
`0/O`, `1/I/L` e `5/S` — ela é lida em voz alta ou por WhatsApp e digitada num
teclado de celular.

O banco guarda **apenas o hash bcrypt**. Não existe tela de "ver senha" e não é
esquecimento: a senha em claro trafega uma única vez, na resposta que a gerou.
Perdeu, gera outra — a anterior morre no mesmo instante.

O cliente pode trocar a dele pelo app em `POST /app/change-password`.

## Endpoints

| método | rota | quem |
|---|---|---|
| `POST` | `/app/login` | público (CPF + senha) |
| `GET` | `/app/me` | token de cliente |
| `GET` | `/app/connections` | token de cliente |
| `POST` | `/app/change-password` | token de cliente |
| `POST` | `/clients/:id/password` | token de admin |
| `DELETE` | `/clients/:id/password` | token de admin |

`/app/connections` devolve o `config` — que contém a **chave privada** do peer.
Por isso o escopo vem do token e nunca de parâmetro: não existe `?clientId=`.

Os dois tokens são assinados com a mesma chave, então a assinatura sozinha não
distingue quem é quem. O campo `kind` (`admin` / `client`) é o que separa, e
`middleware/auth.js` é quem confere. Sem ele, um token de cliente — que qualquer
pessoa obtém com CPF e senha — abriria as rotas administrativas.

## Pendências conhecidas

**1. As rotas administrativas continuam abertas.**
`GET/POST/PUT/DELETE /clients`, `/connections`, `/plans` e as demais não exigem
token. Só `/clients/:id/password` foi fechada, porque criar senha ali equivale a
criar uma identidade capaz de baixar chave privada.

Fechar o resto é uma linha por arquivo de rota (`protectAdmin`), mas o token do
painel dura 1 dia e **não há renovação**: fechar hoje derruba o operador com
sessão antiga no meio do expediente. A ordem certa é refresh token primeiro,
`protectAdmin` depois.

**2. Senha `123456` nos cadastros antigos.**
Havia um `beforeCreate` em `models/Client.js` que dava a senha `123456` a todo
cliente criado. O hook foi removido — cliente novo nasce **sem** senha e sem
acesso. Mas quem foi cadastrado antes continua com ela. Para localizar:

```sql
SELECT id, name, cpf FROM Clients WHERE password_hash IS NOT NULL;
```

Todo cliente dessa lista que não recebeu senha pelo painel precisa de
`POST /clients/:id/password` ou `DELETE /clients/:id/password`.

**3. Sem bloqueio por tentativa.** `/app/login` aceita tentativas ilimitadas.
Com senha de 8 caracteres o espaço é grande, mas rate limit por IP e por CPF é
barato e deveria existir antes de o app ir para as lojas.

**4. Sem recuperação de senha.** Cliente que esquece depende do operador gerar
outra. Aceitável enquanto a venda é presencial.
