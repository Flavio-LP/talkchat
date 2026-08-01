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
  })

  afterEach(() => {
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

  it('configures the recognition for single-utterance English with interim results', () => {
    renderHook(() => useSpeechRecognition(vi.fn()))

    expect(latest().lang).toBe('en-US')
    expect(latest().continuous).toBe(false)
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

  it('calls onFinalResult and clears the interim text on a final transcript', () => {
    const onFinal = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition(onFinal))

    act(() => {
      latest().onresult(resultsEvent([['I have went', false]]))
    })
    act(() => {
      latest().onresult(resultsEvent([['I have went to school ', true]]))
    })

    expect(onFinal).toHaveBeenCalledWith('I have went to school')
    expect(result.current.interimText).toBe('')
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

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('hello')
  })
})
