import { getToken, clearToken } from './authToken'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1'

const NETWORK_ERROR_MESSAGE =
  'Não consegui falar com o servidor. Verifique se o backend está rodando.'

/**
 * Single place where every HTTP concern is handled, so the three exported
 * helpers below never have to think about status codes or JSON parsing.
 *
 * Two failure shapes are distinguished on purpose:
 *  - fetch itself rejects (backend down, DNS, CORS) -> friendly network message
 *  - backend answered with a non-2xx -> prefer its own `{ error }` message,
 *    because the API already writes those in Portuguese for the student
 *    (422 "say something first", 429 "you are going too fast", 502, 500).
 */
async function request(path, options = {}) {
  let response
  const token = getToken()

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...options,
    })
  } catch {
    throw new Error(NETWORK_ERROR_MESSAGE)
  }

  if (!response.ok) {
    let message = `Erro do servidor (${response.status}).`

    try {
      const body = await response.json()
      if (body && body.error) message = body.error
    } catch {
      // Non-JSON error body (HTML error page, empty 502 from a proxy...).
      // Keep the generic status message.
    }

    // A rejected/expired token must not linger: the next render should show
    // the login gate again instead of silently retrying with a bad token.
    if (response.status === 401) clearToken()

    const error = new Error(message)
    error.status = response.status
    throw error
  }

  if (response.status === 204) return null

  try {
    return await response.json()
  } catch {
    return null
  }
}

export function createConversation() {
  return request('/conversations', { method: 'POST' })
}

export function sendTurn(conversationId, text) {
  return request(`/conversations/${conversationId}/turns`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export function listTurns(conversationId) {
  return request(`/conversations/${conversationId}/turns`)
}

export function deleteConversation(conversationId) {
  return request(`/conversations/${conversationId}`, { method: 'DELETE' })
}

export { API_BASE_URL, NETWORK_ERROR_MESSAGE }
