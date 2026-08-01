# Chalk Talk

App de prática de conversação em inglês. Você fala (ou escreve) uma frase, a IA
corrige gramática/tempo verbal/vocabulário, explica os erros **em português** e
continua a conversa **em inglês**, como uma professora faria.

```
frontend/  React + Vite   (Web Speech API para voz, speechSynthesis para o áudio)
backend/   Rails 8 API    (PostgreSQL + Redis, integra com a API do Google Gemini)
```

- Spec original: `prompt-claude-code-chalk-talk.md`
- Plano de implementação: `chalk-talk-plan.md`
- Arquitetura (autoritativa sobre o plano): `docs/architecture/chalk-talk-architecture.md`

---

## Pré-requisitos

**PostgreSQL** rodando. Nesta máquina o cluster local escuta na **porta 5433**
(não a 5432 padrão). Crie a role uma vez — precisa de sudo:

```bash
sudo -u postgres psql -p 5433 -c "CREATE ROLE flavio WITH LOGIN CREATEDB;"
```

`CREATEDB` é o privilégio mínimo suficiente para `rails db:create`; não use
`SUPERUSER`. A role é criada sem senha, e por isso o backend conecta pelo
**socket Unix** (auth `peer`), que é o comportamento padrão quando
`DATABASE_HOST` está vazio no `.env`. Se você preferir TCP
(`DATABASE_HOST=localhost`), o `pg_hba.conf` padrão vai exigir
`scram-sha-256` — nesse caso crie a role `WITH PASSWORD` e preencha
`DATABASE_PASSWORD`.

**Redis** rodando (usado como `Rails.cache`):

```bash
docker run -d --name chalk-talk-redis -p 6379:6379 redis:7-alpine
```

**Chave do Gemini** (grátis): gere em <https://aistudio.google.com/apikey>.

---

## Backend

```bash
cd backend
bundle install
cp .env.example .env      # preencha GEMINI_API_KEY; ajuste DATABASE_*/REDIS_URL se preciso
bin/rails db:create db:migrate
bin/rails s -p 3000
```

Testes: `bin/rspec` — a suíte inteira roda offline (WebMock bloqueia qualquer
chamada real ao Gemini).
Lint: `bin/rubocop`.

### Endpoints

| Método | Rota | Resposta |
|---|---|---|
| `POST` | `/api/v1/conversations` | `201 { "id": 1 }` |
| `POST` | `/api/v1/conversations/:id/turns` | `201` com o turno analisado |
| `GET` | `/api/v1/conversations/:id/turns` | `200` lista cronológica (cacheada no Redis) |
| `DELETE` | `/api/v1/conversations/:id` | `204` |

Códigos de erro de `POST /turns`:

| Situação | Status |
|---|---|
| `text` vazio (não chama a IA) | `422` |
| conversa inexistente | `404` |
| free tier estourado (429 do Gemini) | `429` |
| qualquer outra falha da API do Gemini | `502` |
| `GEMINI_API_KEY` ausente | `500` |

Se a IA responder algo que não é JSON válido, isso **não** é erro: o turno é
salvo normalmente (`201`) com um pedido gentil de repetir a frase. A degradação
fica registrada em `log/development.log` com o prefixo `[TutorService]`.

Smoke test:

```bash
curl -i -X POST http://localhost:3000/api/v1/conversations

curl -i -X POST http://localhost:3000/api/v1/conversations/1/turns \
  -H "Content-Type: application/json" \
  -d '{"text":"I have went to school yesterday"}'
```

O segundo comando deve devolver `201` com um `issues` não vazio contendo um item
de tempo verbal.

---

## Frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Testes: `npm test` (Vitest + Testing Library — não precisa de microfone).
Lint: `npm run lint`. Build: `npm run build`.

Se o Vite subir em 5174 porque a 5173 está ocupada, acrescente a porta em
`CORS_ORIGINS` no `backend/.env` (a lista é separada por vírgula) e reinicie o
Rails.

---

## Rodando tudo com Docker Compose (alternativa)

Sobe backend, frontend, Postgres e Redis, cada um no seu próprio container —
não depende do Postgres na porta 5433 nem do container `chalk-talk-redis`
descritos acima (são stacks independentes; nada é publicado nas portas 5432 ou
6379 do host, então não há conflito mesmo que os dois setups existam ao mesmo
tempo).

