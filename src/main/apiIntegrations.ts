import { randomUUID } from 'node:crypto'
import { integrationRecipe, type IntegrationRecipeId } from '../shared/integrations'
import type { McpToolSummary } from '../shared/mcp'

interface ApiToolDefinition {
  name: string
  title: string
  description: string
  recipeId: IntegrationRecipeId
  inputSchema: Record<string, unknown>
}

interface ApiExecutionResult {
  text: string
  structuredContent?: unknown
}

const API_TOOLS: Readonly<Record<string, readonly ApiToolDefinition[]>> = {
  slack: [
    {
      name: 'send_message',
      title: 'Send Slack message',
      description: 'Send a reviewed message to a Slack channel.',
      recipeId: 'send-message',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['channel', 'text'],
        properties: {
          channel: {
            type: 'string',
            title: 'Channel ID',
            description: 'The Slack channel ID, for example C0123456789.'
          },
          text: { type: 'string', title: 'Message' },
          thread_ts: {
            type: 'string',
            title: 'Thread timestamp',
            description: 'Optional parent message timestamp for a threaded reply.'
          }
        }
      }
    }
  ],
  asana: [
    {
      name: 'create_task',
      title: 'Create Asana task',
      description: 'Create a task in an Asana workspace or project.',
      recipeId: 'create-task',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'workspace_gid'],
        properties: {
          name: { type: 'string', title: 'Task name' },
          notes: { type: 'string', title: 'Details' },
          workspace_gid: {
            type: 'string',
            title: 'Workspace GID',
            description: 'Required when a project is not enough to infer the workspace.'
          },
          project_gid: { type: 'string', title: 'Project GID' },
          assignee: {
            type: 'string',
            title: 'Assignee',
            description: 'An Asana user GID, email, or “me”.'
          },
          due_on: { type: 'string', title: 'Due date', description: 'YYYY-MM-DD' }
        }
      }
    }
  ],
  github: [
    {
      name: 'create_issue',
      title: 'Create GitHub issue',
      description: 'Create a reviewed issue in a GitHub repository.',
      recipeId: 'create-development-issue',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['owner', 'repo', 'title'],
        properties: {
          owner: { type: 'string', title: 'Repository owner' },
          repo: { type: 'string', title: 'Repository name' },
          title: { type: 'string', title: 'Issue title' },
          body: { type: 'string', title: 'Issue body' },
          labels: {
            type: 'array',
            title: 'Labels',
            items: { type: 'string' }
          },
          assignees: {
            type: 'array',
            title: 'Assignees',
            items: { type: 'string' }
          }
        }
      }
    }
  ],
  'google-drive': [
    {
      name: 'create_file',
      title: 'Create Google Doc',
      description: 'Create a Google Doc containing the reviewed text.',
      recipeId: 'create-document',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'content'],
        properties: {
          name: { type: 'string', title: 'Document name' },
          content: { type: 'string', title: 'Document content' },
          folder_id: { type: 'string', title: 'Drive folder ID' }
        }
      }
    }
  ],
  gmail: [
    {
      name: 'create_draft',
      title: 'Create Gmail draft',
      description: 'Create a reviewed email draft without sending it.',
      recipeId: 'draft-message',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['to', 'subject', 'body'],
        properties: {
          to: { type: 'string', title: 'To' },
          cc: { type: 'string', title: 'Cc' },
          subject: { type: 'string', title: 'Subject' },
          body: { type: 'string', title: 'Message' }
        }
      }
    }
  ],
  todoist: [
    {
      name: 'create_task',
      title: 'Create Todoist task',
      description: 'Create a task in Todoist, optionally with a due date and project.',
      recipeId: 'create-task',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['content'],
        properties: {
          content: { type: 'string', title: 'Task' },
          description: { type: 'string', title: 'Details' },
          due_string: { type: 'string', title: 'Due date', description: 'Natural language, such as tomorrow at 4pm.' },
          project_id: { type: 'string', title: 'Project ID' },
          priority: {
            type: 'integer',
            title: 'Priority',
            minimum: 1,
            maximum: 4,
            description: '1 is highest and 4 is lowest.'
          }
        }
      }
    }
  ]
}

function token(credentials: Record<string, string>): string {
  const value = credentials.token?.trim()
  if (!value) throw new Error('This API integration needs a token. Reconnect it in Settings.')
  return value
}

