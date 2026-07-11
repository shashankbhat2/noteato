import type { AccentChoice } from '../../shared/types'

// The `swatch` is the light-mode accent, used only for the settings color dots.
// The actual applied colors live in styles.css under `:root[data-accent='…']`.
export const ACCENT_OPTIONS: { id: AccentChoice; label: string; swatch: string }[] = [
  { id: 'ember', label: 'Ember', swatch: '#a1523c' },
  { id: 'ocean', label: 'Ocean', swatch: '#2f6f9f' },
  { id: 'forest', label: 'Forest', swatch: '#3d7a4e' },
  { id: 'violet', label: 'Violet', swatch: '#6b4f9e' },
  { id: 'rose', label: 'Rose', swatch: '#b3446a' },
  { id: 'amber', label: 'Amber', swatch: '#9a6a1f' }
]
