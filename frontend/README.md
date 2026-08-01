# Chalk Talk — frontend

React + Vite. Transcreve a fala com a Web Speech API do navegador, envia o texto
ao backend Rails e lê a resposta em voz alta com `speechSynthesis`.

```bash
npm install
npm run dev      # http://localhost:5173

npm test         # Vitest + Testing Library (não precisa de microfone)
npm run lint
npm run build
```

Aponte para outro backend com `VITE_API_BASE_URL` (veja `.env.example`).
Nada com prefixo `VITE_` é secreto — vai inteiro para o bundle do navegador.

| Arquivo | Papel |
|---|---|
| `src/App.jsx` | orquestra conversa, envio, banner de erro, toggle de voz |
| `src/hooks/useSpeechRecognition.js` | encapsula `SpeechRecognition` (interim + final, erros) |
| `src/api.js` | cliente REST com tratamento central de erro de rede/HTTP |
| `src/components/TurnCard.jsx` | renderiza um turno analisado (nunca com `dangerouslySetInnerHTML`) |

Detalhes de suporte de navegador e privacidade da transcrição: **`../README.md`**.
