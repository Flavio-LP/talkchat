# Plano: Chalk Talk — app de prática de conversação em inglês

## Contexto

O arquivo `prompt-claude-code-chalk-talk.md` (nesta mesma pasta) contém a especificação original completa do projeto **Chalk Talk**: um app onde o usuário fala em inglês (transcrito no navegador), o backend Rails envia a fala pra uma IA pra corrigir gramática/vocabulário e gerar uma resposta de "professor", e o frontend React mostra tudo isso com feedback em português.

Este é um projeto greenfield — não havia código existente. Este documento é o plano de implementação completo, já revisado e ajustado com decisões tomadas durante o planejamento (diferem do spec original em alguns pontos, listados abaixo).

Toolchain confirmado na máquina no momento do planejamento: Ruby 3.2.8, **Rails 8.0.5** (spec original pedia 7, mas só havia 8 instalado), Node 22.17.0, npm 10.9.2.

## Decisões que divergem do spec original

- **IA: Google Gemini em vez da API da Anthropic.** Motivo: usar o free tier do Gemini. Modelo: `gemini-2.0-flash`. Cliente: gem `gemini-ai` (comunidade), em vez de HTTP puro ou o SDK oficial da Anthropic.
- **Rails 8.0.5** em vez de Rails 7 (só havia Rails 8 instalado; ajustes de `database.yml`/config cobertos abaixo).
- **PostgreSQL em vez de SQLite.**
- **Redis para cacheamento** (via `Rails.cache` / `redis_cache_store`).
- **Testes unitários e de integração no backend (RSpec) e no frontend (Vitest + Testing Library)** — não estavam no spec original.

## Ambiente verificado nesta máquina (no momento do planejamento)

- PostgreSQL 16 já instalado e rodando, **na porta 5433** (não a 5432 padrão), cluster `main`. **Não existe role Postgres para o usuário `flavio` ainda** — precisa ser criada manualmente antes de `rails db:create` funcionar (comando exato na Stage 1.5). Isso exige senha de sudo que não estava disponível de forma não-interativa.
- Redis **não estava instalado** (nem `redis-server` nem `redis-cli`), mas **Docker estava disponível** — rodar Redis via container é o caminho mais simples, sem precisar de sudo/apt.

## Ordem de execução sugerida

Conforme o pedido no fim do spec original ("comece criando a estrutura de pastas e os arquivos base, depois me mostra o plano antes de escrever toda a lógica do TutorService"):
1. Criar toda a estrutura de pastas/arquivos base (stages 0–3, 5–10, 12).
2. Pausar e confirmar antes de escrever a lógica completa do `TutorService` (stage 4) — é a peça mais sensível (prompt, parsing, chamada à IA).

---

## Stage 0 — Layout de pastas

```
/home/flavio/Documents/speakproject/
├── README.md
├── backend/    (rails new backend --api)
└── frontend/   (npm create vite@latest frontend -- --template react)
```

## Stage 1 — Backend scaffold

```bash
rails new backend --api --database=postgresql
```

`--database=postgresql` já traz `gem "pg"` no Gemfile e `database.yml` com adapter `postgresql` (ajustado na Stage 1.5).

Notas específicas do Rails 8 (vs Rails 7 do spec original):
- Produção vem com `solid_cache`/`solid_queue`/`solid_cable` por padrão — como vamos usar Redis pra cache explicitamente, `solid_cache` fica sem uso; não precisa remover, só não configurar como cache store.
- `config/master.key` / `credentials.yml.enc` são gerados automaticamente — **não usar para a GEMINI_API_KEY**, que deve vir só de variável de ambiente via `dotenv-rails`.

**`backend/Gemfile`** — editar:
- Descomentar `gem "rack-cors"` (já vem comentado no template).
- Adicionar `gem "gemini-ai"` (gem de comunidade pra API do Google Gemini).
- Adicionar `gem "redis"` (client Ruby pra usar como `cache_store`).
- Adicionar `gem "dotenv-rails"` no grupo `:development, :test`.
- Grupo `:test`: adicionar `gem "rspec-rails"`, `gem "factory_bot_rails"`, `gem "webmock"` (pra garantir que nenhum teste chama a API real do Gemini).

