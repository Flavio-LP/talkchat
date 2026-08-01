import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  API_BASE_URL,
  NETWORK_ERROR_MESSAGE,
  createConversation,
  deleteConversation,
  listTurns,
  sendTurn,
} from './api'

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

describe('api', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  describe('createConversation', () => {
    it('POSTs to /conversations and returns the body', async () => {
      global.fetch.mockResolvedValue(jsonResponse({ id: 7 }, { status: 201 }))

      await expect(createConversation()).resolves.toEqual({ id: 7 })
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/conversations`,
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  describe('sendTurn', () => {
    it('POSTs the text as JSON and returns the turn', async () => {
      const turn = { id: 1, user_text: 'hi', issues: [] }
      global.fetch.mockResolvedValue(jsonResponse(turn, { status: 201 }))

      await expect(sendTurn(3, 'hi')).resolves.toEqual(turn)

      const [url, options] = global.fetch.mock.calls[0]
      expect(url).toBe(`${API_BASE_URL}/conversations/3/turns`)
      expect(options.method).toBe('POST')
      expect(JSON.parse(options.body)).toEqual({ text: 'hi' })
      expect(options.headers['Content-Type']).toBe('application/json')
    })
  })

  describe('listTurns', () => {
    it('GETs the turn list', async () => {
      global.fetch.mockResolvedValue(jsonResponse([{ id: 1 }]))

      await expect(listTurns(3)).resolves.toEqual([{ id: 1 }])
      expect(global.fetch.mock.calls[0][0]).toBe(
        `${API_BASE_URL}/conversations/3/turns`,
      )
    })
  })

  describe('deleteConversation', () => {
    it('DELETEs and resolves to null on 204', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => {
          throw new Error('no body')
        },
      })

      await expect(deleteConversation(3)).resolves.toBeNull()
      expect(global.fetch.mock.calls[0][1].method).toBe('DELETE')
    })
  })

  describe('error handling', () => {
    it('turns a rejected fetch into a friendly network message', async () => {
      global.fetch.mockRejectedValue(new TypeError('Failed to fetch'))

      await expect(createConversation()).rejects.toThrow(NETWORK_ERROR_MESSAGE)
    })

    it('prefers the { error } message the backend sent', async () => {
      global.fetch.mockResolvedValue(
        jsonResponse({ error: 'Muitas mensagens seguidas.' }, { status: 429 }),
      )

      await expect(sendTurn(1, 'hi')).rejects.toThrow(
        'Muitas mensagens seguidas.',
      )
    })

    it('falls back to a status message when the error body is not JSON', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError('Unexpected token <')
        },
      })

      await expect(sendTurn(1, 'hi')).rejects.toThrow('502')
    })

    it('falls back to a status message when the error body has no error key', async () => {
      global.fetch.mockResolvedValue(jsonResponse({}, { status: 500 }))

      await expect(sendTurn(1, 'hi')).rejects.toThrow('500')
    })
  })
})
