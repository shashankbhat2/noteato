export type IntegrationCategory =
  | 'Productivity'
  | 'Communication'
  | 'Development'
  | 'Knowledge'
  | 'Automation'

export type IntegrationRecipeId =
  | 'create-task'
  | 'create-document'
  | 'draft-message'
  | 'send-message'
  | 'schedule-meeting'
  | 'create-development-issue'
  | 'update-project-status'
  | 'custom-action'

export interface IntegrationRecipe {
  id: IntegrationRecipeId
  title: string
  description: string
  category: IntegrationCategory
  icon: 'checklist' | 'document' | 'mail' | 'send' | 'calendar' | 'issue' | 'status' | 'sparkle'
}

export interface IntegrationManifest {
  id: string
  name: string
  description: string
  category: IntegrationCategory
  endpoint?: string
  auth: 'oauth' | 'token'
  source: string
  monogram: string
  color: string
  recipeIds: IntegrationRecipeId[]
  /** The hostname is shown before OAuth so the destination is inspectable. */
  verifiedHost: string
  connection: 'dynamic-mcp' | 'api'
  credential?: {
    label: string
    placeholder: string
    help: string
    setupUrl: string
  }
}

export const INTEGRATION_RECIPES: readonly IntegrationRecipe[] = [
  {
    id: 'create-task',
    title: 'Create task',
    description: 'Turn the selection into an assigned task or to-do.',
    category: 'Productivity',
    icon: 'checklist'
  },
  {
    id: 'create-document',
    title: 'Create document',
    description: 'Publish the selection as a page or document.',
    category: 'Knowledge',
    icon: 'document'
  },
  {
    id: 'draft-message',
    title: 'Draft message',
    description: 'Prepare a message without sending it.',
    category: 'Communication',
    icon: 'mail'
  },
  {
    id: 'send-message',
    title: 'Send message',
    description: 'Send a reviewed message through a connected app.',
    category: 'Communication',
    icon: 'send'
  },
  {
    id: 'schedule-meeting',
    title: 'Schedule meeting',
    description: 'Create a calendar event from the selected details.',
    category: 'Productivity',
    icon: 'calendar'
  },
  {
    id: 'create-development-issue',
    title: 'Create issue',
    description: 'Turn the selection into a tracked engineering or product issue.',
    category: 'Development',
    icon: 'issue'
  },
  {
    id: 'update-project-status',
    title: 'Update project status',
    description: 'Post a reviewed status update to a project or work item.',
    category: 'Productivity',
    icon: 'status'
  },
  {
    id: 'custom-action',
    title: 'Run app action',
    description: 'Use a capability exposed directly by the connected app.',
    category: 'Automation',
    icon: 'sparkle'
  }
] as const

/**
 * A deliberately small, reviewed catalog. These are vendor-hosted endpoints;
 * arbitrary servers still belong in Custom and are never represented as
 * verified integrations.
 */
