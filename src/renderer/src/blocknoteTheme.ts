import { lightDefaultTheme, darkDefaultTheme } from '@blocknote/mantine'
import type { Theme } from '@blocknote/mantine'
import type { ThemeMode } from '../../shared/types'

/**
 * BlockNote's chrome, pointed at the app's own tokens.
 *
 * Every value here is a `var(--…)` rather than a literal, so light and dark are
 * one definition — the tokens themselves flip with `data-theme`, which is also
 * what keeps the editor honest when the accent changes.
 *
 * The matching `:root { --bn-* }` block in styles.css covers the menus and
 * popovers BlockNote portals to document.body, which never see the variables
 * this sets inline on the editor element. The two have to agree, so both read
 * from the same tokens.
 *
 * Only the highlight palette is left to the library's defaults — those are the
 * user's own text colours, not app chrome.
 */
const SHARED_COLORS = {
  editor: { text: 'var(--text)', background: 'var(--bg)' },
  menu: { text: 'var(--text)', background: 'var(--bg)' },
  tooltip: { text: 'var(--text)', background: 'var(--bg)' },
  hovered: { text: 'var(--text)', background: 'var(--bg-tertiary)' },
  selected: { text: 'var(--accent)', background: 'var(--accent-soft)' },
  disabled: { text: 'var(--text-muted)', background: 'transparent' },
  border: 'var(--border)',
  sideMenu: 'var(--text-muted)'
}

function buildTheme(base: Theme, fontFamily: string): Theme {
  // `borderRadius` is deliberately omitted: anything set here is written inline
  // onto the editor element and would then outrank the `:root` values that the
  // portalled menus use, leaving the editor on one radius scale and its own
  // dropdowns on another. Leaving it unset lets the stylesheet own the scale
  // for both. Colours can't be dropped the same way — the base themes carry
  // their own, so they have to be overridden rather than left absent.
  const { borderRadius: _ignored, ...rest } = base
  return { ...rest, colors: { ...base.colors, ...SHARED_COLORS }, fontFamily }
}

export function getNoteatoTheme(mode: ThemeMode, fontFamily: string): Theme {
  return mode === 'dark'
    ? buildTheme(darkDefaultTheme, fontFamily)
    : buildTheme(lightDefaultTheme, fontFamily)
}