Rodar `bundle install`.

**`backend/.env.example`**:
```
GEMINI_API_KEY=
DATABASE_HOST=localhost
DATABASE_PORT=5433
DATABASE_USERNAME=flavio
DATABASE_PASSWORD=
REDIS_URL=redis://localhost:6379/1
```
**`backend/.env`** (local, gitignored — confirmar que `.env` está no `.gitignore`, adicionar se não estiver). A chave do Gemini é gratuita, gerada no Google AI Studio.

## Stage 1.5 — PostgreSQL: pré-requisito manual + `database.yml`

**Pré-requisito manual (exige senha de sudo):**
```bash
sudo -u postgres psql -p 5433 -c "CREATE ROLE flavio WITH LOGIN SUPERUSER;"
```
(ou uma role com privilégio de criar bancos, sem precisar ser superuser). Sem isso, `rails db:create` falha com "role does not exist".

**`backend/config/database.yml`**:
```yaml
default: &default
  adapter: postgresql
  encoding: unicode
  pool: <%= ENV.fetch("RAILS_MAX_THREADS", 5) %>
  host: <%= ENV.fetch("DATABASE_HOST", "localhost") %>
  port: <%= ENV.fetch("DATABASE_PORT", 5432) %>
  username: <%= ENV.fetch("DATABASE_USERNAME", "flavio") %>
  password: <%= ENV.fetch("DATABASE_PASSWORD", "") %>

development:
  <<: *default
  database: chalk_talk_development

test:
  <<: *default
  database: chalk_talk_test

production:
  <<: *default
  database: chalk_talk_production
  username: chalk_talk
  password: <%= ENV["CHALK_TALK_DATABASE_PASSWORD"] %>
```
`DATABASE_PORT=5433` vem do `.env` porque o cluster local roda nessa porta, não a 5432 padrão.

## Stage 2 — Models e migrations

```bash
rails g model Conversation
rails g model Turn conversation:references user_text:text corrected_text:text issues:jsonb reply:text praise:string
```

Migration de `turns` ajustada explicitamente (usa `jsonb`, nativo do Postgres):
```ruby
create_table :turns do |t|
  t.references :conversation, null: false, foreign_key: true
  t.text :user_text, null: false
  t.text :corrected_text
  t.jsonb :issues, default: [], null: false
  t.text :reply
  t.string :praise, default: ""
  t.timestamps
end
```

- `Conversation` model: `has_many :turns, -> { order(created_at: :asc) }, dependent: :destroy`
- `Turn` model: `belongs_to :conversation`, `validates :user_text, presence: true`

Rodar `bin/rails db:create db:migrate`.

## Stage 3 — Rotas e controllers

`config/routes.rb`:
```ruby
namespace :api do
  namespace :v1 do
    resources :conversations, only: [:create, :destroy] do
      resources :turns, only: [:create, :index]
    end
  end
end
```

- `Api::V1::BaseController < ActionController::API` — rescue `ActiveRecord::RecordNotFound` → 404.
- `Api::V1::ConversationsController` — `create` (retorna `{ id }`, 201) e `destroy` (204).
- `Api::V1::TurnsController`:
  - `index` — lista turnos serializados, **cacheada no Redis** (ver Stage 4.5): `Rails.cache.fetch(["turns", conversation.id, conversation.turns.maximum(:updated_at)]) { conversation.turns.map { |t| turn_json(t) }.to_json }`.
  - `create` — valida `text` presente (422 se vazio, sem chamar a IA), chama `TutorService.new(conversation, text).call`, salva o `Turn`, retorna JSON completo (201). `rescue TutorService::TutorError` → 502 com mensagem amigável. A chave de cache do `index` já muda sozinha (inclui `maximum(:updated_at)`), sem precisar de `delete` manual.

