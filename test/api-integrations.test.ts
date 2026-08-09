import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apiToolSummaries,
  executeApiIntegration,
  testApiIntegration
} from '../src/main/apiIntegrations'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('direct API integrations', () => {
  it('publishes only the reviewed tools for each provider', () => {
    expect(apiToolSummaries('slack', 'slack-1', 'Slack')).toMatchObject([
      {
        connectionId: 'slack-1',
        name: 'send_message',
        recipe: { id: 'send-message' },
        annotations: { destructiveHint: true }
      }
    ])
    expect(apiToolSummaries('gmail', 'gmail-1', 'Gmail')[0]).toMatchObject({
      name: 'create_draft',
      recipe: { id: 'draft-message' }
    })
  })

  it('validates Slack tokens without exposing them to the renderer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, team: 'Noteato' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await testApiIntegration('slack', { token: 'xoxb-secret' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://slack.com/api/auth.test',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer xoxb-secret' })
      })
    )
  })

  it('builds a Gmail draft through the provider API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'draft-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeApiIntegration(
      'gmail',
      'create_draft',
      { token: 'google-secret' },
      { to: 'person@example.com', subject: 'Follow-up', body: 'Hello' },
      new AbortController().signal
    )

    expect(result.text).toBe('Draft created in Gmail.')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
      expect.objectContaining({ method: 'POST' })
    )
    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(request.body))).toHaveProperty('message.raw')
  })
})
