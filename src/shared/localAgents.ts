export type LocalAgentId = 'claude' | 'codex' | 'openclaw' | 'hermes'

export interface LocalAgentManifest {
  id: LocalAgentId
  name: string
  description: string
  command: string
  color: string
}

export interface LocalAgentSummary extends LocalAgentManifest {
  installed: boolean
  connected: boolean
  connectionId?: string
  executablePath?: string
}

export const LOCAL_AGENT_CATALOG: readonly LocalAgentManifest[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    description: 'Hand off writing, research and project work to Claude Code.',
    command: 'claude',
    color: '#d97757'
  },
  {
    id: 'codex',
    name: 'Codex',
    description: 'Delegate reviewed tasks to the Codex agent installed on this Mac.',
    command: 'codex',
    color: '#10a37f'
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    description: 'Use your configured OpenClaw agent and its connected capabilities.',
    command: 'openclaw',
    color: '#e5553f'
  },
  {
    id: 'hermes',
    name: 'Hermes',
    description: 'Send a reviewed one-shot task to your local Hermes Agent.',
    command: 'hermes',
    color: '#9b7bd1'
  }
] as const

export function localAgentManifest(id: string | undefined): LocalAgentManifest | undefined {
  return LOCAL_AGENT_CATALOG.find((agent) => agent.id === id)
}

export function isLocalAgentId(value: unknown): value is LocalAgentId {
  return typeof value === 'string' && LOCAL_AGENT_CATALOG.some((agent) => agent.id === value)
}