Neste ponto tudo compila e responde, exceto o `TutorService` (stage 4).

## Stage 4 — `TutorService` (`backend/app/services/tutor_service.rb`)

Interface pública: `TutorService.new(conversation, user_text).call` → hash `{ corrected_text:, issues:, reply:, praise: }`. Erro customizado `TutorService::TutorError < StandardError`.

Constantes: `MODEL = "gemini-2.0-flash"`, `MAX_HISTORY_TURNS = 8`, `MAX_TOKENS = 1024`.

**System prompt** (embutido como constante): instrui a IA a responder **somente** com JSON válido, sem markdown, no formato:
```json
{"corrected_text": string, "issues": [{"original": string, "fixed": string, "type": string, "explanation": string}], "reply": string, "praise": string}
```
- `corrected_text`: frase do usuário reescrita com gramática/tempo verbal corretos.
- `issues`: cada erro específico, com `type`/`explanation` em português, simples e gentil.
- `reply`: resposta natural em inglês, como um professor, terminando com pergunta curta.
- `praise`: elogio curto em português só quando fizer sentido, senão string vazia.

**Histórico de mensagens** — ponto sutil: os turnos salvos no banco guardam um JSON completo (`corrected_text`, `issues`, `reply`, `praise`), mas reenviar esse JSON bruto como mensagem do modelo confundiria a IA. Cada turno anterior vira exatamente:
- `{ role: "user", parts: { text: turn.user_text } }` (texto original do aluno, não o corrigido — mantém visibilidade dos erros típicos)
- `{ role: "model", parts: { text: turn.reply } }` (só a resposta natural em inglês, nunca o JSON completo)

**Atenção ao papel do turno da IA**: a API do Gemini usa o role `"model"` para as respostas da IA (não `"assistant"`, como seria na Anthropic).

Pega os últimos `MAX_HISTORY_TURNS` turnos, ordena do mais antigo pro mais novo, e acrescenta o novo texto do usuário como último `user`.

**Chamada à API** (via gem `gemini-ai`):
```ruby
client = Gemini.new(
  credentials: { service: "generative-language-api", api_key: ENV.fetch("GEMINI_API_KEY") },
  options: { model: MODEL }
)

result = client.generate_content({
  system_instruction: { parts: { text: SYSTEM_PROMPT } },
  contents: build_contents, # array de {role:, parts: {text:}}
  generationConfig: { responseMimeType: "application/json", maxOutputTokens: MAX_TOKENS }
})

result.dig("candidates", 0, "content", "parts", 0, "text")
```
- `generationConfig.responseMimeType: "application/json"` pede pro Gemini já forçar saída JSON válida — reduz bastante o caso da IA responder com fences/markdown ou prosa, mas **não elimina o parse defensivo abaixo**, que continua como rede de segurança.
- Qualquer exceção da gem (erro HTTP, timeout, chave inválida, rate limit do free tier) é capturada num `rescue => e` amplo e relançada como `TutorService::TutorError` — isso é o que o controller mapeia pra HTTP 502.
- Free tier do Gemini tem rate limit (poucas requisições por minuto no `gemini-2.0-flash`) — se isso virar um problema em uso real, é um bom candidato a virar retry/backoff, mas não faz parte deste escopo inicial.

**Parse defensivo do JSON** (mantido mesmo com `responseMimeType: application/json`, como segurança):
1. Remove fences ` ```json ... ``` ` ou ` ``` ... ``` ` via regex, caso a IA ignore a instrução.
2. `JSON.parse` do resultado.
3. Se der `JSON::ParserError`, cai num fallback razoável: `corrected_text` = texto original do usuário, `issues` = `[]`, `reply` = mensagem genérica pedindo pra repetir, `praise` = `""`. **Importante**: esse fallback não é um `TutorError` — a chamada à IA funcionou, só não retornou JSON parseável, então o turno é salvo normalmente (201), não 502.
4. `normalize_issues` garante que cada item de `issues` tem as 4 chaves como string, mesmo se a IA mandar `null` ou objetos incompletos.

