import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { AiCompleteRequest, Settings } from '../shared/types'

const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8'
const DEFAULT_OPENAI_MODEL = 'gpt-5.6-terra'

export async function completeAi(settings: Settings, req: AiCompleteRequest): Promise<string> {
  const maxTokens = req.maxTokens ?? 2048
  const provider = req.provider ?? settings.aiProvider

  if (provider === 'anthropic') {
    if (!settings.anthropicApiKey) {
      throw new Error('Add an Anthropic API key in Settings to use AI features.')
    }
    const client = new Anthropic({ apiKey: settings.anthropicApiKey })
    const response = await client.messages.create({
      model: req.model || settings.aiModel || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }]
    })
    const block = response.content.find((b) => b.type === 'text')
    return block && block.type === 'text' ? block.text : ''
  }

  if (provider === 'openai') {
    if (!settings.openaiApiKey) {
      throw new Error('Add an OpenAI API key in Settings to use AI features.')
    }
    const client = new OpenAI({ apiKey: settings.openaiApiKey })
    const response = await client.responses.create({
      model: req.model || settings.aiModel || DEFAULT_OPENAI_MODEL,
      instructions: req.system,
      input: req.prompt,
      max_output_tokens: maxTokens
    })
    return response.output_text ?? ''
  }

  throw new Error('Set up an AI provider in Settings to use this feature.')
}

export async function streamAi(
  settings: Settings,
  req: AiCompleteRequest,
  onDelta: (delta: string) => void
): Promise<string> {
  const maxTokens = req.maxTokens ?? 2048
  const provider = req.provider ?? settings.aiProvider

  if (provider === 'anthropic') {
    if (!settings.anthropicApiKey) {
      throw new Error('Add an Anthropic API key in Settings to use AI features.')
    }
    const client = new Anthropic({ apiKey: settings.anthropicApiKey })
    const stream = client.messages.stream({
      model: req.model || settings.aiModel || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }]
    })
    let result = ''
    stream.on('text', (delta) => {
      result += delta
      onDelta(delta)
    })
    await stream.finalMessage()
    return result
  }

  if (provider === 'openai') {
    if (!settings.openaiApiKey) {
      throw new Error('Add an OpenAI API key in Settings to use AI features.')
    }
    const client = new OpenAI({ apiKey: settings.openaiApiKey })
    const stream = client.responses.stream({
      model: req.model || settings.aiModel || DEFAULT_OPENAI_MODEL,
      instructions: req.system,
      input: req.prompt,
      max_output_tokens: maxTokens
    })
    let result = ''
    for await (const event of stream) {
      if (event.type !== 'response.output_text.delta') continue
      result += event.delta
      onDelta(event.delta)
    }
    return result
  }

  throw new Error('Set up an AI provider in Settings to use this feature.')
}
