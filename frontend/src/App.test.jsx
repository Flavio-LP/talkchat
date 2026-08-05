import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createConversation, sendTurn } from './api'

vi.mock('./api', () => ({
  createConversation: vi.fn(),
  sendTurn: vi.fn(),
  listTurns: vi.fn(),
  deleteConversation: vi.fn(),
}))

class FakeSpeechRecognition {
  static instances = []

  constructor() {
    this.start = vi.fn()
    this.stop = vi.fn()
    this.abort = vi.fn()
    FakeSpeechRecognition.instances.push(this)
  }
}

const turnFixture = {
  id: 1,
  user_text: 'I have went to school yesterday',
  corrected_text: 'I went to school yesterday.',
  issues: [
    {
      original: 'have went',
      fixed: 'went',
      type: 'Tempo verbal',
      explanation: "Com 'yesterday' usamos o past simple.",
    },
  ],
  reply: 'Nice! What did you do at school yesterday?',
  reply_translation: 'Legal! O que você fez na escola ontem?',
  reply_structure: "Passado simples com 'do' -> 'did', pergunta com inversão sujeito-verbo.",
  praise: 'Boa construção!',
  created_at: '2026-07-30T21:44:59.527Z',
}

async function typeAndSend(user, text = turnFixture.user_text) {
  const input = await screen.findByLabelText(/escreva sua frase/i)
  await waitFor(() => expect(input).toBeEnabled())
  await user.type(input, text)
  await user.click(screen.getByRole('button', { name: /enviar/i }))
}

