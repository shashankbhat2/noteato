import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { FontChoice, ThemeMode } from '../../shared/types'
import { FONT_STACKS } from './fonts'

interface ThemeContextValue {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  fontFamily: FontChoice
  setFontFamily: (font: FontChoice) => void
  zenMode: boolean
  setZenMode: (zen: boolean) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => {},
  fontFamily: 'system',
  setFontFamily: () => {},
  zenMode: false,
  setZenMode: () => {}
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>('light')
  const [fontFamily, setFontFamilyState] = useState<FontChoice>('system')
  const [zenMode, setZenModeState] = useState(false)

  useEffect(() => {
    window.api.settings.get().then((settings) => {
      setThemeState(settings.theme)
      setFontFamilyState(settings.fontFamily)
      setZenModeState(settings.zenMode)
      document.documentElement.dataset.theme = settings.theme
      document.documentElement.style.setProperty('--font-family', FONT_STACKS[settings.fontFamily])
    })
  }, [])

  const setTheme = (next: ThemeMode): void => {
    setThemeState(next)
    document.documentElement.dataset.theme = next
    window.api.settings.set({ theme: next })
  }

  const setFontFamily = (next: FontChoice): void => {
    setFontFamilyState(next)
    document.documentElement.style.setProperty('--font-family', FONT_STACKS[next])
    window.api.settings.set({ fontFamily: next })
  }

  const setZenMode = (next: boolean): void => {
    setZenModeState(next)
    window.api.settings.set({ zenMode: next })
  }

  return (
    <ThemeContext.Provider
      value={{ theme, setTheme, fontFamily, setFontFamily, zenMode, setZenMode }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
