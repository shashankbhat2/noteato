import { describe, expect, it } from 'vitest'
import {
  localAgentDelegateSuggestions,
  parseDelegateSuggestions,
  type McpToolSummary
} from '../src/shared/mcp'
import { parseMcpConfigText } from '../src/main/mcpConfigDiscovery'
import { INTEGRATION_CATALOG, recipeForTool } from '../src/shared/integrations'

const tools: McpToolSummary[] = [
  {
    connectionId: 'linear',
    connectionName: 'Linear',
    name: 'create_issue',
    title: 'Create issue',
    description: 'Creates an issue',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
    annotations: { destructiveHint: false },
    recipe: {
      id: 'create-development-issue',
      title: 'Create issue',
      description: 'Turn the selection into an issue.',
      icon: 'issue'
    }
  },
  {
    connectionId: 'slack',
    connectionName: 'Slack',
    name: 'send_message',
    title: 'Send message',
    description: 'Sends a message',
    inputSchema: { type: 'object' },
    annotations: { destructiveHint: true },
    recipe: {
      id: 'send-message',
      title: 'Send message',
      description: 'Send a reviewed message.',
      icon: 'send'
    }
  }
]

describe('delegate planner output', () => {
  it('always exposes connected local agents without waiting for planner output', () => {
    const agentTools: McpToolSummary[] = ['Claude Code', 'Codex'].map((name, index) => ({
      connectionId: `agent-${index}`,
      connectionName: name,
      name: 'delegate_to_agent',
      title: `Delegate to ${name}`,
      description: 'Runs a local coding agent',
      inputSchema: { type: 'object' },
      annotations: { destructiveHint: true },
      recipe: {
        id: 'custom-action',
        title: 'Delegate to agent',
        description: 'Hand work to a local agent.',
        icon: 'agent'
      }
    }))
    const suggestions = localAgentDelegateSuggestions(
      { noteId: 'n1', noteTitle: 'Launch plan', tab: 'Note', markdown: 'Ship the fix.' },
      agentTools
    )

    expect(suggestions.map((suggestion) => suggestion.title)).toEqual([
      'Delegate to Claude Code',
      'Delegate to Codex'
    ])
    expect(suggestions[0].arguments).toMatchObject({ context: 'Ship the fix.' })
  })

  it('accepts only exact tools from the supplied allowlist', () => {
    const parsed = parseDelegateSuggestions(
      `\`\`\`json
      {"suggestions":[
        {"connectionId":"linear","toolName":"create_issue","title":"Create onboarding issue","reason":"The selection has an owner","arguments":{"title":"Onboarding"}},
        {"connectionId":"mail","toolName":"send_everything","title":"Invented","arguments":{}},
        {"connectionId":"linear","toolName":"create_issue","title":"Duplicate","arguments":{}}
      ]}
      \`\`\``,
      tools
    )

    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({
      connectionId: 'linear',
      toolName: 'create_issue',
      title: 'Create onboarding issue',
      arguments: { title: 'Onboarding' },
      destructive: false,
      recipeId: 'create-development-issue'
    })
  })

  it('preserves destructive metadata from the registry, not the model', () => {
    const parsed = parseDelegateSuggestions(
      '{"suggestions":[{"connectionId":"slack","toolName":"send_message","title":"Send follow-up","arguments":{}}]}',
      tools
    )
    expect(parsed[0].destructive).toBe(true)
  })
})

