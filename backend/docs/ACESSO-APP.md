# Acesso do cliente ao aplicativo

Como o cliente sai do cadastro no painel e chega ao app com os túneis já
instalados, e o que ainda falta fechar.

## O caminho

1. O operador cadastra o cliente em `clientes.html` com **CPF** preenchido e
   deixa marcado *"Gerar senha de acesso ao salvar"*.
2. O painel mostra a senha **uma vez**, com botão de copiar. O cliente aparece na
   lista como *"Aguardando 1º acesso"*.
3. O cliente abre o app e toca em **Primeiro acesso**: confirma o CPF e digita a
   senha provisória.
4. O app chama `POST /app/login`. Como a senha ainda é a do balcão, a resposta
   vem com `must_change_password: true` e um token que **só abre a troca de
   senha**.
5. O cliente define a senha dele. `POST /app/change-password` limpa a marca e
   devolve um **token novo, pleno**.
6. Só então o app chama `GET /app/connections`. Cada conexão pronta vira um
   túnel importado automaticamente.

Quem já fez o primeiro acesso entra direto pelo login normal — os passos 3 a 5
não se repetem. Mas uma senha **regerada** pelo painel devolve o cliente ao
passo 3, porque a senha voltou a ser de conhecimento do operador.

## Por que a troca é obrigatória

Entre o passo 2 e o passo 5 a senha existe fora do aparelho do cliente: foi dita
em voz alta, mandada por WhatsApp ou anotada num papel. E `/app/connections`
entrega o `config`, que carrega a **chave privada** do peer.

Por isso a recusa não está na tela: está em `middleware/auth.js`. O token emitido
contra senha provisória leva `pwd: 'provisional'` e recebe **403
`PASSWORD_CHANGE_REQUIRED`** em toda rota que não seja a troca de senha — um app
desatualizado, ou um cliente HTTP qualquer com a senha do balcão, esbarra no
mesmo bloqueio. Esse token também dura **30 minutos** em vez de 30 dias: ele
existe para atravessar uma tela.

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

Gerada no servidor (`crypto.randomInt`), **8 dígitos**, sem separador — ex.:
`69512210`. Numérica porque é ditada por telefone, mandada por WhatsApp e
digitada num celular: o teclado numérico abre direto e não há dúvida entre
maiúscula e minúscula, nem entre `O` e `0`.

O custo é o espaço de busca: era `30^8` (~6,5 × 10¹¹) com o alfabeto antigo, e
agora é `10^8`. Com **8 dígitos e sem limite de tentativas em `/app/login`**
(pendência 3, abaixo), a força bruta é viável. O rate limit por IP e por CPF
deixou de ser melhoria e virou requisito antes de a base crescer.

O banco guarda **apenas o hash bcrypt**. Não existe tela de "ver senha" e não é
esquecimento: a senha em claro trafega uma única vez, na resposta que a gerou.
Perdeu, gera outra — a anterior morre no mesmo instante.

Toda senha que sai de `generatePassword` nasce **provisória**
(`Clients.password_is_provisional = 1`), e só deixa de ser quando o cliente
define a dele em `POST /app/change-password`. A rota recusa repetir a senha
provisória como "nova": isso manteria viva justamente a cópia que circulou.

## Endpoints

| método | rota | quem |
|---|---|---|
| `POST` | `/app/login` | público (CPF + senha) |
| `GET` | `/app/me` | token de cliente **pleno** |
| `GET` | `/app/connections` | token de cliente **pleno** |
| `POST` | `/app/change-password` | token de cliente, inclusive o provisório |
| `POST` | `/clients/:id/password` | token de admin |
| `DELETE` | `/clients/:id/password` | token de admin |

Em `/app/change-password`, senha atual errada responde **400
`WRONG_CURRENT_PASSWORD`**, não 401. O chamador está autenticado — o que veio
errado foi um campo do corpo. Com 401 o app trataria o erro de digitação como
sessão expirada e descartaria o token, prendendo o cliente na tela. Ali o 401
ficou reservado para o que ele de fato significa: token ausente ou vencido.

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

**2. Senha `123456` nos cadastros antigos.** *(contida, não resolvida)*
Havia um `beforeCreate` em `models/Client.js` que dava a senha `123456` a todo
cliente criado. O hook foi removido — cliente novo nasce **sem** senha e sem
acesso. Mas quem foi cadastrado antes continua com ela.

A migração `scripts/add_password_provisional_column.js` marca como provisória
**toda** senha que já existia na base, então esses cadastros não alcançam mais o
`config`: quem entrar com `123456` cai na tela de nova senha e não passa dela.

O buraco que sobra: quem sabe o CPF e tenta `123456` consegue **trocar** a senha
e tomar a conta antes do dono. Enquanto a lista abaixo não for zerada, vale
revogar em vez de esperar:

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
