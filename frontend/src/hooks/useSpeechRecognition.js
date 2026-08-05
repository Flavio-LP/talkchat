import { useCallback, useEffect, useRef, useState } from 'react'

const ERROR_MESSAGES = {
  'not-allowed':
    'Permissão do microfone negada. Libere o microfone no navegador ou use o campo de texto.',
  'service-not-allowed':
    'O navegador bloqueou o reconhecimento de voz. Use o campo de texto.',
  'no-speech': 'Não ouvi nada. Tente falar de novo, um pouco mais alto.',
  network:
    'A transcrição precisa de internet e ela falhou. Use o campo de texto por enquanto.',
  aborted: null, // cancel() on purpose — not worth showing anything
}

function getRecognitionClass() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

// Android Chrome's continuous mode is broken in several documented ways: it
// re-delivers final results, duplicates them as separate list entries, and
// repeats earlier text inside later cumulative transcripts. The reliable path
// there is one-utterance sessions (continuous = false) restarted on each
// engine-triggered end, with the finalized text committed across sessions.
function isAndroid() {
  return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)
}

function joinSpeech(...parts) {
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

// Chrome's own pause detection ends a single-utterance session on the first
// silence, cutting the student off mid-thought. This hook decides when the
// student is actually done: any new speech pushes this clock back out, giving
// a real thinking pause room before the utterance is treated as finished.
const FINALIZE_DELAY_MS = 2000

/**
 * Wraps the browser Web Speech API.
 *
 * @param {(text: string) => void} onFinalResult called once per final transcript
 * @returns {{start, stop, cancel, listening, interimText, isSupported, error, clearError}}
 */
export default function useSpeechRecognition(onFinalResult) {
  const [listening, setListening] = useState(false)
  const [interimText, setInterimText] = useState('')
  const [error, setError] = useState(null)

  const recognitionRef = useRef(null)
  // Held in a ref so a changing callback identity never tears down and
  // recreates the SpeechRecognition instance mid-utterance.
  const onFinalResultRef = useRef(onFinalResult)
  // Finalized text from sessions the engine already closed (Android restarts).
  const committedRef = useRef('')
  // Mirrors the finalized portion of the current session's full result list.
  const sessionFinalRef = useRef('')
  const finalizeTimeoutRef = useRef(null)
  // True when we ended the session on purpose (finalize, stop, cancel), so the
  // Android path knows an engine-triggered onend is NOT a pause to ride out.
  const stoppingRef = useRef(false)
  // Mirrors `listening` for the recognition callbacks, which close over state.
  const listeningRef = useRef(false)

  useEffect(() => {
    onFinalResultRef.current = onFinalResult
  }, [onFinalResult])

  const isSupported = getRecognitionClass() !== null

  useEffect(() => {
    const RecognitionClass = getRecognitionClass()
    if (!RecognitionClass) return undefined

    const androidMode = isAndroid()

    const recognition = new RecognitionClass()
    recognition.lang = 'en-US'
    // Continuous keeps the mic open across a brief thinking pause instead of
    // ending the whole session on the engine's first detected silence. On
    // Android it is unusable (duplicated words); short sessions restarted in
    // onend emulate it there instead.
    recognition.continuous = !androidMode
    recognition.interimResults = true

    const clearFinalizeTimeout = () => {
      if (finalizeTimeoutRef.current) {
        clearTimeout(finalizeTimeoutRef.current)
        finalizeTimeoutRef.current = null
      }
    }

    const flushFinalTranscript = () => {
      const text = joinSpeech(committedRef.current, sessionFinalRef.current)
      committedRef.current = ''
      sessionFinalRef.current = ''
      if (text) onFinalResultRef.current?.(text)
    }

    const scheduleFinalize = () => {
      clearFinalizeTimeout()
      finalizeTimeoutRef.current = setTimeout(() => {
        finalizeTimeoutRef.current = null
        flushFinalTranscript()
        setInterimText('')
        stoppingRef.current = true
        try {
          recognition.stop()
        } catch {
          // Nothing to stop.
        }
      }, FINALIZE_DELAY_MS)
    }

    recognition.onresult = (event) => {
      let final = ''
      let interim = ''
      let previousFinal = null

      // Rebuild from the full result list every time instead of appending the
      // slice after event.resultIndex: engines re-deliver already-final
      // results with resultIndex 0, and delta accumulation would duplicate
      // them ("I live I live in Brazil in Brazil"). Rebuilding is idempotent.
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i]
        const transcript = result[0]?.transcript ?? ''

        if (result.isFinal) {
          // Identical back-to-back final entries are engine echo, not the
          // student saying the same thing twice (that arrives as one result).
          if (transcript.trim() && transcript === previousFinal) continue
          previousFinal = transcript
          final += transcript
        } else {
          interim += transcript
        }
      }

      sessionFinalRef.current = final
      // Show everything still pending — text committed from earlier Android
      // sessions, this session's finals, and live interim speech — so the
      // student sees what will actually be sent.
      setInterimText(joinSpeech(committedRef.current, final, interim))

      // Any activity — a finalized chunk or still-interim speech — means the
      // student is mid-utterance, so push the "are they done" clock back out.
      if (final.trim() || interim.trim()) {
        scheduleFinalize()
      }
    }

    recognition.onerror = (event) => {
      const code = event?.error
      const message =
        code in ERROR_MESSAGES
          ? ERROR_MESSAGES[code]
          : 'O reconhecimento de voz falhou. Use o campo de texto.'

      clearFinalizeTimeout()
      committedRef.current = ''
      sessionFinalRef.current = ''
      if (message) setError(message)
      listeningRef.current = false
      setListening(false)
      setInterimText('')
    }

    recognition.onend = () => {
      if (androidMode && !stoppingRef.current && listeningRef.current) {
        // The engine closed the session on its own pause detection — on
        // Android that happens after every utterance. Bank what it finalized
        // and reopen the mic; scheduleFinalize() still decides when the
        // student is actually done.
        committedRef.current = joinSpeech(
          committedRef.current,
          sessionFinalRef.current,
        )
        sessionFinalRef.current = ''
        try {
          recognition.start()
          return
        } catch {
          // Restart refused — fall through and finish with what we have.
        }
      }

      // Covers the engine ending the session for good (finalize, error,
      // permission change, or a long-silence timeout on desktop) — whatever
      // was captured so far still gets sent.
      clearFinalizeTimeout()
      flushFinalTranscript()
      listeningRef.current = false
      setListening(false)
      setInterimText('')
    }

    recognitionRef.current = recognition

    return () => {
      clearFinalizeTimeout()
      committedRef.current = ''
      sessionFinalRef.current = ''
      stoppingRef.current = true
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      try {
        recognition.abort?.()
      } catch {
        // Aborting an already-stopped recognition is not an error worth raising.
      }
      recognitionRef.current = null
    }
  }, [])

  const start = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition) return

    setError(null)
    setInterimText('')
    committedRef.current = ''
    sessionFinalRef.current = ''
    stoppingRef.current = false

    try {
      recognition.start()
      listeningRef.current = true
      setListening(true)
    } catch {
      // start() throws if it is already running; the UI is already correct.
      listeningRef.current = true
      setListening(true)
    }
  }, [])

  const stop = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition) return

    stoppingRef.current = true
    try {
      recognition.stop()
    } catch {
      // Nothing to stop.
    }
    listeningRef.current = false
    setListening(false)
  }, [])

  // Discards everything captured so far instead of sending it. Clearing the
  // transcripts before abort() means the onend flush finds nothing to send.
  const cancel = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition) return

    if (finalizeTimeoutRef.current) {
      clearTimeout(finalizeTimeoutRef.current)
      finalizeTimeoutRef.current = null
    }
    committedRef.current = ''
    sessionFinalRef.current = ''
    stoppingRef.current = true
    setInterimText('')
    listeningRef.current = false
    setListening(false)
    try {
      recognition.abort?.()
    } catch {
      // Nothing to abort.
    }
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return { start, stop, cancel, listening, interimText, isSupported, error, clearError }
}