describe('integration action recipes', () => {
  it('separates dynamic MCP providers from direct API integrations', () => {
    expect(INTEGRATION_CATALOG.some((item) => item.id === 'pipedream')).toBe(false)
    expect(INTEGRATION_CATALOG.some((item) => item.id === 'notion')).toBe(false)
    expect(INTEGRATION_CATALOG.some((item) => item.id === 'google-calendar')).toBe(false)
    expect(INTEGRATION_CATALOG.find((item) => item.id === 'linear')?.connection).toBe(
      'dynamic-mcp'
    )
    expect(INTEGRATION_CATALOG.find((item) => item.id === 'atlassian')?.connection).toBe(
      'dynamic-mcp'
    )
    expect(INTEGRATION_CATALOG.find((item) => item.id === 'slack')?.connection).toBe('api')
    expect(INTEGRATION_CATALOG.find((item) => item.id === 'asana')?.connection).toBe('api')
    expect(INTEGRATION_CATALOG.find((item) => item.id === 'github')?.connection).toBe('api')
    expect(INTEGRATION_CATALOG.find((item) => item.id === 'google-drive')).toMatchObject({
      connection: 'api'
    })
    expect(INTEGRATION_CATALOG.find((item) => item.id === 'gmail')).toMatchObject({
      connection: 'api'
    })
    expect(INTEGRATION_CATALOG.find((item) => item.id === 'sentry')?.connection).toBe(
      'dynamic-mcp'
    )
    expect(INTEGRATION_CATALOG.find((item) => item.id === 'intercom')?.connection).toBe(
      'dynamic-mcp'
    )
    expect(INTEGRATION_CATALOG.find((item) => item.id === 'stripe')?.connection).toBe(
      'dynamic-mcp'
    )
    expect(INTEGRATION_CATALOG.find((item) => item.id === 'todoist')?.connection).toBe('api')
  })

  it('normalizes equivalent MCP tool names into stable user-facing actions', () => {
    expect(
      recipeForTool({
        name: 'issues_create',
        title: 'Create an issue',
        description: 'Creates a new project issue'
      }).id
    ).toBe('create-development-issue')
    expect(
      recipeForTool({
        name: 'calendar_create_event',
        title: 'Create event',
        description: 'Adds an event to a calendar'
      }).id
    ).toBe('schedule-meeting')
  })
})

describe('MCP configuration import', () => {
  it('normalizes Claude-style and VS Code-style JSON server maps', () => {
    const claude = parseMcpConfigText(
      JSON.stringify({
        mcpServers: {
          linear: {
            command: 'npx',
            args: ['-y', 'linear-mcp'],
            env: { LINEAR_KEY: 'secret' }
          }
        }
      }),
      'json',
      'Claude Desktop'
    )
    const vscode = parseMcpConfigText(
      JSON.stringify({
        servers: {
          slack: {
            type: 'http',
            url: 'https://mcp.slack.example/mcp',
            headers: { Authorization: 'Bearer secret' }
          }
        }
      }),
      'json',
      'Visual Studio Code'
    )

    expect(claude[0].input).toMatchObject({
      name: 'linear',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'linear-mcp'],
      env: { LINEAR_KEY: 'secret' }
    })
    expect(vscode[0].input).toMatchObject({
      name: 'slack',
      transport: 'http',
      url: 'https://mcp.slack.example/mcp'
    })
  })

  it('normalizes Codex TOML MCP servers', () => {
    const parsed = parseMcpConfigText(
      `[mcp_servers.github]
command = "npx"
args = ["-y", "github-mcp"]

[mcp_servers.github.env]
GITHUB_TOKEN = "secret"
`,
      'toml',
      'Codex'
    )

    expect(parsed[0].input).toMatchObject({
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'github-mcp'],
      env: { GITHUB_TOKEN: 'secret' }
    })
  })

  it('normalizes Gemini HTTP and Zed context server configurations', () => {
    const gemini = parseMcpConfigText(
      JSON.stringify({
        mcpServers: {
          calendar: {
            httpUrl: 'https://calendar.example/mcp',
            headers: { Authorization: 'Bearer secret' }
          }
        }
      }),
      'json',
      'Gemini CLI'
    )
    const zed = parseMcpConfigText(
      JSON.stringify({
        context_servers: {
          tasks: { command: 'uvx', args: ['tasks-mcp'] }
        }
      }),
      'json',
      'Zed'
    )

    expect(gemini[0].input).toMatchObject({
      name: 'calendar',
      transport: 'http',
      url: 'https://calendar.example/mcp'
    })
    expect(zed[0].input).toMatchObject({
      name: 'tasks',
      transport: 'stdio',
      command: 'uvx',
      args: ['tasks-mcp']
    })
  })

  it('accepts comments and trailing commas in desktop app configurations', () => {
    const parsed = parseMcpConfigText(
      `{
        // User settings files are commonly JSONC rather than strict JSON.
        "servers": {
          "memory": {
            "command": "npx",
            "args": ["-y", "memory-mcp"],
          },
        },
      }`,
      'json',
      'Visual Studio Code'
    )

    expect(parsed[0].input).toMatchObject({
      name: 'memory',
      command: 'npx',
      args: ['-y', 'memory-mcp']
    })
  })
})
