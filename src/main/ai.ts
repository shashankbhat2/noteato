import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { AiCompleteRequest, Settings } from '../shared/types'
import { resolveAiModelChoice } from '../shared/aiModels'

const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5'
const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini'
const DEFAULT_XAI_MODEL = 'grok-build-0.1'

interface OpenAiResponseState {
  status?: string | null
  error?: { code?: string | null; message?: string | null } | null
  incomplete_details?: { reason?: string | null } | null
}

function openAiResponseFailure(response: OpenAiResponseState): string | null {
  if (response.error?.message) {
    return response.error.code
      ? `${response.error.message} (${response.error.code})`
      : response.error.message
  }
  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason
    if (reason === 'max_output_tokens') return 'The model reached its output limit before finishing.'
    if (reason === 'content_filter') return 'The model stopped because its content filter was triggered.'
    return 'The model returned an incomplete response.'
  }
  if (response.status === 'failed') return 'The model failed before producing a response.'
  if (response.status === 'cancelled') return 'The model cancelled the response.'
  return null
}

export async function completeAi(settings: Settings, req: AiCompleteRequest): Promise<string> {
  const maxTokens = req.maxTokens ?? 2048
  const selected = resolveAiModelChoice(
    req.model ?? settings.aiModel,
    req.provider ?? settings.aiProvider,
    req.model ? undefined : settings
  )
  const provider = selected.provider

  if (provider === 'anthropic') {
    if (!settings.anthropicApiKey) {
      throw new Error('Add an Anthropic API key in Settings to use AI features.')
    }
    const client = new Anthropic({ apiKey: settings.anthropicApiKey })
    const response = await client.messages.create({
      model: selected.model || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }]
    })
    const block = response.content.find((b) => b.type === 'text')
    return block && block.type === 'text' ? block.text : ''
  }

  if (provider === 'openai' || provider === 'xai') {
    const apiKey = provider === 'openai' ? settings.openaiApiKey : settings.xaiApiKey
    if (!apiKey) {
      throw new Error(`Add an ${provider === 'openai' ? 'OpenAI' : 'xAI'} API key in Settings to use AI features.`)
    }
    const client = new OpenAI({
      apiKey,
      ...(provider === 'xai' ? { baseURL: 'https://api.x.ai/v1' } : {})
    })
    const response = await client.responses.create({
      model: selected.model || (provider === 'openai' ? DEFAULT_OPENAI_MODEL : DEFAULT_XAI_MODEL),
      instructions: req.system,
      input: req.prompt,
      max_output_tokens: maxTokens
    })
    const failure = openAiResponseFailure(response)
    if (failure) throw new Error(failure)
    return response.output_text ?? ''
  }

  throw new Error('Set up an AI provider in Settings to use this feature.')
}

// Aborting via the signal resolves with whatever streamed so far instead of
// throwing, so a user-cancelled request still yields its partial output.
export async function streamAi(
  settings: Settings,
  req: AiCompleteRequest,
  onDelta: (delta: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const maxTokens = req.maxTokens ?? 2048
  const selected = resolveAiModelChoice(
    req.model ?? settings.aiModel,
    req.provider ?? settings.aiProvider,
    req.model ? undefined : settings
  )
  const provider = selected.provider

  if (provider === 'anthropic') {
    if (!settings.anthropicApiKey) {
      throw new Error('Add an Anthropic API key in Settings to use AI features.')
    }
    const client = new Anthropic({ apiKey: settings.anthropicApiKey })
    const stream = client.messages.stream(
      {
        model: selected.model || DEFAULT_ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.prompt }]
      },
      { signal }
    )
    let result = ''
    stream.on('text', (delta) => {
      result += delta
      onDelta(delta)
    })
    try {
      await stream.finalMessage()
    } catch (err) {
      if (signal?.aborted) return result
      throw err
    }
    return result
  }

  if (provider === 'openai' || provider === 'xai') {
    const apiKey = provider === 'openai' ? settings.openaiApiKey : settings.xaiApiKey
    if (!apiKey) {
      throw new Error(`Add an ${provider === 'openai' ? 'OpenAI' : 'xAI'} API key in Settings to use AI features.`)
    }
    const client = new OpenAI({
      apiKey,
      ...(provider === 'xai' ? { baseURL: 'https://api.x.ai/v1' } : {})
    })
    const stream = client.responses.stream(
      {
        model: selected.model || (provider === 'openai' ? DEFAULT_OPENAI_MODEL : DEFAULT_XAI_MODEL),
        instructions: req.system,
        input: req.prompt,
        max_output_tokens: maxTokens
      },
      { signal }
    )
    let result = ''
    try {
      for await (const event of stream) {
        if (event.type === 'error') {
          throw new Error(event.code ? `${event.message} (${event.code})` : event.message)
        }
        if (event.type === 'response.failed' || event.type === 'response.incomplete') {
          throw new Error(openAiResponseFailure(event.response) ?? 'The model did not complete the response.')
        }
        if (event.type === 'response.output_text.delta') {
          result += event.delta
          onDelta(event.delta)
        }
      }
      const response = await stream.finalResponse()
      const failure = openAiResponseFailure(response)
      if (failure) throw new Error(failure)
    } catch (err) {
      if (signal?.aborted) return result
      throw err
    }
    return result
  }

  throw new Error('Set up an AI provider in Settings to use this feature.')
}
