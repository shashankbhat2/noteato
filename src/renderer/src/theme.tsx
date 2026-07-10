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
  aiDictationPolish: boolean
  setAiDictationPolish: (value: boolean) => void
  aiSelectionActions: boolean
  setAiSelectionActions: (value: boolean) => void
  aiAskNote: boolean
  setAiAskNote: (value: boolean) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => {},
  fontFamily: 'system',
  setFontFamily: () => {},
  zenMode: false,
  setZenMode: () => {},
  aiDictationPolish: true,
  setAiDictationPolish: () => {},
  aiSelectionActions: true,
  setAiSelectionActions: () => {},
  aiAskNote: true,
  setAiAskNote: () => {}
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>('light')
  const [fontFamily, setFontFamilyState] = useState<FontChoice>('system')
  const [zenMode, setZenModeState] = useState(false)
  const [aiDictationPolish, setAiDictationPolishState] = useState(true)
  const [aiSelectionActions, setAiSelectionActionsState] = useState(true)
  const [aiAskNote, setAiAskNoteState] = useState(true)

  useEffect(() => {
    window.api.settings.get().then((settings) => {
      setThemeState(settings.theme)
      setFontFamilyState(settings.fontFamily)
      setZenModeState(settings.zenMode)
      setAiDictationPolishState(settings.aiDictationPolish)
      setAiSelectionActionsState(settings.aiSelectionActions)
      setAiAskNoteState(settings.aiAskNote)
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

  const setAiDictationPolish = (next: boolean): void => {
    setAiDictationPolishState(next)
    window.api.settings.set({ aiDictationPolish: next })
  }

  const setAiSelectionActions = (next: boolean): void => {
    setAiSelectionActionsState(next)
    window.api.settings.set({ aiSelectionActions: next })
  }

  const setAiAskNote = (next: boolean): void => {
    setAiAskNoteState(next)
    window.api.settings.set({ aiAskNote: next })
  }

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        fontFamily,
        setFontFamily,
        zenMode,
        setZenMode,
        aiDictationPolish,
        setAiDictationPolish,
        aiSelectionActions,
        setAiSelectionActions,
        aiAskNote,
        setAiAskNote
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
