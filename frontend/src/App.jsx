import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { createConversation, sendTurn } from './api'
import useSpeechRecognition from './hooks/useSpeechRecognition'
import useTheme from './hooks/useTheme'
import useAuth from './hooks/useAuth'
import TurnCard from './components/TurnCard'
import LoginGate from './components/LoginGate'

function isAuthError(error) {
  return error.status === 401
}

/** Speaks the teacher's English reply. Silently no-ops where unsupported. */
function speak(text) {
  if (!text) return
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  if (typeof window.SpeechSynthesisUtterance !== 'function') return

  // Cancel first so a fast second turn does not talk over the previous one.
  window.speechSynthesis.cancel()

  const utterance = new window.SpeechSynthesisUtterance(text)
  utterance.lang = 'en-US'
  window.speechSynthesis.speak(utterance)
}

function App() {
  const [conversationId, setConversationId] = useState(null)
  const [turns, setTurns] = useState([])
  const [errorMessage, setErrorMessage] = useState(null)
  const [sending, setSending] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [draft, setDraft] = useState('')
  const [authError, setAuthError] = useState(null)
  const { theme, toggleTheme } = useTheme()
  const { token, login, logout } = useAuth()

  // Refs mirror the state the speech callback reads: that callback lives inside
  // the SpeechRecognition instance and would otherwise capture the values from
  // the very first render.
  const conversationIdRef = useRef(null)
  const sendingRef = useRef(false)
  const voiceEnabledRef = useRef(true)
  // StrictMode mounts effects twice in development; without this guard every
  // dev page load would create two conversations and orphan the first.
  const createdRef = useRef(false)

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled
  }, [voiceEnabled])

  useEffect(() => {
    // Nothing to create yet: the login gate renders instead of this effect's
    // result until a token exists. Runs again once login() supplies one.
    if (!token) return
    // Guarded by createdRef alone, with no cancellation flag: StrictMode's
    // synthetic mount -> cleanup -> mount would otherwise have the cleanup
    // from the first pass mark the request "cancelled" before it resolves,
    // discarding the only conversation ID this page will ever get.
    if (createdRef.current) return
    createdRef.current = true

    createConversation()
      .then((data) => {
        conversationIdRef.current = data.id
        setConversationId(data.id)
      })
      .catch((error) => {
        if (isAuthError(error)) {
          // Wrong password, or a token rejected server-side: let the user
          // retry instead of leaving this effect permanently spent.
          createdRef.current = false
          logout()
          setAuthError(error.message)
          return
        }
        setErrorMessage(error.message)
      })
  }, [token, logout])

  const handleFinalResult = useCallback(async (text) => {
    const trimmed = text.trim()
    if (!trimmed) return
    if (!conversationIdRef.current) return
    // Single flight: the free Gemini tier is ~15 requests/minute and a burst of
    // final transcripts would spend it in seconds.
    if (sendingRef.current) return

    sendingRef.current = true
    setSending(true)
    setErrorMessage(null)

    try {
      const turn = await sendTurn(conversationIdRef.current, trimmed)
      // Newest first: the student should see their latest turn without
      // scrolling down past the whole lesson history.
      setTurns((previous) => [turn, ...previous])

      if (voiceEnabledRef.current) speak(turn.reply)
    } catch (error) {
      if (isAuthError(error)) {
        // Token rotated or expired mid-session: bounce back to the gate
        // instead of showing an error the user has no way to act on.
        logout()
        setAuthError(error.message)
      } else {
        // Keep every turn already on screen: a failed request must not erase
        // the lesson so far.
        setErrorMessage(error.message)
      }
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }, [logout])

  const {
    start,
    stop,
    listening,
    interimText,
    isSupported,
    error: speechError,
  } = useSpeechRecognition(handleFinalResult)

  if (!token) {
    return <LoginGate onSubmit={login} error={authError} />
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    handleFinalResult(text)
  }

  const ready = conversationId !== null

  return (
    <main className="app">
      <header className="app__header">
        <img className="app__logo" src="/favicon.svg" alt="" aria-hidden="true" />
        <div className="app__heading">
          <h1>Chalk Talk</h1>
          <p className="app__subtitle">
            Fale em inglês. A professora corrige, explica em português e
            continua a conversa.
          </p>
        </div>

        <button
          type="button"
          className="icon-button"
          onClick={toggleTheme}
          aria-label={
            theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'
          }
          title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
        >
          {theme === 'dark' ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="icon-button"
          onClick={logout}
          aria-label="Sair"
          title="Sair"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </header>

      {errorMessage && (
        <p className="app__banner app__banner--error" role="alert">
          {errorMessage}
        </p>
      )}

      {speechError && (
        <p className="app__banner app__banner--warning" role="status">
          {speechError}
        </p>
      )}

      {!isSupported && (
        <p className="app__banner app__banner--warning" role="status">
          Este navegador não reconhece voz (funciona melhor no Chrome). Você
          ainda pode praticar escrevendo no campo abaixo.
        </p>
      )}

      <section className="app__panel">
        <div className="app__controls">
          {isSupported && (
            <button
              type="button"
              className={`mic ${listening ? 'mic--listening' : ''}`}
              onClick={listening ? stop : start}
              disabled={!ready || sending}
            >
              <svg
                className="mic__icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
              {listening ? 'Ouvindo… toque para parar' : 'Falar'}
            </button>
          )}

          <label className="app__toggle">
            <input
              type="checkbox"
              checked={voiceEnabled}
              onChange={(event) => setVoiceEnabled(event.target.checked)}
            />
            Falar respostas em voz alta
          </label>
        </div>

        {interimText && <p className="app__interim">{interimText}</p>}

        <form className="app__form" onSubmit={handleSubmit}>
          <label className="app__form-label" htmlFor="draft">
            Ou escreva sua frase
          </label>
          <div className="app__form-row">
            <input
              id="draft"
              type="text"
              value={draft}
              placeholder="I have went to school yesterday"
              onChange={(event) => setDraft(event.target.value)}
              disabled={!ready || sending}
            />
            <button type="submit" disabled={!ready || sending || !draft.trim()}>
              Enviar
            </button>
          </div>
        </form>

        {sending && (
          <p className="app__status">
            <span className="spinner" aria-hidden="true" />
            Analisando sua frase…
          </p>
        )}
      </section>

      {turns.length === 0 && !sending ? (
        <p className="app__empty">
          <span className="app__empty-icon" aria-hidden="true">
            💬
          </span>
          {ready
            ? 'Toque em "Falar" ou escreva uma frase para começar sua aula.'
            : 'Preparando sua aula…'}
        </p>
      ) : (
        <section className="app__turns">
          {turns.map((turn) => (
            <TurnCard key={turn.id} turn={turn} />
          ))}
        </section>
      )}
    </main>
  )
}

export default App