## Stage 4.5 — Redis como cache store

**`backend/config/environments/development.rb`** e **`production.rb`** — adicionar:
```ruby
config.cache_store = :redis_cache_store, { url: ENV.fetch("REDIS_URL", "redis://localhost:6379/1") }
```

**`backend/config/environments/test.rb`** — deixar `config.cache_store = :memory_store` (não `:redis_cache_store`) para os testes não dependerem de um Redis rodando nem vazarem estado entre exemplos.

Uso concreto do cache nesta app (evita over-engineering — só um lugar real de cacheamento): `Api::V1::TurnsController#index` (Stage 3) cacheia a lista serializada de turnos por conversa, com chave que inclui `turns.maximum(:updated_at)` — invalida automaticamente sempre que um novo turno é criado.

Redis local via Docker (não havia `redis-server` instalado nesta máquina nem sudo sem senha pra `apt install`):
```bash
docker run -d --name chalk-talk-redis -p 6379:6379 redis:7-alpine
```

## Stage 5 — CORS e config de ambiente

`backend/config/initializers/cors.rb` (descomentar e preencher):
```ruby
Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins "http://localhost:5173"
    resource "/api/*", headers: :any, methods: [:get, :post, :put, :patch, :delete, :options, :head]
  end
end
```

## Stage 5.5 — Testes de backend (RSpec)

```bash
rails g rspec:install
```

**`backend/spec/rails_helper.rb`** — adicionar `require "webmock/rspec"` e `WebMock.disable_net_connect!(allow_localhost: true)` logo no topo, garantindo que **nenhum teste chama a API real do Gemini**.

Specs a criar:
- `spec/models/conversation_spec.rb` — associação `has_many :turns`, `dependent: :destroy`.
- `spec/models/turn_spec.rb` — `belongs_to :conversation`, validação de presença de `user_text`.
- `spec/services/tutor_service_spec.rb` (o mais importante):
  - stub da chamada HTTP ao Gemini via `WebMock.stub_request(:post, %r{generativelanguage\.googleapis\.com})` retornando um corpo JSON simulado (formato `{"candidates": [{"content": {"parts": [{"text": "..."}]}}]}`).
  - caso feliz: JSON bem formado → hash `{ corrected_text:, issues:, reply:, praise: }` correto.
  - JSON com fences ` ```json ``` ` ao redor → ainda faz parse corretamente.
  - JSON malformado/prosa → cai no fallback, **sem levantar `TutorError`**.
  - resposta HTTP de erro (500, timeout simulado, 429 de rate limit) → levanta `TutorService::TutorError`.
  - monta o histórico de mensagens corretamente: turnos antigos viram `{role: "user", parts: {text: user_text}}` + `{role: "model", parts: {text: reply}}` (nunca o JSON bruto).
- `spec/requests/api/v1/conversations_spec.rb` — `POST` cria e retorna `{id}` (201); `DELETE` remove e retorna 204.
- `spec/requests/api/v1/turns_spec.rb`:
  - `POST` com `text` válido → 201 com corpo esperado.
  - `POST` com `text` em branco → 422, sem instanciar `TutorService`.
  - `POST` numa `conversation_id` inexistente → 404.
  - `TutorService::TutorError` propagada → 502.
  - `GET` index retorna os turnos na ordem certa; teste confirmando cache do Redis/`:memory_store` e invalidação ao criar novo turno.

**`backend/spec/factories/`** — `conversations.rb` e `turns.rb` via `factory_bot_rails`.

Rodar com `bin/rspec`.

## Stage 6 — Frontend scaffold

```bash
npm create vite@latest frontend -- --template react
cd frontend && npm install
```

Estrutura: `src/App.jsx`, `src/api.js`, `src/hooks/useSpeechRecognition.js`.

## Stage 7 — Hook `useSpeechRecognition` (`src/hooks/useSpeechRecognition.js`)

