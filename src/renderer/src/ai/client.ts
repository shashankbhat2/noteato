import type { AiCompleteRequest, Settings } from '../../../shared/types'
import {
  AI_PROVIDER_LABELS,
  aiProviderKey,
  resolveAiModelChoice
} from '../../../shared/aiModels'

export class AiNotConfiguredError extends Error {}

export function isAiConfigured(
  settings: Settings,
  provider = resolveAiModelChoice(settings.aiModel, settings.aiProvider, settings).provider
): boolean {
  return Boolean(aiProviderKey(settings, provider).trim())
}

export async function aiComplete(settings: Settings, req: AiCompleteRequest): Promise<string> {
  const selected = resolveAiModelChoice(
    req.model ?? settings.aiModel,
    req.provider ?? settings.aiProvider,
    settings
  )
  if (!isAiConfigured(settings, selected.provider)) {
    throw new AiNotConfiguredError(
      `Add an ${AI_PROVIDER_LABELS[selected.provider]} API key in Settings to use this model.`
    )
  }
  return window.api.ai.complete({ ...req, provider: selected.provider, model: selected.model })
}

export async function aiStream(
  settings: Settings,
  req: AiCompleteRequest,
  onDelta: (delta: string) => void,
  registerCancel?: (cancel: () => void) => void
): Promise<string> {
  const selected = resolveAiModelChoice(
    req.model ?? settings.aiModel,
    req.provider ?? settings.aiProvider,
    settings
  )
  if (!isAiConfigured(settings, selected.provider)) {
    throw new AiNotConfiguredError(
      `Add an ${AI_PROVIDER_LABELS[selected.provider]} API key in Settings to use this model.`
    )
  }
  return window.api.ai.stream(
    { ...req, provider: selected.provider, model: selected.model },
    onDelta,
    registerCancel
  )
}
