import type { FontChoice } from '../../shared/types'

export const FONT_STACKS: Record<FontChoice, string> = {
  system: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif",
  serif: "ui-serif, Georgia, 'Iowan Old Style', serif",
  mono: "ui-monospace, 'SF Mono', Menlo, monospace",
  rounded: "ui-rounded, -apple-system, BlinkMacSystemFont, sans-serif"
}

export const FONT_OPTIONS: { id: FontChoice; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Mono' },
  { id: 'rounded', label: 'Rounded' }
]
