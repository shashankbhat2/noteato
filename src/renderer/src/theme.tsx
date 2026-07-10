import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { FontChoice, ThemeMode } from '../../shared/types'
import { FONT_STACKS } from './fonts'

interface ThemeContextValue {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  fontFamily: FontChoice
  setFontFamily: (font: FontChoice) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => {},
  fontFamily: 'system',
  setFontFamily: () => {}
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>('light')
  const [fontFamily, setFontFamilyState] = useState<FontChoice>('system')

  useEffect(() => {
    window.api.settings.get().then((settings) => {
      setThemeState(settings.theme)
      setFontFamilyState(settings.fontFamily)
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

  return (
    <ThemeContext.Provider value={{ theme, setTheme, fontFamily, setFontFamily }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
