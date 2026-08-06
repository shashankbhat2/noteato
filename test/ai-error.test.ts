import { describe, expect, it } from 'vitest'
import { aiErrorMessage } from '../src/shared/aiError'

describe('AI error messages', () => {
  it('keeps the provider reason and removes Electron IPC noise', () => {
    expect(
      aiErrorMessage(
        new Error(
          "Error invoking remote method 'ai:stream': Error: 404 The model `gpt-missing` does not exist"
        )
      )
    ).toBe('404 The model `gpt-missing` does not exist')
  })

  it('uses a useful fallback for non-error rejections', () => {
    expect(aiErrorMessage(null)).toBe('The AI provider did not complete that request.')
  })
})
