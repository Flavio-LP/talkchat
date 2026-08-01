import { useCallback, useState } from 'react'
import { getToken, setToken, clearToken } from '../authToken'

/**
 * Shared-secret gate: one token for the whole app, no per-user session.
 * Mirrors useTheme.js's shape (lazy-init from storage, actions that write
 * through and update state together).
 */
export default function useAuth() {
  const [token, setTokenState] = useState(getToken)

  const login = useCallback((value) => {
    setToken(value)
    setTokenState(value)
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setTokenState(null)
  }, [])

  return { token, login, logout }
}
