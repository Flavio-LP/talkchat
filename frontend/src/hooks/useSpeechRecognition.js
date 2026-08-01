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

  useEffect(() => {
    onFinalResultRef.current = onFinalResult
  }, [onFinalResult])

  const isSupported = getRecognitionClass() !== null

  useEffect(() => {
    const RecognitionClass = getRecognitionClass()
    if (!RecognitionClass) return undefined

    const recognition = new RecognitionClass()
    recognition.lang = 'en-US'
    recognition.continuous = false
    recognition.interimResults = true

    recognition.onresult = (event) => {
      let finalText = ''
      let interim = ''

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const transcript = result[0]?.transcript ?? ''

        if (result.isFinal) {
          finalText += transcript
        } else {
          interim += transcript
        }
      }

      setInterimText(interim)

      const trimmed = finalText.trim()
      if (trimmed) {
        setInterimText('')
        onFinalResultRef.current?.(trimmed)
      }
    }

    recognition.onerror = (event) => {
      const code = event?.error
      const message =
        code in ERROR_MESSAGES
          ? ERROR_MESSAGES[code]
          : 'O reconhecimento de voz falhou. Use o campo de texto.'

      if (message) setError(message)
      setListening(false)
      setInterimText('')
    }

    recognition.onend = () => {
      setListening(false)
      setInterimText('')
    }

    recognitionRef.current = recognition

    return () => {
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