Expõe `{ start, stop, listening, interimText, isSupported }` (mais um `error` extra, útil pra tratar permissão de mic negada).

- Detecta `window.SpeechRecognition || window.webkitSpeechRecognition`.
- `recognition.lang = "en-US"`, `continuous = false`, `interimResults = true`.
- `onresult`: separa resultados finais de interinos; ao ter texto final, chama `onFinalResult(texto)` e limpa `interimText`.
- `onerror`: captura `not-allowed` (permissão negada), `no-speech`, `network` etc., reseta `listening`.
- Usa `useRef` pro callback `onFinalResult` pra evitar recriar a instância de `SpeechRecognition` a cada render.

## Stage 8 — Cliente `api.js` (`src/api.js`)

`createConversation()`, `sendTurn(conversationId, text)`, `deleteConversation(conversationId)` — todas via `fetch` contra `VITE_API_BASE_URL || "http://localhost:3000/api/v1"`. Uma função `request()` central trata: erro de rede (fetch throw) → mensagem amigável; resposta não-ok → tenta ler `{ error }` do corpo JSON, senão mensagem genérica com status.

## Stage 9 — Componente principal (`src/App.jsx`)

- Cria conversa no `useEffect` de mount (`createConversation`), guarda `id` em state + em `useRef` (evita closure obsoleta dentro do callback do hook de voz).
- Botão de microfone grande, texto muda conforme `listening`; desabilitado até a conversa existir.
- Mostra `interimText` em tempo real enquanto fala.
- `handleFinalResult(text)`: chama `sendTurn`, adiciona o turno na lista, fala a resposta se `voiceEnabled`. Em caso de erro, seta `errorMessage` **sem** resetar `turns`/`conversationId` — conversa continua.
- Campo de texto alternativo (`<form>`) que chama o mesmo `handleFinalResult`.
- Checkbox "falar respostas em voz alta" (`voiceEnabled`).
- Cada turno renderizado (`TurnCard`): texto do usuário, lista de `issues` (`<s>original</s> → fixed` + `type`/`explanation` em português), `praise` só se não vazio, resposta da "professora" em inglês.
- `isSupported === false` → esconde botão de mic, mostra aviso, mantém input de texto funcional.

## Stage 10 — Speech synthesis (dentro do App.jsx)

`speak(text)`: guarda `"speechSynthesis" in window`, `window.speechSynthesis.cancel()` antes de cada nova fala (evita sobreposição), `new SpeechSynthesisUtterance(text)` com `lang = "en-US"`.

## Stage 10.5 — Testes de frontend (Vitest + Testing Library)

```bash
cd frontend
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom
```

**`frontend/vite.config.js`** — adicionar bloco `test: { environment: "jsdom", globals: true, setupFiles: "./src/setupTests.js" }`.
**`frontend/src/setupTests.js`** — `import "@testing-library/jest-dom"`.
**`frontend/package.json`** — script `"test": "vitest run"`.

Testes a criar:
- `src/api.test.js` — mocka `global.fetch` (`vi.fn()`), testa os 3 métodos no caminho feliz e no caminho de erro (network error, `{error}` no corpo, sem corpo JSON).
- `src/hooks/useSpeechRecognition.test.js` — mocka `window.SpeechRecognition`/`webkitSpeechRecognition` com uma classe fake:
  - `isSupported` é `false` quando nenhuma das duas existe.
  - `start()`/`stop()` chamam os métodos certos e atualizam `listening`.
  - `onresult` interino atualiza `interimText`; final chama `onFinalResult` e limpa `interimText`.
  - `onerror` com `not-allowed` reseta `listening` e expõe o erro.
- `src/App.test.jsx` — `vi.mock("./api")`:
  - no mount, chama `createConversation` e habilita a UI.
  - envio via campo de texto dispara `sendTurn` e renderiza o `TurnCard` (texto, issues riscados, praise, reply).
  - `sendTurn` rejeitando → mostra banner de erro sem limpar turnos já exibidos.
  - `isSupported` falso → botão de mic some, texto continua funcional.