export const INTEGRATION_CATALOG: readonly IntegrationManifest[] = [
  {
    id: 'linear',
    name: 'Linear',
    description: 'Create issues, update projects and follow work from meeting decisions.',
    category: 'Productivity',
    endpoint: 'https://mcp.linear.app/mcp',
    auth: 'oauth',
    source: 'Noteato catalog · Linear',
    monogram: 'L',
    color: '#5e6ad2',
    recipeIds: ['create-task', 'create-development-issue', 'update-project-status'],
    verifiedHost: 'mcp.linear.app',
    connection: 'dynamic-mcp'
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Create issues and hand technical follow-ups to repositories.',
    category: 'Development',
    auth: 'token',
    source: 'Noteato catalog · GitHub',
    monogram: 'GH',
    color: '#6e7681',
    recipeIds: ['create-development-issue', 'create-task', 'update-project-status'],
    verifiedHost: 'api.github.com',
    connection: 'api',
    credential: {
      label: 'Fine-grained personal access token',
      placeholder: 'github_pat_…',
      help: 'Use a token with Issues read and write access for the repositories you delegate to.',
      setupUrl: 'https://github.com/settings/personal-access-tokens/new'
    }
  },
  {
    id: 'atlassian',
    name: 'Atlassian',
    description: 'Create Jira work and Confluence pages from notes and meetings.',
    category: 'Productivity',
    endpoint: 'https://mcp.atlassian.com/v1/mcp/authv2',
    auth: 'oauth',
    source: 'Noteato catalog · Atlassian',
    monogram: 'A',
    color: '#1868db',
    recipeIds: ['create-development-issue', 'create-document', 'create-task', 'update-project-status'],
    verifiedHost: 'mcp.atlassian.com',
    connection: 'dynamic-mcp'
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Send follow-ups and turn meeting decisions into team messages.',
    category: 'Communication',
    auth: 'token',
    source: 'Noteato catalog · Slack',
    monogram: 'S',
    color: '#36c5f0',
    recipeIds: ['draft-message', 'send-message'],
    verifiedHost: 'slack.com',
    connection: 'api',
    credential: {
      label: 'Bot or user OAuth token',
      placeholder: 'xoxb-…',
      help: 'The token needs chat:write. The Slack app must be installed in the target workspace.',
      setupUrl: 'https://api.slack.com/apps'
    }
  },
  {
    id: 'asana',
    name: 'Asana',
    description: 'Create tasks, assign follow-ups and update project work.',
    category: 'Productivity',
    auth: 'token',
    source: 'Noteato catalog · Asana',
    monogram: 'AS',
    color: '#f06a6a',
    recipeIds: ['create-task', 'update-project-status'],
    verifiedHost: 'app.asana.com',
    connection: 'api',
    credential: {
      label: 'Personal access token',
      placeholder: 'Paste Asana token',
      help: 'Create a personal access token in the Asana developer console.',
      setupUrl: 'https://app.asana.com/0/my-apps'
    }
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Find, create and organize files from decisions and follow-ups.',
    category: 'Productivity',
    auth: 'token',
    source: 'Noteato catalog · Google Drive',
    monogram: 'GD',
    color: '#4285f4',
    recipeIds: ['create-document', 'custom-action'],
    verifiedHost: 'www.googleapis.com',
    connection: 'api',
    credential: {
      label: 'OAuth access token',
      placeholder: 'ya29.…',
      help: 'Use an access token with Drive file access. Google access tokens can expire and be replaced here.',
      setupUrl: 'https://console.cloud.google.com/apis/credentials'
    }
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Draft follow-up emails and work with reviewed threads.',
    category: 'Communication',
    auth: 'token',
    source: 'Noteato catalog · Gmail',
    monogram: 'GM',
    color: '#ea4335',
    recipeIds: ['draft-message', 'custom-action'],
    verifiedHost: 'gmail.googleapis.com',
    connection: 'api',
    credential: {
      label: 'OAuth access token',
      placeholder: 'ya29.…',
      help: 'Use an access token with Gmail draft access. Google access tokens can expire and be replaced here.',
      setupUrl: 'https://console.cloud.google.com/apis/credentials'
    }
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Investigate errors and turn findings into tracked engineering work.',
    category: 'Development',
    endpoint: 'https://mcp.sentry.dev/mcp',
    auth: 'oauth',
    source: 'Noteato catalog · Sentry',
    monogram: 'SE',
    color: '#6c5fc7',
    recipeIds: ['create-development-issue', 'update-project-status', 'custom-action'],
    verifiedHost: 'mcp.sentry.dev',
    connection: 'dynamic-mcp'
  },
  {
    id: 'intercom',
    name: 'Intercom',
    description: 'Turn customer conversations into support and follow-up actions.',
    category: 'Communication',
    endpoint: 'https://mcp.intercom.com/mcp',
    auth: 'oauth',
    source: 'Noteato catalog · Intercom',
    monogram: 'IN',
    color: '#21a79d',
    recipeIds: ['create-document', 'send-message', 'custom-action'],
    verifiedHost: 'mcp.intercom.com',
    connection: 'dynamic-mcp'
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Create reviewed billing and customer operations from notes.',
    category: 'Automation',
    endpoint: 'https://mcp.stripe.com',
    auth: 'oauth',
    source: 'Noteato catalog · Stripe',
    monogram: 'ST',
    color: '#635bff',
    recipeIds: ['custom-action'],
    verifiedHost: 'mcp.stripe.com',
    connection: 'dynamic-mcp'
  },
  {
    id: 'todoist',
    name: 'Todoist',
    description: 'Send clear tasks and due dates directly to your Todoist inbox.',
    category: 'Productivity',
    auth: 'token',
    source: 'Noteato catalog · Todoist',
    monogram: 'TD',
    color: '#e44332',
    recipeIds: ['create-task'],
    verifiedHost: 'api.todoist.com',
    connection: 'api',
    credential: {
      label: 'Personal API token',
      placeholder: 'Paste Todoist token',
      help: 'Find this token under Todoist Settings → Integrations → Developer.',
      setupUrl: 'https://app.todoist.com/app/settings/integrations/developer'
    }
  }
] as const

