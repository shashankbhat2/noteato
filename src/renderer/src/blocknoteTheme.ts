import { lightDefaultTheme, darkDefaultTheme } from '@blocknote/mantine'
import type { Theme } from '@blocknote/mantine'
import type { ThemeMode } from '../../shared/types'

function buildLightTheme(fontFamily: string): Theme {
  return {
    ...lightDefaultTheme,
    colors: {
      ...lightDefaultTheme.colors,
      editor: { text: '#232323', background: '#ffffff' },
      menu: { text: '#232323', background: '#ffffff' },
      hovered: { text: '#232323', background: '#ededed' },
      selected: { text: 'var(--text)', background: 'var(--accent-soft)' },
      border: '#e4e4e4',
      sideMenu: '#b0b0b0'
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
      editor: { text: '#ededed', background: '#262626' },
      menu: { text: '#ededed', background: '#2e2e2e' },
      hovered: { text: '#ededed', background: '#383838' },
      selected: { text: 'var(--text)', background: 'var(--accent-soft)' },
      border: '#3f3f3f',
      sideMenu: '#6e6e6e'
    },
    borderRadius: 4,
    fontFamily
  }
}

export function getNoteatoTheme(mode: ThemeMode, fontFamily: string): Theme {
  return mode === 'dark' ? buildDarkTheme(fontFamily) : buildLightTheme(fontFamily)
}
