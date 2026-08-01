const STORAGE_KEY = 'chalk-talk-token'

/**
 * Plain localStorage wrapper, kept separate from api.js and useAuth.js so
 * both can share it without either depending on the other (api.js reads it
 * to build the Authorization header, useAuth.js reads/writes it on
 * login/logout).
 */
export function getToken() {
  return window.localStorage.getItem(STORAGE_KEY)
}

export function setToken(token) {
  window.localStorage.setItem(STORAGE_KEY, token)
}

export function clearToken() {
  window.localStorage.removeItem(STORAGE_KEY)
}
