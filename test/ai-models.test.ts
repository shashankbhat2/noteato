import { describe, expect, it } from 'vitest'
import {
  AUTO_AI_MODEL_ID,
  availableAiProviders,
  hasAiProviderKey,
  listedAiModels,
  normalizeAiModelChoice,
  resolveAiModelChoice
} from '../src/shared/aiModels'

const keys = (
  openaiApiKey = '',
  anthropicApiKey = '',
  xaiApiKey = ''
): { openaiApiKey: string; anthropicApiKey: string; xaiApiKey: string } => ({
  openaiApiKey,
  anthropicApiKey,
  xaiApiKey
})

describe('AI model selection', () => {
  it('resolves Auto from the first available provider key', () => {
    expect(resolveAiModelChoice(AUTO_AI_MODEL_ID, 'openai', keys('openai-key'))).toMatchObject({
      choice: 'auto',
      provider: 'openai',
      model: 'gpt-5.6-luna',
      label: 'Auto'
    })
    expect(resolveAiModelChoice(AUTO_AI_MODEL_ID, 'openai', keys('', 'anthropic-key'))).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5'
    })
    expect(resolveAiModelChoice(AUTO_AI_MODEL_ID, 'openai', keys('', '', 'xai-key'))).toMatchObject({
      provider: 'xai',
      model: 'grok-build-0.1'
    })
  })

  it('uses OpenAI, Anthropic, then xAI priority when multiple keys exist', () => {
    expect(
      resolveAiModelChoice(AUTO_AI_MODEL_ID, 'xai', keys('openai-key', 'anthropic-key', 'xai-key'))
        .provider
    ).toBe('openai')
    expect(availableAiProviders(keys('', 'anthropic-key', 'xai-key'))).toEqual([
      'anthropic',
      'xai'
    ])
  })

  it('treats whitespace-only keys as unavailable', () => {
    expect(hasAiProviderKey(keys('  '), 'openai')).toBe(false)
    expect(hasAiProviderKey(keys('', 'key'), 'anthropic')).toBe(true)
  })

  it('normalizes provider-specific Auto targets to Auto', () => {
    expect(normalizeAiModelChoice('gpt-5.6-luna')).toBe('auto')
    expect(normalizeAiModelChoice('claude-sonnet-5')).toBe('auto')
    expect(normalizeAiModelChoice('grok-build-0.1')).toBe('auto')
    expect(resolveAiModelChoice('grok-build-0.1', 'xai')).toMatchObject({
      provider: 'xai',
      model: 'grok-build-0.1'
    })
  })

  it('resolves explicit models to their provider', () => {
    expect(resolveAiModelChoice('claude-opus-5').provider).toBe('anthropic')
    expect(resolveAiModelChoice('grok-4.5').provider).toBe('xai')
  })

  it('does not repeat provider-specific Auto targets in model groups', () => {
    expect(listedAiModels('openai').some((model) => model.id === 'gpt-5.6-luna')).toBe(false)
    expect(listedAiModels('anthropic').some((model) => model.id === 'claude-sonnet-5')).toBe(false)
    expect(listedAiModels('xai').some((model) => model.id === 'grok-build-0.1')).toBe(false)
  })
})
