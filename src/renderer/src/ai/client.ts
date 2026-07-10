import type { AiCompleteRequest, Settings } from '../../../shared/types'

export class AiNotConfiguredError extends Error {}

export function isAiConfigured(settings: Settings): boolean {
  if (settings.aiProvider === 'anthropic') return Boolean(settings.anthropicApiKey)
  if (settings.aiProvider === 'openai') return Boolean(settings.openaiApiKey)
  return false
}

export async function aiComplete(settings: Settings, req: AiCompleteRequest): Promise<string> {
  if (!isAiConfigured(settings)) {
    throw new AiNotConfiguredError('Set up an AI provider in Settings to use this feature.')
  }
  return window.api.ai.complete(req)
}