export function integrationManifest(id: string | undefined): IntegrationManifest | undefined {
  return id ? INTEGRATION_CATALOG.find((item) => item.id === id) : undefined
}

export function integrationManifestForEndpoint(
  endpoint: string | undefined
): IntegrationManifest | undefined {
  if (!endpoint) return undefined
  const normalized = endpoint.replace(/\/+$/, '')
  return INTEGRATION_CATALOG.find(
    (item) => item.endpoint?.replace(/\/+$/, '') === normalized
  )
}

export function integrationRecipe(id: IntegrationRecipeId): IntegrationRecipe {
  return INTEGRATION_RECIPES.find((item) => item.id === id) ?? INTEGRATION_RECIPES.at(-1)!
}

interface RecipeToolLike {
  name: string
  title: string
  description: string
}

/**
 * MCPs describe equivalent operations with different tool names. This keeps
 * the UI stable while the exact MCP tool remains the execution authority.
 */
export function recipeForTool(tool: RecipeToolLike): IntegrationRecipe {
  const text = `${tool.name} ${tool.title} ${tool.description}`
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
  const matches = (pattern: RegExp): boolean => pattern.test(text)
  const hasAction = (pattern: RegExp): boolean => matches(pattern)
  const hasObject = (pattern: RegExp): boolean => matches(pattern)

  if (hasAction(/\b(draft|compose|create[-_ ]?draft)\w*\b/) && hasObject(/\b(email|mail|message)\w*\b/)) {
    return integrationRecipe('draft-message')
  }
  if (hasAction(/\b(send|post|publish)\w*\b/) && hasObject(/\b(email|mail|message|chat)\w*\b/)) {
    return integrationRecipe('send-message')
  }
  if (hasAction(/\b(create|add|schedule)\w*\b/) && hasObject(/\b(event|meeting|calendar)\w*\b/)) {
    return integrationRecipe('schedule-meeting')
  }
  if (hasAction(/\b(create|open|add)\w*\b/) && hasObject(/\b(issue|ticket|bug)\w*\b/)) {
    return integrationRecipe('create-development-issue')
  }
  if (hasAction(/\b(create|add)\w*\b/) && hasObject(/\b(task|todo|to-do)\w*\b/)) {
    return integrationRecipe('create-task')
  }
  if (hasAction(/\b(create|publish|append|update)\w*\b/) && hasObject(/\b(page|document|doc)\w*\b/)) {
    return integrationRecipe('create-document')
  }
  if (hasAction(/\b(update|set|post)\w*\b/) && hasObject(/\b(status|progress)\w*\b/)) {
    return integrationRecipe('update-project-status')
  }
  return integrationRecipe('custom-action')
}
