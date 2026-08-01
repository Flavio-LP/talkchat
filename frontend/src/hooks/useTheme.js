import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'chalk-talk-theme'

function getInitialTheme() {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.getAttribute('data-theme') === 'dark'
    ? 'dark'
    : 'light'
}

/**
 * Light/dark theme toggle. The initial value mirrors the `data-theme`
 * attribute that index.html's inline script already set before React
 * mounted (avoids a flash of the wrong theme); this hook just keeps that
 * attribute and localStorage in sync as the user toggles.
 */
export default function useTheme() {
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, toggleTheme }
}
