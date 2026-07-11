import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AccentChoice, FontChoice, ThemeMode } from '../../shared/types'
import { FONT_STACKS } from './fonts'

interface ThemeContextValue {
  theme: ThemeMode
  /** The setting resolved to a concrete appearance (follows the OS for 'system'). */
  resolvedTheme: 'light' | 'dark'
  setTheme: (theme: ThemeMode) => void
  fontFamily: FontChoice
  setFontFamily: (font: FontChoice) => void
  accent: AccentChoice
  setAccent: (accent: AccentChoice) => void
  zenMode: boolean
  setZenMode: (zen: boolean) => void
  aiSelectionActions: boolean
  setAiSelectionActions: (value: boolean) => void
  aiAgentEnabled: boolean
  setAiAgentEnabled: (value: boolean) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  resolvedTheme: 'light',
  setTheme: () => {},
  fontFamily: 'system',
  setFontFamily: () => {},
  accent: 'ember',
  setAccent: () => {},
  zenMode: false,
  setZenMode: () => {},
  aiSelectionActions: true,
  setAiSelectionActions: () => {},
  aiAgentEnabled: false,
  setAiAgentEnabled: () => {}
})

// Resolve the setting to a concrete light/dark for the CSS `data-theme` attribute.
// 'system' follows the OS via the media query (Electron's nativeTheme drives it).
function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>('light')
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')
  const [fontFamily, setFontFamilyState] = useState<FontChoice>('system')
  const [accent, setAccentState] = useState<AccentChoice>('ember')
  const [zenMode, setZenModeState] = useState(false)
  const [aiSelectionActions, setAiSelectionActionsState] = useState(true)
  const [aiAgentEnabled, setAiAgentEnabledState] = useState(false)

  useEffect(() => {
    window.api.settings.get().then((settings) => {
      setThemeState(settings.theme)
      setFontFamilyState(settings.fontFamily)
      setAccentState(settings.accent)
      setZenModeState(settings.zenMode)
      setAiSelectionActionsState(settings.aiSelectionActions)
      setAiAgentEnabledState(settings.aiAgentEnabled)
      const resolved = resolveTheme(settings.theme)
      setResolvedTheme(resolved)
      document.documentElement.dataset.theme = resolved
      document.documentElement.dataset.accent = settings.accent
      document.documentElement.style.setProperty('--font-family', FONT_STACKS[settings.fontFamily])
    })
  }, [])

  // Re-resolve when the OS theme changes while following the system setting.
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const resolved = mq.matches ? 'dark' : 'light'
      setResolvedTheme(resolved)
      document.documentElement.dataset.theme = resolved
    }
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  const setTheme = (next: ThemeMode): void => {
    setThemeState(next)
    const resolved = resolveTheme(next)
    setResolvedTheme(resolved)
    document.documentElement.dataset.theme = resolved
    window.api.settings.set({ theme: next })
  }

  const setFontFamily = (next: FontChoice): void => {
    setFontFamilyState(next)
    document.documentElement.style.setProperty('--font-family', FONT_STACKS[next])
    window.api.settings.set({ fontFamily: next })
  }

  const setAccent = (next: AccentChoice): void => {
    setAccentState(next)
    document.documentElement.dataset.accent = next
    window.api.settings.set({ accent: next })
  }

  const setZenMode = (next: boolean): void => {
    setZenModeState(next)
    window.api.settings.set({ zenMode: next })
  }

  const setAiSelectionActions = (next: boolean): void => {
    setAiSelectionActionsState(next)
    window.api.settings.set({ aiSelectionActions: next })
  }

  const setAiAgentEnabled = (next: boolean): void => {
    setAiAgentEnabledState(next)
    window.api.settings.set({ aiAgentEnabled: next })
  }

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolvedTheme,
        setTheme,
        fontFamily,
        setFontFamily,
        accent,
        setAccent,
        zenMode,
        setZenMode,
        aiSelectionActions,
        setAiSelectionActions,
        aiAgentEnabled,
        setAiAgentEnabled
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
