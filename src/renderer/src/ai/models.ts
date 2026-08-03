import type { AiProvider } from '../../../shared/types'

export interface AiModelOption {
  id: string
  label: string
  /** Inexpensive to run — the only tier surfaced in model pickers. */
  cheap?: boolean
}

export const AI_MODELS: Record<Exclude<AiProvider, 'none'>, AiModelOption[]> = {
  // Most capable first. Claude Mythos 5 is deliberately absent — it is only
  // reachable through Project Glasswing, so it would dead-end for most people.
  anthropic: [
    { id: 'claude-fable-5', label: 'Claude Fable 5' },
    { id: 'claude-opus-5', label: 'Claude Opus 5' },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', cheap: true }
  ],
  openai: [
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    { id: 'gpt-5.5', label: 'GPT-5.5' },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', cheap: true },
    { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', cheap: true }
  ]
}

/** Provider defaults for the per-note Chat composer. Kept explicit instead of
 * relying on list order, which is ranked by capability rather than preference. */
export const DEFAULT_CHAT_MODELS: Record<Exclude<AiProvider, 'none'>, string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-5.6-luna'
}

export const CHEAP_AI_MODELS: Record<Exclude<AiProvider, 'none'>, AiModelOption[]> = {
  anthropic: AI_MODELS.anthropic.filter((m) => m.cheap),
  openai: AI_MODELS.openai.filter((m) => m.cheap)
}

/**
 * The assistant's own picker. It used to offer only the cheap tier, which meant
 * the hardest questions got the weakest model — the frontier options are here
 * now, with Auto still defaulting to a cheap one so nothing gets expensive by
 * accident. Ordered strongest first within each provider.
 */
export const AGENT_MODELS = [
  { id: 'auto', label: 'Auto', provider: null },
  { id: 'claude-fable-5', label: 'Claude Fable 5', provider: 'anthropic' },
  { id: 'claude-opus-5', label: 'Claude Opus 5', provider: 'anthropic' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'anthropic' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', provider: 'openai' },
  { id: 'gpt-5.5', label: 'GPT-5.5', provider: 'openai' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', provider: 'openai' },
  { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', provider: 'openai' }
] as const

export type AgentModelChoice = (typeof AGENT_MODELS)[number]['id']
