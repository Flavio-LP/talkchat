import { useCallback, useEffect, useRef, useState } from 'react'

const ERROR_MESSAGES = {
  'not-allowed':
    'Permissão do microfone negada. Libere o microfone no navegador ou use o campo de texto.',
  'service-not-allowed':
    'O navegador bloqueou o reconhecimento de voz. Use o campo de texto.',
  'no-speech': 'Não ouvi nada. Tente falar de novo, um pouco mais alto.',
  network:
    'A transcrição precisa de internet e ela falhou. Use o campo de texto por enquanto.',
  aborted: null, // stop() on purpose — not worth showing anything
}

function getRecognitionClass() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

// Chrome's own pause detection ends a single-utterance session on the first
// silence, cutting the student off mid-thought. Recognition instead runs
// continuously and this hook decides when the student is actually done: any
// new speech pushes this clock back out, giving a real thinking pause room
// before the utterance is treated as finished.
const FINALIZE_DELAY_MS = 2000

/**
 * Wraps the browser Web Speech API.
 *
 * @param {(text: string) => void} onFinalResult called once per final transcript
 * @returns {{start, stop, listening, interimText, isSupported, error, clearError}}
 */
export default function useSpeechRecognition(onFinalResult) {
  const [listening, setListening] = useState(false)
  const [interimText, setInterimText] = useState('')
  const [error, setError] = useState(null)

  const recognitionRef = useRef(null)
  // Held in a ref so a changing callback identity never tears down and
  // recreates the SpeechRecognition instance mid-utterance.
  const onFinalResultRef = useRef(onFinalResult)
  // Accumulates final segments across the continuous session until
  // scheduleFinalize() (or an early engine-triggered onend) flushes them.
  const finalTranscriptRef = useRef('')
  const finalizeTimeoutRef = useRef(null)

  useEffect(() => {
    onFinalResultRef.current = onFinalResult
  }, [onFinalResult])

  const isSupported = getRecognitionClass() !== null

  useEffect(() => {
    const RecognitionClass = getRecognitionClass()
    if (!RecognitionClass) return undefined

    const recognition = new RecognitionClass()
    recognition.lang = 'en-US'
    // Continuous keeps the mic open across a brief thinking pause instead of
    // ending the whole session on the engine's first detected silence;
    // scheduleFinalize() below is what actually decides the student is done.
    recognition.continuous = true
    recognition.interimResults = true

    const clearFinalizeTimeout = () => {
      if (finalizeTimeoutRef.current) {
        clearTimeout(finalizeTimeoutRef.current)
        finalizeTimeoutRef.current = null
      }
    }

    const flushFinalTranscript = () => {
      const text = finalTranscriptRef.current.trim()
      finalTranscriptRef.current = ''
      if (text) onFinalResultRef.current?.(text)
    }

    const scheduleFinalize = () => {
      clearFinalizeTimeout()
      finalizeTimeoutRef.current = setTimeout(() => {
        finalizeTimeoutRef.current = null
        flushFinalTranscript()
        setInterimText('')
        try {
          recognition.stop()
        } catch {
          // Nothing to stop.
        }
      }, FINALIZE_DELAY_MS)
    }

    recognition.onresult = (event) => {
      let newFinal = ''
      let interim = ''

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const transcript = result[0]?.transcript ?? ''

        if (result.isFinal) {
          newFinal += transcript
        } else {
          interim += transcript
        }
      }

      setInterimText(interim)

      if (newFinal.trim()) {
        finalTranscriptRef.current = `${finalTranscriptRef.current} ${newFinal}`.trim()
      }

      // Any activity — a finalized chunk or still-interim speech — means the
      // student is mid-utterance, so push the "are they done" clock back out.
      if (newFinal.trim() || interim.trim()) {
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
      finalTranscriptRef.current = ''
      if (message) setError(message)
      setListening(false)
      setInterimText('')
    }

    recognition.onend = () => {
      // Covers the engine ending the session on its own (error, permission
      // change, or an eventual long-silence timeout) before our own grace
      // period elapsed — whatever was captured so far still gets sent.
      clearFinalizeTimeout()
      flushFinalTranscript()
      setListening(false)
      setInterimText('')
    }

    recognitionRef.current = recognition

    return () => {
      clearFinalizeTimeout()
      finalTranscriptRef.current = ''
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
    finalTranscriptRef.current = ''

    try {
      recognition.start()
      setListening(true)
    } catch {
      // start() throws if it is already running; the UI is already correct.
      setListening(true)
    }
  }, [])

  const stop = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition) return

    try {
      recognition.stop()
    } catch {
      // Nothing to stop.
    }
    setListening(false)
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return { start, stop, listening, interimText, isSupported, error, clearError }
}