Rodar com `npm test`.

## Stage 11 — Tratamento de erros (cross-cutting)

| Caso | Onde | Comportamento |
|---|---|---|
| Texto vazio | Controller (422) + frontend (no-op) | Não chama a IA à toa |
| Falha na API Gemini (timeout/5xx/auth/rate limit) | `TutorService` → `TutorError` → 502 | Frontend mostra banner, conversa não trava |
| JSON malformado da IA | `parse_response` → fallback, sem erro | Turno salvo normalmente com resposta genérica |
| Preflight CORS | `rack-cors` | Automático, sem rota manual de OPTIONS |
| Navegador sem SpeechRecognition | `isSupported` | Mic escondido, input de texto continua |
| Permissão de mic negada | `recognition.onerror` (`not-allowed`) | Mensagem amigável, `listening` volta a `false` |
| Backend fora do ar | `api.js` catch de `fetch` | Mensagem "Network error" amigável |

## Stage 12 — README raiz

```markdown
## Pré-requisitos

- PostgreSQL rodando (nesta máquina: cluster local na porta 5433). Criar a role
  uma vez: `sudo -u postgres psql -p 5433 -c "CREATE ROLE flavio WITH LOGIN SUPERUSER;"`
- Redis rodando: `docker run -d --name chalk-talk-redis -p 6379:6379 redis:7-alpine`

## Backend

    cd backend
    bundle install
    cp .env.example .env   # preencher GEMINI_API_KEY (grátis, gerada no Google AI Studio) e ajustar DATABASE_*/REDIS_URL se preciso
    bin/rails db:create db:migrate
    bin/rails s -p 3000

Testes: `bin/rspec`

## Frontend

    cd frontend
    npm install
    npm run dev

Testes: `npm test`
```

---

## Verificação

1. `bin/rails s -p 3000` sobe sem erro (com Postgres na porta 5433 e Redis via Docker já rodando).
2. `curl -i -X POST http://localhost:3000/api/v1/conversations` → 201 com `{"id": N}`.
3. `curl -i -X POST http://localhost:3000/api/v1/conversations/1/turns -H "Content-Type: application/json" -d '{"text":"I have went to school yesterday"}'` → 201 com `corrected_text`/`issues`/`reply`/`praise` reais vindos da API do Gemini.
4. Repetir o `GET /api/v1/conversations/1/turns` duas vezes e confirmar que a segunda vem do cache Redis; criar um novo turno e confirmar que o cache reflete a lista atualizada.
5. Derrubar o backend e confirmar que o frontend mostra um aviso amigável em vez de travar.
6. `npm run dev`, abrir no Chrome em `localhost:5173`: criar conversa automaticamente, tocar no mic, falar uma frase com erro proposital, ver o texto interino, ver a correção riscada + explicação em português + resposta da professora em inglês, ouvir a fala, alternar o toggle de voz, testar o campo de texto alternativo, e testar negar permissão de mic pra ver o fallback.
7. Checar no DevTools que não há erro de CORS nas chamadas `OPTIONS`/`POST`.
8. `bin/rspec` (backend) e `npm test` (frontend) passam localmente, sem tocar a API real do Gemini (WebMock bloqueia) nem exigir microfone real (mocks de `SpeechRecognition`).

### Arquivos críticos
- `backend/app/services/tutor_service.rb`
- `backend/spec/services/tutor_service_spec.rb`
- `backend/app/controllers/api/v1/turns_controller.rb`
- `backend/db/migrate/..._create_turns.rb`
- `backend/config/database.yml`
- `backend/config/environments/{development,test,production}.rb` (cache_store)
- `backend/config/initializers/cors.rb`
- `frontend/src/hooks/useSpeechRecognition.js`
- `frontend/src/App.jsx`
- `frontend/src/api.js`
- `frontend/src/App.test.jsx`