Pré-requisito único: `backend/.env` precisa existir com `GEMINI_API_KEY`
preenchida (o `docker-compose.yml` lê esse arquivo via `env_file`; ele já
existe se você seguiu os passos de "Backend" acima — senão, `cp
backend/.env.example backend/.env` e preencha a chave primeiro).

```bash
docker compose up --build
```

- Backend: <http://localhost:3000> · Frontend: <http://localhost:5173>
- No primeiro `up`, o `docker-entrypoint.sh` do backend roda `db:prepare` (cria
  + migra) tanto o banco de desenvolvimento quanto o de teste automaticamente
  — não precisa rodar `db:create`/`db:migrate` manualmente.
- `DATABASE_HOST`/`REDIS_URL`/`CORS_ORIGINS` são sobrescritos pelo
  `docker-compose.yml` para apontar para os serviços `db`/`redis` da rede
  interna do Compose; `GEMINI_API_KEY`/`GEMINI_MODEL` continuam vindo do
  `backend/.env`.
- Código de `backend/` e `frontend/` é montado como volume — editar os
  arquivos localmente recarrega o Rails/Vite dentro do container (Vite com
  HMR de verdade).

Testes dentro dos containers:

```bash
docker compose exec backend bin/rspec
docker compose exec frontend npm test
```

Parar tudo: `docker compose down` (acrescente `-v` para apagar também os dados
do Postgres/Redis dos containers).

---

## Notas importantes

### O nome do modelo é configuração, não código

O catálogo do Gemini rotaciona a cada ~6 meses (`gemini-2.0-flash` foi desligado
em 01/06/2026; `gemini-2.5-flash` tem desligamento anunciado para 16/10/2026). O
default é `gemini-3.6-flash` e vive em `GEMINI_MODEL` no `.env` — trocar de
modelo é editar o `.env`, não o código. Acompanhe
<https://ai.google.dev/gemini-api/docs/deprecations>.

### Rate limit do free tier

O free tier permite cerca de 15 requisições por minuto e 1.500 por dia. Um turno
= uma requisição. Ao estourar, o backend devolve `429` com uma mensagem honesta
("muitas mensagens seguidas") em vez de fingir que a IA caiu. O frontend só
permite uma requisição em voo por vez para não queimar a cota em rajada.

### Privacidade da transcrição de voz

O reconhecimento de voz usa a Web Speech API do navegador. **No Chrome o áudio é
enviado a servidores do Google para ser transcrito** — não é processamento
local. Suporte real existe em Chrome/Edge; o Firefox não implementa e o Safari é
parcial. Onde não houver suporte, o botão de microfone some e o campo de texto
continua sendo um caminho de primeira classe, não um degradê.

### Autenticação: um segredo compartilhado, não usuários

Não há usuários nem multi-tenant (está fora do escopo) — é um app de dono
único. Toda a API em `/api/v1` exige um token fixo, `APP_ACCESS_TOKEN`,
enviado como `Authorization: Bearer <token>`. Sem ele (ou com o token errado),
toda rota devolve `401` antes de tocar no banco ou no Gemini — inclusive um
`APP_ACCESS_TOKEN` não configurado nega todo mundo, em vez de abrir a API por
engano. Isso resolve as duas consequências que a falta de auth causava:

1. Os IDs de conversa são inteiros sequenciais
   (`GET /api/v1/conversations/3/turns` mostraria a sessão de qualquer outra
   pessoa) — mas sem o token, ninguém alcança essa rota.
2. Quem tentasse adivinhar o token gastaria a sua cota do Gemini — mas a
   verificação do token acontece antes de qualquer chamada à IA, então tentar
   e errar não custa nada além de um `401`.

Gere um valor com `openssl rand -hex 24` e defina em `backend/.env`
(`APP_ACCESS_TOKEN=...`). O frontend guarda o token digitado em
`localStorage` depois do primeiro login — não há uma tela de "verificar
senha" separada: a primeira chamada à API que falhar com `401` já mostra o
formulário de novo.

Isso não é rate limiting nem proteção contra força bruta — um único segredo
compartilhado é proporcional ao risco real (alguém achar a URL por acaso),
não a um atacante dedicado. Mantenha o Rails ligado a `127.0.0.1` e por trás
de um proxy mesmo assim.

### A chave nunca chega ao navegador

`GEMINI_API_KEY` existe apenas no processo Rails, lida de variável de ambiente
via `dotenv-rails`. O `backend/.env` está no `.gitignore`. Não use
`credentials.yml.enc` para essa chave — o `master.key` acompanha o diretório de
trabalho.