function stringArgument(
  args: Record<string, unknown>,
  name: string,
  required = false
): string | undefined {
  const value = args[name]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (required) throw new Error(`${name.replace(/_/g, ' ')} is required.`)
  return undefined
}

function usefulError(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload.trim()) return payload.trim().slice(0, 300)
  if (!payload || typeof payload !== 'object') return fallback
  const value = payload as Record<string, unknown>
  if (typeof value.error_description === 'string') return value.error_description.slice(0, 300)
  if (typeof value.message === 'string') return value.message.slice(0, 300)
  if (typeof value.error === 'string') return value.error.slice(0, 300)
  if (value.error && typeof value.error === 'object') {
    const nested = value.error as Record<string, unknown>
    if (typeof nested.message === 'string') return nested.message.slice(0, 300)
  }
  if (Array.isArray(value.errors)) {
    const messages = value.errors
      .map((item) =>
        item && typeof item === 'object' && typeof (item as Record<string, unknown>).message === 'string'
          ? (item as Record<string, unknown>).message
          : null
      )
      .filter(Boolean)
    if (messages.length) return messages.join(' · ').slice(0, 300)
  }
  return fallback
}

async function requestJson(
  provider: string,
  url: string,
  init: RequestInit
): Promise<Record<string, unknown>> {
  const response = await fetch(url, init)
  const raw = await response.text()
  let payload: unknown = null
  if (raw) {
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = raw
    }
  }
  if (!response.ok) {
    throw new Error(
      `${provider} returned ${response.status}: ${usefulError(payload, response.statusText)}`
    )
  }
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : { value: payload }
}

function bearer(value: string, extra?: Record<string, string>): Record<string, string> {
  return { Authorization: `Bearer ${value}`, ...extra }
}

export function apiToolSummaries(
  catalogId: string,
  connectionId: string,
  connectionName: string
): McpToolSummary[] {
  return (API_TOOLS[catalogId] ?? []).map((tool) => {
    const recipe = integrationRecipe(tool.recipeId)
    return {
      connectionId,
      connectionName,
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      },
      recipe: {
        id: recipe.id,
        title: recipe.title,
        description: recipe.description,
        icon: recipe.icon
      }
    }
  })
}

export async function testApiIntegration(
  catalogId: string,
  credentials: Record<string, string>,
  signal?: AbortSignal
): Promise<void> {
  const accessToken = token(credentials)
  if (catalogId === 'slack') {
    const result = await requestJson('Slack', 'https://slack.com/api/auth.test', {
      method: 'POST',
      headers: bearer(accessToken),
      signal
    })
    if (result.ok !== true) throw new Error(`Slack rejected the token: ${String(result.error ?? 'unknown error')}`)
    return
  }
  if (catalogId === 'asana') {
    await requestJson('Asana', 'https://app.asana.com/api/1.0/users/me', {
      headers: bearer(accessToken),
      signal
    })
    return
  }
  if (catalogId === 'github') {
    await requestJson('GitHub', 'https://api.github.com/user', {
      headers: bearer(accessToken, {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }),
      signal
    })
    return
  }
  if (catalogId === 'google-drive') {
    await requestJson('Google Drive', 'https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: bearer(accessToken),
      signal
    })
    return
  }
  if (catalogId === 'gmail') {
    await requestJson('Gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: bearer(accessToken),
      signal
    })
    return
  }
  if (catalogId === 'todoist') {
    await requestJson('Todoist', 'https://api.todoist.com/api/v1/projects?limit=1', {
      headers: bearer(accessToken),
      signal
    })
    return
  }
  throw new Error('This API integration is not supported.')
}