describe('App', () => {
  beforeEach(() => {
    FakeSpeechRecognition.instances = []
    window.SpeechRecognition = FakeSpeechRecognition
    // Seeds a token so these tests exercise the already-authenticated app,
    // same as a returning user. The gate itself has its own describe block.
    window.localStorage.setItem('chalk-talk-token', 'test-token')
    createConversation.mockResolvedValue({ id: 42 })
    sendTurn.mockResolvedValue(turnFixture)
  })

  afterEach(() => {
    delete window.SpeechRecognition
    window.localStorage.clear()
    vi.clearAllMocks()
  })

  it('creates a conversation on mount and enables the UI', async () => {
    render(<App />)

    await waitFor(() => expect(createConversation).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /falar/i })).toBeEnabled(),
    )
  })

  it('shows the error banner when the conversation cannot be created', async () => {
    createConversation.mockRejectedValue(new Error('Backend fora do ar'))

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Backend fora do ar',
    )
  })

  it('sends the typed sentence and renders the analysed turn', async () => {
    const user = userEvent.setup()
    render(<App />)

    await typeAndSend(user)

    await waitFor(() =>
      expect(sendTurn).toHaveBeenCalledWith(42, turnFixture.user_text),
    )

    expect(await screen.findByText(turnFixture.user_text)).toBeInTheDocument()
    expect(screen.getByText(turnFixture.corrected_text)).toBeInTheDocument()
    expect(screen.getByText('have went').tagName).toBe('S')
    expect(screen.getByText('went')).toBeInTheDocument()
    expect(screen.getByText('Tempo verbal')).toBeInTheDocument()
    expect(
      screen.getByText("Com 'yesterday' usamos o past simple."),
    ).toBeInTheDocument()
    expect(screen.getByText('Boa construção!')).toBeInTheDocument()
    expect(screen.getByText(turnFixture.reply)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(turnFixture.reply_structure))).toBeInTheDocument()

    // The Portuguese translation is a crutch the student opts into, not
    // something shown alongside the English by default.
    expect(screen.queryByText(turnFixture.reply_translation)).toBeNull()
    await user.click(screen.getByRole('button', { name: /ver tradução/i }))
    expect(screen.getByText(turnFixture.reply_translation)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /ocultar tradução/i }))
    expect(screen.queryByText(turnFixture.reply_translation)).toBeNull()
  })

  it('speaks the reply when the voice toggle is on', async () => {
    const user = userEvent.setup()
    render(<App />)

    await typeAndSend(user)

    await waitFor(() => expect(window.speechSynthesis.speak).toHaveBeenCalled())
    expect(window.speechSynthesis.cancel).toHaveBeenCalled()
    expect(window.speechSynthesis.speak.mock.calls[0][0].text).toBe(
      turnFixture.reply,
    )
    expect(window.speechSynthesis.speak.mock.calls[0][0].rate).toBe(1)
  })

  it('speaks the reply at the selected rate', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.selectOptions(screen.getByLabelText(/velocidade da voz/i), '0.75')
    await typeAndSend(user)

    await waitFor(() => expect(window.speechSynthesis.speak).toHaveBeenCalled())
    expect(window.speechSynthesis.speak.mock.calls[0][0].rate).toBe(0.75)
  })

  it('repeats the reply on demand from the turn card', async () => {
    const user = userEvent.setup()
    render(<App />)

    await typeAndSend(user)
    await screen.findByText(turnFixture.reply)
    window.speechSynthesis.speak.mockClear()

    await user.click(screen.getByRole('button', { name: /repetir/i }))

    expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(1)
    expect(window.speechSynthesis.speak.mock.calls[0][0].text).toBe(
      turnFixture.reply,
    )
  })

  it('stays silent when the voice toggle is off', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByLabelText(/voz alta/i))
    await typeAndSend(user)

    await screen.findByText(turnFixture.reply)
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled()
  })

  it('clears the text field after sending', async () => {
    const user = userEvent.setup()
    render(<App />)

    await typeAndSend(user)

    await waitFor(() =>
      expect(screen.getByLabelText(/escreva sua frase/i)).toHaveValue(''),
    )
  })

  it('keeps the turns already on screen when a request fails', async () => {
    const user = userEvent.setup()
    render(<App />)

    await typeAndSend(user)
    await screen.findByText(turnFixture.reply)

    sendTurn.mockRejectedValueOnce(new Error('A professora está indisponível.'))
    await typeAndSend(user, 'and then I go home')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A professora está indisponível.',
    )
    // The first turn survived the failure.
    expect(screen.getByText(turnFixture.reply)).toBeInTheDocument()
  })

  it('hides the microphone but keeps the text field when speech is unsupported', async () => {
    delete window.SpeechRecognition
    const user = userEvent.setup()

    render(<App />)

    expect(screen.queryByRole('button', { name: /^falar$/i })).toBeNull()
    expect(await screen.findByRole('status')).toHaveTextContent(
      /não reconhece voz/i,
    )

    await typeAndSend(user)
    expect(await screen.findByText(turnFixture.reply)).toBeInTheDocument()
  })

  it('sends the spoken transcript through the same path as typed text', async () => {
    render(<App />)
    await waitFor(() => expect(createConversation).toHaveBeenCalled())

    const recognition = FakeSpeechRecognition.instances.at(-1)
    recognition.onresult({
      resultIndex: 0,
      results: Object.assign(
        [Object.assign([{ transcript: turnFixture.user_text }], { isFinal: true })],
        { length: 1 },
      ),
    })

    // The hook waits out its pause grace period (FINALIZE_DELAY_MS) before
    // treating this as the student's final answer, so give waitFor more than
    // the default 1000ms to catch it.
    await waitFor(
      () => expect(sendTurn).toHaveBeenCalledWith(42, turnFixture.user_text),
      { timeout: 3000 },
    )
    expect(await screen.findByText(turnFixture.reply)).toBeInTheDocument()
  })

  it('renders a clean-sentence note when there are no issues', async () => {
    const user = userEvent.setup()
    sendTurn.mockResolvedValue({
      ...turnFixture,
      id: 2,
      issues: [],
      praise: '',
    })

    render(<App />)
    await typeAndSend(user, 'I went to school yesterday.')

    expect(await screen.findByText(/nenhum erro encontrado/i)).toBeInTheDocument()
    expect(screen.queryByText('Boa construção!')).toBeNull()
  })

  it('does not fire a second request while one is in flight', async () => {
    const user = userEvent.setup()
    let resolveTurn
    sendTurn.mockImplementation(
      () => new Promise((resolve) => { resolveTurn = resolve }),
    )

    render(<App />)
    await typeAndSend(user)

    expect(await screen.findByText(/analisando sua frase/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/escreva sua frase/i)).toBeDisabled()

    resolveTurn(turnFixture)
    await screen.findByText(turnFixture.reply)
    expect(sendTurn).toHaveBeenCalledTimes(1)
  })
})

describe('App authentication gate', () => {
  beforeEach(() => {
    window.localStorage.clear()
    createConversation.mockResolvedValue({ id: 42 })
  })

  afterEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
  })

  it('shows the login form instead of the app when there is no token', async () => {
    render(<App />)

    expect(await screen.findByLabelText(/senha de acesso/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/escreva sua frase/i)).toBeNull()
    expect(createConversation).not.toHaveBeenCalled()
  })

  it('shows an error and stays on the login form when the password is wrong', async () => {
    const user = userEvent.setup()
    createConversation.mockRejectedValueOnce(
      Object.assign(new Error('Não autorizado.'), { status: 401 }),
    )

    render(<App />)

    await user.type(screen.getByLabelText(/senha de acesso/i), 'wrong-password')
    await user.click(screen.getByRole('button', { name: /entrar/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Não autorizado.')
    expect(screen.getByLabelText(/senha de acesso/i)).toBeInTheDocument()
    expect(window.localStorage.getItem('chalk-talk-token')).toBeNull()
  })

  it('shows the app after a correct password', async () => {
    const user = userEvent.setup()

    render(<App />)

    await user.type(screen.getByLabelText(/senha de acesso/i), 'right-password')
    await user.click(screen.getByRole('button', { name: /entrar/i }))

    expect(await screen.findByLabelText(/escreva sua frase/i)).toBeInTheDocument()
    expect(createConversation).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem('chalk-talk-token')).toBe('right-password')
  })
})
