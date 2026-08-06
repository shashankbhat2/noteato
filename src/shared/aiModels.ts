import type { AiProvider, Settings } from './types'

export type ActiveAiProvider = Exclude<AiProvider, 'none'>

export interface AiModelOption {
  id: string
  label: string
}

export const AUTO_AI_MODEL_ID = 'auto'

export const AI_PROVIDER_ORDER: readonly ActiveAiProvider[] = [
  'openai',
  'anthropic',
  'xai'
]

export const AI_PROVIDER_LABELS: Record<ActiveAiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  xai: 'xAI'
}

export const AUTO_AI_MODELS: Record<ActiveAiProvider, AiModelOption> = {
  openai: { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
  anthropic: { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  xai: { id: 'grok-build-0.1', label: 'Grok Build 0.1' }
}

export const AI_MODELS: Record<ActiveAiProvider, readonly AiModelOption[]> = {
  openai: [
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    AUTO_AI_MODELS.openai,
    { id: 'gpt-5.5', label: 'GPT-5.5' },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' }
  ],
  anthropic: [
    { id: 'claude-fable-5', label: 'Claude Fable 5' },
    { id: 'claude-opus-5', label: 'Claude Opus 5' },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    AUTO_AI_MODELS.anthropic,
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' }
  ],
  xai: [
    { id: 'grok-4.5', label: 'Grok 4.5' },
    { id: 'grok-4.3', label: 'Grok 4.3' },
    AUTO_AI_MODELS.xai
  ]
}

type AiKeySettings = Pick<Settings, 'openaiApiKey' | 'anthropicApiKey' | 'xaiApiKey'>

/** Auto's provider-specific target is reserved and is not repeated in the list. */
export function listedAiModels(provider: ActiveAiProvider): readonly AiModelOption[] {
  return AI_MODELS[provider].filter((model) => model.id !== AUTO_AI_MODELS[provider].id)
}

export function normalizeAiModelChoice(choice: string | null | undefined): string {
  if (
    !choice ||
    choice === AUTO_AI_MODEL_ID ||
    Object.values(AUTO_AI_MODELS).some((model) => model.id === choice)
  ) {
    return AUTO_AI_MODEL_ID
  }
  return choice
}

export function hasAiProviderKey(
  settings: AiKeySettings,
  provider: ActiveAiProvider
): boolean {
  return Boolean(aiProviderKey(settings, provider).trim())
}

export function availableAiProviders(settings: AiKeySettings): ActiveAiProvider[] {
  return AI_PROVIDER_ORDER.filter((provider) => hasAiProviderKey(settings, provider))
}

export function resolveAiModelChoice(
  choice: string | null | undefined,
  fallbackProvider: AiProvider = 'openai',
  settings?: AiKeySettings
): { choice: string; provider: ActiveAiProvider; model: string; label: string } {
  const normalized = normalizeAiModelChoice(choice)
  if (normalized === AUTO_AI_MODEL_ID) {
    const provider =
      (settings && availableAiProviders(settings)[0]) ||
      (fallbackProvider === 'none' ? 'openai' : fallbackProvider)
    const model = AUTO_AI_MODELS[provider]
    return {
      choice: AUTO_AI_MODEL_ID,
      provider,
      model: model.id,
      label: 'Auto'
    }
  }

  for (const provider of AI_PROVIDER_ORDER) {
    const found = AI_MODELS[provider].find((model) => model.id === normalized)
    if (found) return { choice: found.id, provider, model: found.id, label: found.label }
  }

  const provider = fallbackProvider === 'none' ? 'openai' : fallbackProvider
  return { choice: normalized, provider, model: normalized, label: normalized }
}

export function aiProviderKey(settings: AiKeySettings, provider: ActiveAiProvider): string {
  if (provider === 'openai') return settings.openaiApiKey
  if (provider === 'anthropic') return settings.anthropicApiKey
  return settings.xaiApiKey
}
