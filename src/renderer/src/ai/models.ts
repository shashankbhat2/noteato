import type { AiProvider } from '../../../shared/types'

export interface AiModelOption {
  id: string
  label: string
  /** Inexpensive to run — the only tier surfaced in model pickers. */
  cheap?: boolean
}

export const AI_MODELS: Record<Exclude<AiProvider, 'none'>, AiModelOption[]> = {
  anthropic: [
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

export const CHEAP_AI_MODELS: Record<Exclude<AiProvider, 'none'>, AiModelOption[]> = {
  anthropic: AI_MODELS.anthropic.filter((m) => m.cheap),
  openai: AI_MODELS.openai.filter((m) => m.cheap)
}

export const AGENT_MODELS = [
  { id: 'auto', label: 'Auto', provider: null },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', provider: 'openai' },
  { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', provider: 'openai' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic' }
] as const

export type AgentModelChoice = (typeof AGENT_MODELS)[number]['id']
