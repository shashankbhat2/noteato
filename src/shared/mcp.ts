import type { IntegrationRecipeId } from './integrations'
import type { LocalAgentId } from './localAgents'

export type McpTransport = 'stdio' | 'http' | 'sse' | 'api' | 'agent'
export type McpConnectionStatus =
  | 'disconnected'
  | 'authorizing'
  | 'connecting'
  | 'connected'
  | 'error'
export type McpAuthMode = 'none' | 'bearer' | 'oauth'

export interface McpConnectionInput {
  name: string
  transport: McpTransport
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled?: boolean
  source?: string
  catalogId?: string
  auth?: McpAuthMode
  apiCredentials?: Record<string, string>
  agentId?: LocalAgentId
}

export interface McpConnectionSummary {
  id: string
  name: string
  transport: McpTransport
  command?: string
  args: string[]
  cwd?: string
  url?: string
  environmentKeys: string[]
  headerKeys: string[]
  enabled: boolean
  source: string
  catalogId?: string
  agentId?: LocalAgentId
  auth: McpAuthMode
  status: McpConnectionStatus
  toolCount: number
  error?: string
  createdAt: string
  updatedAt: string
}

export interface McpImportCandidate {
  id: string
  name: string
  transport: McpTransport
  source: string
  command?: string
  args: string[]
  cwd?: string
  url?: string
  environmentKeys: string[]
  headerKeys: string[]
  alreadyImported: boolean
}

export interface McpToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface McpToolSummary {
  connectionId: string
  connectionName: string
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: McpToolAnnotations
  recipe: {
    id: IntegrationRecipeId
    title: string
    description: string
    icon: string
  }
}

export interface DelegateContext {
  noteId: string
  noteTitle: string
  tab: 'Note' | 'Meeting notes'
  markdown: string
}

export interface DelegateSuggestion {
  id: string
  connectionId: string
  connectionName: string
  toolName: string
  title: string
  reason: string
  arguments: Record<string, unknown>
  inputSchema: Record<string, unknown>
  destructive: boolean
  recipeId: IntegrationRecipeId
  recipeTitle: string
  recipeDescription: string
  recipeIcon: string
}

export interface DelegateSuggestionsResult {
  connections: McpConnectionSummary[]
  suggestions: DelegateSuggestion[]
  unavailableReason?: string
}

export interface McpExecuteRequest {
  connectionId: string
  toolName: string
  arguments: Record<string, unknown>
}

export interface McpExecutionProgress {
  status: 'connecting' | 'running' | 'completed'
  message: string
  progress?: number
  total?: number
}

export interface McpExecutionResult {
  connectionId: string
  connectionName: string
  toolName: string
  text: string
  structuredContent?: unknown
  isError: boolean
}

/**
 * Local agents are explicit destinations, not model-generated guesses. Always
 * offer each connected agent so Handoff remains useful even when the planner
 * returns no app actions (or no AI provider is configured).
 */
export function localAgentDelegateSuggestions(
  context: DelegateContext,
  tools: readonly McpToolSummary[]
): DelegateSuggestion[] {
  return tools
    .filter((tool) => tool.name === 'delegate_to_agent')
    .map((tool) => ({
      id: `${tool.connectionId}:${tool.name}`,
      connectionId: tool.connectionId,
      connectionName: tool.connectionName,
      toolName: tool.name,
      title: `Delegate to ${tool.connectionName}`,
      reason: `Hand the selected ${context.tab.toLowerCase()} text to ${tool.connectionName}.`,
      arguments: {
        instruction: `Act on the selected text from "${context.noteTitle}". Complete the work it requests. If it is context rather than a direct request, identify and complete the most useful next step.`,
        context: context.markdown
      },
      inputSchema: tool.inputSchema,
      destructive: tool.annotations?.destructiveHint === true,
      recipeId: tool.recipe.id,
      recipeTitle: tool.recipe.title,
      recipeDescription: tool.recipe.description,
      recipeIcon: tool.recipe.icon
    }))
}

interface RawSuggestion {
  connectionId?: unknown
  toolName?: unknown
  title?: unknown
  reason?: unknown
  arguments?: unknown
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function plannerJson(raw: string): Record<string, unknown> | null {
  const withoutFence = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return objectValue(JSON.parse(withoutFence.slice(start, end + 1)))
  } catch {
    return null
  }
}

/**
 * The planner is advisory. Only references that exist in the exact tool list
 * supplied by Noteato survive parsing, so a prompt-injected or hallucinated
 * tool can never reach the execution path.
 */
export function parseDelegateSuggestions(
  raw: string,
  tools: readonly McpToolSummary[]
): DelegateSuggestion[] {
  const parsed = plannerJson(raw)
  const candidates = Array.isArray(parsed?.suggestions)
    ? (parsed.suggestions as RawSuggestion[])
    : []
  const seen = new Set<string>()
  const result: DelegateSuggestion[] = []

  for (const candidate of candidates.slice(0, 8)) {
    if (typeof candidate?.connectionId !== 'string' || typeof candidate.toolName !== 'string') {
      continue
    }
    const tool = tools.find(
      (item) =>
        item.connectionId === candidate.connectionId && item.name === candidate.toolName
    )
    if (!tool) continue
    const key = `${tool.connectionId}:${
      tool.recipe.id === 'custom-action' ? tool.name : tool.recipe.id
    }`
    if (seen.has(key)) continue
    const args = objectValue(candidate.arguments) ?? {}
    const title =
      typeof candidate.title === 'string' && candidate.title.trim()
        ? candidate.title.trim().slice(0, 90)
        : tool.title
    const reason =
      typeof candidate.reason === 'string' ? candidate.reason.trim().slice(0, 180) : ''
    result.push({
      id: key,
      connectionId: tool.connectionId,
      connectionName: tool.connectionName,
      toolName: tool.name,
      title,
      reason,
      arguments: args,
      inputSchema: tool.inputSchema,
      destructive: tool.annotations?.destructiveHint === true,
      recipeId: tool.recipe.id,
      recipeTitle: tool.recipe.title,
      recipeDescription: tool.recipe.description,
      recipeIcon: tool.recipe.icon
    })
    seen.add(key)
  }

  return result.slice(0, 5)
}
