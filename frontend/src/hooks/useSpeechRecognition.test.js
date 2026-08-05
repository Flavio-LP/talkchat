import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useSpeechRecognition from './useSpeechRecognition'

/** Minimal stand-in for the browser SpeechRecognition object. */
class FakeSpeechRecognition {
  static instances = []

  constructor() {
    this.lang = ''
    this.continuous = null
    this.interimResults = null
    this.start = vi.fn()
    this.stop = vi.fn()
    this.abort = vi.fn()
    FakeSpeechRecognition.instances.push(this)
  }
}

/** Shapes a SpeechRecognitionEvent-like results list. */
function resultsEvent(entries) {
  const results = entries.map(([transcript, isFinal]) => {
    const result = [{ transcript }]
    result.isFinal = isFinal
    return result
  })
  results.length = entries.length
  return { resultIndex: 0, results }
}

function latest() {
  return FakeSpeechRecognition.instances.at(-1)
}

describe('useSpeechRecognition', () => {
  beforeEach(() => {
    FakeSpeechRecognition.instances = []
    window.SpeechRecognition = FakeSpeechRecognition
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete window.SpeechRecognition
    delete window.webkitSpeechRecognition
  })

  it('reports isSupported false when neither constructor exists', () => {
    delete window.SpeechRecognition
    delete window.webkitSpeechRecognition

    const { result } = renderHook(() => useSpeechRecognition(vi.fn()))

    expect(result.current.isSupported).toBe(false)
  })

  it('falls back to the webkit-prefixed constructor', () => {
    delete window.SpeechRecognition
    window.webkitSpeechRecognition = FakeSpeechRecognition

    const { result } = renderHook(() => useSpeechRecognition(vi.fn()))

    expect(result.current.isSupported).toBe(true)
  })

  it('configures the recognition for continuous English capture with interim results', () => {
    renderHook(() => useSpeechRecognition(vi.fn()))

    expect(latest().lang).toBe('en-US')
    expect(latest().continuous).toBe(true)
    expect(latest().interimResults).toBe(true)
  })

  it('start() starts the recognition and flips listening on', () => {
    const { result } = renderHook(() => useSpeechRecognition(vi.fn()))

    act(() => result.current.start())

    expect(latest().start).toHaveBeenCalled()
    expect(result.current.listening).toBe(true)
  })

  it('stop() stops the recognition and flips listening off', () => {
    const { result } = renderHook(() => useSpeechRecognition(vi.fn()))

    act(() => result.current.start())
    act(() => result.current.stop())

    expect(latest().stop).toHaveBeenCalled()
    expect(result.current.listening).toBe(false)
  })

  it('exposes interim transcripts while the user is still speaking', () => {
    const onFinal = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition(onFinal))

    act(() => {
      latest().onresult(resultsEvent([['I have went', false]]))
    })

    expect(result.current.interimText).toBe('I have went')
    expect(onFinal).not.toHaveBeenCalled()
  })

  it('calls onFinalResult and clears the interim text after the pause grace period', () => {
    const onFinal = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition(onFinal))

    act(() => {
      latest().onresult(resultsEvent([['I have went', false]]))
    })
    act(() => {
      latest().onresult(resultsEvent([['I have went to school ', true]]))
    })

    // A final segment lands, but the student may still be mid-thought:
    // onFinalResult must wait out the grace period, not fire immediately.
    expect(onFinal).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(onFinal).toHaveBeenCalledWith('I have went to school')
    expect(result.current.interimText).toBe('')
  })

  it('gives a fresh pause before finalizing whenever more speech arrives', () => {
    const onFinal = vi.fn()
    renderHook(() => useSpeechRecognition(onFinal))

    act(() => {
      latest().onresult(resultsEvent([['I have went ', true]]))
    })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    // Still within the grace period, more speech arrives (the student was
    // just thinking, not done) — this should push the clock back out rather
    // than let the earlier segment finalize on its own. Real engines deliver
    // event.results cumulatively: earlier finals ride along with new speech.
    act(() => {
      latest().onresult(
        resultsEvent([
          ['I have went ', true],
          ['to school yesterday', false],
        ]),
      )
    })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onFinal).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onFinal).toHaveBeenCalledWith('I have went')
  })

  it('flushes any pending final transcript immediately if the engine ends the session early', () => {
    const onFinal = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition(onFinal))

    act(() => {
      latest().onresult(resultsEvent([['I have went to school', true]]))
    })
    act(() => {
      latest().onend()
    })

    expect(onFinal).toHaveBeenCalledWith('I have went to school')
    expect(result.current.listening).toBe(false)
  })

  it('does not duplicate words when the engine re-delivers earlier final results', () => {
    // Android Chrome resends the whole result list with resultIndex 0 on every
    // event, so already-final segments arrive again and again. The transcript
    // must come out clean, not "I live I live in Brazil in Brazil".
    const onFinal = vi.fn()
    renderHook(() => useSpeechRecognition(onFinal))

    act(() => {
      latest().onresult(resultsEvent([['I live', true]]))
    })
    act(() => {
      latest().onresult(
        resultsEvent([
          ['I live', true],
          [' in Brazil', false],
        ]),
      )
    })
    act(() => {
      latest().onresult(
        resultsEvent([
          ['I live', true],
          [' in Brazil', true],
        ]),
      )
    })
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(onFinal).toHaveBeenCalledWith('I live in Brazil')
  })

  it('cancel() aborts the recognition and discards everything without sending', () => {
    const onFinal = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition(onFinal))

    act(() => result.current.start())
    act(() => {
      latest().onresult(
        resultsEvent([
          ['I live in Brazil', true],
          [' and I', false],
        ]),
      )
    })

    act(() => result.current.cancel())

    expect(latest().abort).toHaveBeenCalled()
    expect(result.current.listening).toBe(false)
    expect(result.current.interimText).toBe('')

    // Neither the engine's onend after abort nor the (cleared) finalize timer
    // may leak the discarded speech out as a message.
    act(() => {
      latest().onend()
    })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(onFinal).not.toHaveBeenCalled()
  })

  it('ignores a final transcript that is only whitespace', () => {
    const onFinal = vi.fn()
    renderHook(() => useSpeechRecognition(onFinal))

    act(() => {
      latest().onresult(resultsEvent([['   ', true]]))
    })

    expect(onFinal).not.toHaveBeenCalled()
  })

  it('surfaces a denied microphone and resets listening', () => {
    const { result } = renderHook(() => useSpeechRecognition(vi.fn()))

    act(() => result.current.start())
    act(() => {
      latest().onerror({ error: 'not-allowed' })
    })

    expect(result.current.listening).toBe(false)
    expect(result.current.error).toMatch(/microfone/i)
  })

  it('stays quiet when the user aborted on purpose', () => {
    const { result } = renderHook(() => useSpeechRecognition(vi.fn()))

    act(() => result.current.start())
    act(() => {
      latest().onerror({ error: 'aborted' })
    })

    expect(result.current.error).toBeNull()
    expect(result.current.listening).toBe(false)
  })

  it('clearError() dismisses the message', () => {
    const { result } = renderHook(() => useSpeechRecognition(vi.fn()))

    act(() => {
      latest().onerror({ error: 'no-speech' })
    })
    expect(result.current.error).not.toBeNull()

    act(() => result.current.clearError())
    expect(result.current.error).toBeNull()
  })

  it('resets listening when the recognition ends on its own', () => {
    const { result } = renderHook(() => useSpeechRecognition(vi.fn()))

    act(() => result.current.start())
    act(() => {
      latest().onend()
    })

    expect(result.current.listening).toBe(false)
  })

  describe('on Android', () => {
    const originalUserAgent = window.navigator.userAgent

    beforeEach(() => {
      Object.defineProperty(window.navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 14) Chrome/126 Mobile Safari/537.36',
        configurable: true,
      })
    })

    afterEach(() => {
      Object.defineProperty(window.navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true,
      })
    })

    it('disables continuous mode, where Android duplicates words', () => {
      renderHook(() => useSpeechRecognition(vi.fn()))

      expect(latest().continuous).toBe(false)
    })

    it('restarts across engine pauses and sends the stitched utterance once', () => {
      const onFinal = vi.fn()
      const { result } = renderHook(() => useSpeechRecognition(onFinal))

      act(() => result.current.start())
      act(() => {
        latest().onresult(resultsEvent([['I live', true]]))
      })
      // Android closes the one-utterance session on its own pause detection.
      act(() => {
        latest().onend()
      })

      expect(latest().start).toHaveBeenCalledTimes(2)
      expect(result.current.listening).toBe(true)
      expect(onFinal).not.toHaveBeenCalled()

      // The next session starts a fresh result list — earlier text must come
      // from the committed buffer, not be lost or repeated.
      act(() => {
        latest().onresult(resultsEvent([[' in Brazil', true]]))
      })
      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(onFinal).toHaveBeenCalledTimes(1)
      expect(onFinal).toHaveBeenCalledWith('I live in Brazil')
      expect(latest().stop).toHaveBeenCalled()
    })

    it('drops identical back-to-back final entries (engine echo)', () => {
      const onFinal = vi.fn()
      renderHook(() => useSpeechRecognition(onFinal))

      act(() => {
        latest().onresult(
          resultsEvent([
            ['I live in Brazil', true],
            ['I live in Brazil', true],
          ]),
        )
      })
      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(onFinal).toHaveBeenCalledWith('I live in Brazil')
    })

    it('cancel() during a restart cycle discards the committed text too', () => {
      const onFinal = vi.fn()
      const { result } = renderHook(() => useSpeechRecognition(onFinal))

      act(() => result.current.start())
      act(() => {
        latest().onresult(resultsEvent([['I live', true]]))
      })
      act(() => {
        latest().onend()
      })

      act(() => result.current.cancel())
      act(() => {
        latest().onend()
      })
      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(latest().abort).toHaveBeenCalled()
      expect(result.current.listening).toBe(false)
      expect(onFinal).not.toHaveBeenCalled()
    })
  })

  it('does not rebuild the recognition when the callback identity changes', () => {
    const { rerender } = renderHook(({ cb }) => useSpeechRecognition(cb), {
      initialProps: { cb: vi.fn() },
    })

    const before = FakeSpeechRecognition.instances.length
    rerender({ cb: vi.fn() })

    expect(FakeSpeechRecognition.instances.length).toBe(before)
  })

  it('calls the latest callback after a rerender', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ cb }) => useSpeechRecognition(cb), {
      initialProps: { cb: first },
    })

    rerender({ cb: second })
    act(() => {
      latest().onresult(resultsEvent([['hello', true]]))
    })
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('hello')
  })
})
