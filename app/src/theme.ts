import { useEffect, useState } from 'react'
import { api } from './api'
import type { Settings } from './api'

export type AppTheme = 'light' | 'dark'

export function normalizeTheme(value: unknown): AppTheme {
  return value === 'dark' ? 'dark' : 'light'
}

export function applyTheme(theme: AppTheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
}

export function useAppliedTheme(): AppTheme {
  const [theme, setTheme] = useState<AppTheme>('light')

  useEffect(() => {
    let cancelled = false
    api.settings
      .get()
      .then((settings: Settings) => {
        if (cancelled) return
        const next = normalizeTheme(settings.theme)
        applyTheme(next)
        setTheme(next)
      })
      .catch(() => {
        if (cancelled) return
        applyTheme('light')
        setTheme('light')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return theme
}
