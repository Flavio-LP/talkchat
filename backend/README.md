# Chalk Talk — backend

Rails 8 API-only. PostgreSQL para os dados, Redis para o cache do
`GET /turns`, e a API do Google Gemini para a análise do inglês.

```bash
bundle install
cp .env.example .env      # preencha GEMINI_API_KEY
bin/rails db:create db:migrate
bin/rails s -p 3000

bin/rspec                 # testes (offline: WebMock bloqueia o Gemini)
bin/rubocop               # lint
```

Instruções completas, pré-requisitos de PostgreSQL/Redis, tabela de endpoints e
notas de risco: **`../README.md`**.

Peças principais:

| Arquivo | Papel |
|---|---|
| `app/services/tutor_service.rb` | única integração externa: prompt, payload, parsing defensivo, mapeamento de erros |
| `app/controllers/api/v1/turns_controller.rb` | valida, chama o tutor, persiste, cacheia a listagem |
| `config/database.yml` | conexão por socket Unix quando `DATABASE_HOST` está vazio |
