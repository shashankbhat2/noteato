import { lightDefaultTheme, darkDefaultTheme } from '@blocknote/mantine'
import type { Theme } from '@blocknote/mantine'
import type { ThemeMode } from '../../shared/types'

function buildLightTheme(fontFamily: string): Theme {
  return {
    ...lightDefaultTheme,
    colors: {
      ...lightDefaultTheme.colors,
      editor: { text: '#2b2a27', background: '#faf8f5' },
      menu: { text: '#2b2a27', background: '#fdfcfa' },
      hovered: { text: '#2b2a27', background: '#ece9e2' },
      selected: { text: 'var(--text)', background: 'var(--accent-soft)' },
      border: '#e3e0d8',
      sideMenu: '#b7b3a8'
    },
    borderRadius: 4,
    fontFamily
  }
}

function buildDarkTheme(fontFamily: string): Theme {
  return {
    ...darkDefaultTheme,
    colors: {
      ...darkDefaultTheme.colors,
      editor: { text: '#e9e6df', background: '#171614' },
      menu: { text: '#e9e6df', background: '#1d1c19' },
      hovered: { text: '#e9e6df', background: '#26241f' },
      selected: { text: 'var(--text)', background: 'var(--accent-soft)' },
      border: '#322f29',
      sideMenu: '#5a564c'
    },
    borderRadius: 4,
    fontFamily
  }
}

export function getNoteatoTheme(mode: ThemeMode, fontFamily: string): Theme {
  return mode === 'dark' ? buildDarkTheme(fontFamily) : buildLightTheme(fontFamily)
}