export async function executeApiIntegration(
  catalogId: string,
  toolName: string,
  credentials: Record<string, string>,
  args: Record<string, unknown>,
  signal: AbortSignal
): Promise<ApiExecutionResult> {
  const accessToken = token(credentials)
  if (catalogId === 'slack' && toolName === 'send_message') {
    const result = await requestJson('Slack', 'https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: bearer(accessToken, { 'Content-Type': 'application/json; charset=utf-8' }),
      body: JSON.stringify({
        channel: stringArgument(args, 'channel', true),
        text: stringArgument(args, 'text', true),
        thread_ts: stringArgument(args, 'thread_ts')
      }),
      signal
    })
    if (result.ok !== true) throw new Error(`Slack could not send the message: ${String(result.error ?? 'unknown error')}`)
    return {
      text: 'Message sent in Slack.',
      structuredContent: result
    }
  }

  if (catalogId === 'asana' && toolName === 'create_task') {
    const project = stringArgument(args, 'project_gid')
    const data: Record<string, unknown> = {
      name: stringArgument(args, 'name', true),
      notes: stringArgument(args, 'notes'),
      workspace: stringArgument(args, 'workspace_gid', true),
      assignee: stringArgument(args, 'assignee'),
      due_on: stringArgument(args, 'due_on')
    }
    if (project) data.projects = [project]
    const result = await requestJson('Asana', 'https://app.asana.com/api/1.0/tasks', {
      method: 'POST',
      headers: bearer(accessToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ data }),
      signal
    })
    const created = result.data as Record<string, unknown> | undefined
    return {
      text: created?.permalink_url
        ? `Task created in Asana.\n\n${created.permalink_url}`
        : 'Task created in Asana.',
      structuredContent: result
    }
  }

  if (catalogId === 'github' && toolName === 'create_issue') {
    const owner = encodeURIComponent(stringArgument(args, 'owner', true)!)
    const repo = encodeURIComponent(stringArgument(args, 'repo', true)!)
    const result = await requestJson('GitHub', `https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers: bearer(accessToken, {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      }),
      body: JSON.stringify({
        title: stringArgument(args, 'title', true),
        body: stringArgument(args, 'body'),
        labels: Array.isArray(args.labels) ? args.labels : undefined,
        assignees: Array.isArray(args.assignees) ? args.assignees : undefined
      }),
      signal
    })
    return {
      text: result.html_url ? `Issue created on GitHub.\n\n${result.html_url}` : 'Issue created on GitHub.',
      structuredContent: result
    }
  }

  if (catalogId === 'google-drive' && toolName === 'create_file') {
    const boundary = `noteato_${randomUUID()}`
    const folderId = stringArgument(args, 'folder_id')
    const metadata: Record<string, unknown> = {
      name: stringArgument(args, 'name', true),
      mimeType: 'application/vnd.google-apps.document'
    }
    if (folderId) metadata.parents = [folderId]
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      stringArgument(args, 'content', true),
      `--${boundary}--`,
      ''
    ].join('\r\n')
    const result = await requestJson(
      'Google Drive',
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
      {
        method: 'POST',
        headers: bearer(accessToken, { 'Content-Type': `multipart/related; boundary=${boundary}` }),
        body,
        signal
      }
    )
    return {
      text: result.webViewLink
        ? `Document created in Google Drive.\n\n${result.webViewLink}`
        : 'Document created in Google Drive.',
      structuredContent: result
    }
  }

  if (catalogId === 'gmail' && toolName === 'create_draft') {
    const headers = [
      `To: ${stringArgument(args, 'to', true)}`,
      stringArgument(args, 'cc') ? `Cc: ${stringArgument(args, 'cc')}` : null,
      `Subject: ${stringArgument(args, 'subject', true)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      stringArgument(args, 'body', true)
    ].filter((item): item is string => item !== null)
    const raw = Buffer.from(headers.join('\r\n')).toString('base64url')
    const result = await requestJson(
      'Gmail',
      'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
      {
        method: 'POST',
        headers: bearer(accessToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ message: { raw } }),
        signal
      }
    )
    return { text: 'Draft created in Gmail.', structuredContent: result }
  }

  if (catalogId === 'todoist' && toolName === 'create_task') {
    const result = await requestJson('Todoist', 'https://api.todoist.com/api/v1/tasks', {
      method: 'POST',
      headers: bearer(accessToken, {
        'Content-Type': 'application/json',
        'X-Request-Id': randomUUID()
      }),
      body: JSON.stringify({
        content: stringArgument(args, 'content', true),
        description: stringArgument(args, 'description'),
        due_string: stringArgument(args, 'due_string'),
        project_id: stringArgument(args, 'project_id'),
        priority: typeof args.priority === 'number' ? args.priority : undefined
      }),
      signal
    })
    const taskId = typeof result.id === 'string' ? result.id : undefined
    return {
      text: taskId
        ? `Task created in Todoist.\n\nhttps://app.todoist.com/app/task/${taskId}`
        : 'Task created in Todoist.',
      structuredContent: result
    }
  }

  throw new Error('That API action is no longer available.')
}
