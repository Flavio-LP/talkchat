import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// jsdom implements neither speechSynthesis nor SpeechSynthesisUtterance, and
// App.speak() calls both on the happy path — without these stubs every
// successful-turn test would blow up with a TypeError instead of asserting
// anything about the UI.
class SpeechSynthesisUtteranceStub {
  constructor(text) {
    this.text = text
    this.lang = ''
  }
}

if (!('speechSynthesis' in window)) {
  Object.defineProperty(window, 'speechSynthesis', {
    writable: true,
    configurable: true,
    value: {
      speak: vi.fn(),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      getVoices: vi.fn(() => []),
    },
  })
}

if (!('SpeechSynthesisUtterance' in window)) {
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    writable: true,
    configurable: true,
    value: SpeechSynthesisUtteranceStub,
  })
}

afterEach(() => {
  cleanup()
  window.speechSynthesis.speak.mockClear?.()
  window.speechSynthesis.cancel.mockClear?.()
})
