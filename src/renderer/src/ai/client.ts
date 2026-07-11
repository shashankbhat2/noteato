import type { AiCompleteRequest, Settings } from '../../../shared/types'

export class AiNotConfiguredError extends Error {}

export function isAiConfigured(
  settings: Settings,
  provider = settings.aiProvider
): boolean {
  if (provider === 'anthropic') return Boolean(settings.anthropicApiKey)
  if (provider === 'openai') return Boolean(settings.openaiApiKey)
  return false
}

export async function aiComplete(settings: Settings, req: AiCompleteRequest): Promise<string> {
  if (!isAiConfigured(settings, req.provider)) {
    throw new AiNotConfiguredError('Set up an AI provider in Settings to use this feature.')
  }
  return window.api.ai.complete(req)
}

export async function aiStream(
  settings: Settings,
  req: AiCompleteRequest,
  onDelta: (delta: string) => void,
  registerCancel?: (cancel: () => void) => void
): Promise<string> {
  if (!isAiConfigured(settings, req.provider)) {
    throw new AiNotConfiguredError('Set up an AI provider in Settings to use this feature.')
  }
  const model =
    req.model ||
    settings.aiModel ||
    ((req.provider ?? settings.aiProvider) === 'openai' ? 'gpt-5.4-nano' : 'claude-haiku-4-5')
  return window.api.ai.stream({ ...req, model }, onDelta, registerCancel)
}
