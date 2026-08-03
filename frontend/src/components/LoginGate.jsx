import { useState } from 'react'

/** Password gate shown instead of the app until a valid token is stored.
 * Reuses App.css's card/form classes so it looks like part of the same app
 * (including dark mode, which those classes already support via CSS vars). */
function LoginGate({ onSubmit, error }) {
  const [password, setPassword] = useState('')

  const handleSubmit = (event) => {
    event.preventDefault()
    const trimmed = password.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  return (
    <main className="app">
      <header className="app__header">
        <img className="app__logo" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" aria-hidden="true" />
        <div className="app__heading">
          <h1>Chalk Talk</h1>
          <p className="app__subtitle">Digite a senha de acesso para continuar.</p>
        </div>
      </header>

      {error && (
        <p className="app__banner app__banner--error" role="alert">
          {error}
        </p>
      )}

      <section className="app__panel">
        <form className="app__form" onSubmit={handleSubmit}>
          <label className="app__form-label" htmlFor="access-token">
            Senha de acesso
          </label>
          <div className="app__form-row">
            <input
              id="access-token"
              type="password"
              value={password}
              placeholder="••••••••"
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
            <button type="submit" disabled={!password.trim()}>
              Entrar
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}

export default LoginGate
