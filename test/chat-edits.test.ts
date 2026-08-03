import { describe, expect, it } from 'vitest'
import { parseChatOutput } from '../src/shared/chatEdits'

describe('chat edit proposals', () => {
  it('leaves normal answers untouched', () => {
    expect(parseChatOutput('The launch date is Tuesday.')).toEqual({
      message: 'The launch date is Tuesday.',
      proposedMarkdown: null,
      hasEditMarker: false
    })
  })

  it('separates a complete note revision from the visible reply', () => {
    expect(
      parseChatOutput(
        'I tightened the introduction.\n\n<noteato-edit>\n# Launch plan\n\nA clearer opening.\n</noteato-edit>'
      )
    ).toEqual({
      message: 'I tightened the introduction.',
      proposedMarkdown: '# Launch plan\n\nA clearer opening.',
      hasEditMarker: true
    })
  })

  it('does not expose a partial streamed revision as applicable', () => {
    expect(parseChatOutput('Preparing that change.\n<noteato-edit>\n# Partial')).toEqual({
      message: 'Preparing that change.',
      proposedMarkdown: null,
      hasEditMarker: true
    })
  })

  it('unwraps an unnecessary outer markdown fence', () => {
    expect(
      parseChatOutput('<noteato-edit>\n```markdown\n# Title\n\nBody\n```\n</noteato-edit>')
        .proposedMarkdown
    ).toBe('# Title\n\nBody')
  })
})
