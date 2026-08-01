# Prompt para o Claude Code

Copie o texto abaixo e cole no Claude Code, rodando na pasta onde você quer criar o projeto.

---

Quero criar um projeto chamado **Chalk Talk**: um app de prática de conversação em inglês. O usuário fala em inglês (voz transcrita no navegador), a aplicação analisa a fala, corrige erros de gramática/tempo verbal/vocabulário, dá feedback em português, e continua a conversa em inglês como um professor faria.

## Stack

- Backend: Ruby on Rails 7 em modo API-only (`rails new backend --api`)
- Banco: SQLite em desenvolvimento
- Frontend: React com Vite (`npm create vite@latest frontend -- --template react`)
- Comunicação: React chama o Rails via REST/JSON
- IA: o backend chama a API da Anthropic (`https://api.anthropic.com/v1/messages`, modelo `claude-sonnet-4-6`) para analisar cada frase do usuário
- Reconhecimento de voz: Web Speech API do navegador (`SpeechRecognition` / `webkitSpeechRecognition`) no frontend — não precisa de serviço externo de STT
- Voz da resposta: `speechSynthesis` do navegador (opcional, com toggle liga/desliga)

## Modelagem

- `Conversation` (id, timestamps) — representa uma sessão de prática
- `Turn` (id, conversation_id, user_text, corrected_text, issues:json, reply, praise, timestamps) — cada frase falada + a análise da IA

## Endpoints

- `POST /api/v1/conversations` — cria uma conversa nova, retorna `{ id }`
- `POST /api/v1/conversations/:conversation_id/turns` — recebe `{ text: "..." }`, chama a IA passando o histórico da conversa como contexto, salva e retorna o turno completo: `{ id, user_text, corrected_text, issues, reply, praise, created_at }`
- `GET /api/v1/conversations/:conversation_id/turns` — lista os turnos de uma conversa
- `DELETE /api/v1/conversations/:conversation_id` — apaga a conversa

## Regra de negócio central (TutorService)

Crie um service object `TutorService` que:
1. Recebe a `Conversation` e o texto novo do usuário
2. Monta o histórico de mensagens (últimos ~8 turnos) no formato que a API da Anthropic espera (`messages: [{role, content}, ...]`)
3. Chama a API da Anthropic com esse system prompt (usar exatamente esse comportamento):
   - A IA deve responder **somente** com um JSON válido, sem markdown, no formato:
     `{"corrected_text": string, "issues": [{"original": string, "fixed": string, "type": string, "explanation": string}], "reply": string, "praise": string}`
   - `corrected_text`: a frase do usuário reescrita com gramática e tempo verbal corretos
   - `issues`: cada erro específico, com "type" e "explanation" **em português**, simples e gentil
   - `reply`: resposta natural da IA **em inglês**, continuando a conversa como um professor, com uma pergunta de acompanhamento curta
   - `praise`: elogio curto em português, só quando fizer sentido, senão string vazia
4. Faz o parse do JSON de forma defensiva (se vier com ```` ```json ```` ao redor, limpar; se falhar o parse, cair num fallback razoável)
5. Levanta um erro customizado (`TutorService::TutorError`) se a chamada à API falhar, para o controller tratar com HTTP 502

A chave `ANTHROPIC_API_KEY` deve vir de variável de ambiente (usar `dotenv-rails` em dev), **nunca hardcoded** e **nunca exposta ao frontend**.

## Frontend

- Um hook `useSpeechRecognition(onFinalResult)` que encapsula a Web Speech API: expõe `start`, `stop`, `listening`, `interimText`, `isSupported`
- Um cliente `api.js` com `createConversation()`, `sendTurn(conversationId, text)`, `deleteConversation(conversationId)`
- Um componente principal que:
  - cria a conversa ao carregar
  - mostra um botão de microfone grande, com estado "ouvindo"
  - mostra o texto sendo transcrito em tempo real (interim results) enquanto o usuário fala
  - ao terminar de falar, envia o texto pro backend e mostra: o que o usuário disse, os erros encontrados (riscado → correção, com explicação em português), um elogio quando houver, e a resposta da "professora" em inglês
  - fala a resposta em voz alta com `speechSynthesis`, com toggle pra ligar/desligar isso
  - tem um campo de texto alternativo, pra quem não tem microfone disponível ou o navegador não suporta reconhecimento de voz
  - trata erro de rede/API mostrando uma mensagem amigável, sem travar a conversa

## Configuração

- `rack-cors` no backend liberando `http://localhost:5173` para `/api/*`
- `.env.example` no backend com `ANTHROPIC_API_KEY=`
- README na raiz explicando como rodar backend (`bundle install`, `rails db:create db:migrate`, `rails s -p 3000`) e frontend (`npm install`, `npm run dev`)

## Critério de pronto

- `rails s` sobe sem erro e `POST /api/v1/conversations` funciona via curl
- `npm run dev` sobe o React na porta 5173, consegue criar uma conversa, gravar uma frase, mandar pro backend e mostrar a resposta corrigida na tela
- Testado ao menos manualmente no Chrome (o reconhecimento de voz tem suporte melhor lá)

Comece criando a estrutura de pastas e os arquivos base, depois me mostra o plano antes de escrever toda a lógica do `TutorService`.
