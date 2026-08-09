import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import JSON5 from 'json5'
import { parse as parseToml } from 'smol-toml'
import type { McpConnectionInput } from '../shared/mcp'
import { integrationManifestForEndpoint } from '../shared/integrations'

export interface DiscoveredMcpConfig {
  id: string
  fingerprint: string
  input: McpConnectionInput
}

interface ConfigSource {
  path: string
  source: string
  format: 'json' | 'toml'
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string | number | boolean] =>
      ['string', 'number', 'boolean'].includes(typeof entry[1])
    )
    .map(([key, item]) => [key, String(item)] as const)
  return entries.length ? Object.fromEntries(entries) : undefined
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined
}

function fingerprint(input: McpConnectionInput): string {
  const stable = JSON.stringify({
    transport: input.transport,
    command: input.command,
    args: input.args ?? [],
    cwd: input.cwd,
    url: input.url,
    env: input.env ?? {},
    headers: input.headers ?? {}
  })
  return createHash('sha256').update(stable).digest('hex').slice(0, 24)
}

function normalizeServer(
  name: string,
  raw: unknown,
  source: string
): DiscoveredMcpConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const urlValue = typeof value.httpUrl === 'string' ? value.httpUrl : value.url
  const url = typeof urlValue === 'string' ? urlValue.trim() : ''
  const command = typeof value.command === 'string' ? value.command.trim() : ''
  if (!url && !command) return null
  const requestedType = typeof value.type === 'string' ? value.type.toLowerCase() : ''
  const transport = url ? (requestedType === 'sse' ? 'sse' : 'http') : 'stdio'
  const headers = stringRecord(value.headers)
  const catalog = integrationManifestForEndpoint(url)
  const input: McpConnectionInput = {
    name,
    transport,
    source,
    enabled: true,
    ...(url
      ? {
          url,
          headers,
          auth: headers
            ? 'bearer'
            : catalog || (value.oauth && typeof value.oauth === 'object')
              ? 'oauth'
              : 'none',
          catalogId: catalog?.id
        }
      : {
          command,
          args: stringArray(value.args) ?? [],
          cwd: typeof value.cwd === 'string' ? value.cwd : undefined,
          env: stringRecord(value.env)
        })
  }
  const key = fingerprint(input)
  return { id: `${source}:${name}:${key}`, fingerprint: key, input }
}

function serverMap(root: Record<string, unknown>): Record<string, unknown> {
  const nested = root.mcpServers ?? root.mcp_servers ?? root.servers ?? root.context_servers
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : {}
}

export function parseMcpConfigText(
  text: string,
  format: 'json' | 'toml',
  source: string
): DiscoveredMcpConfig[] {
  let parsed: unknown
  try {
    parsed = format === 'toml' ? parseToml(text) : JSON5.parse(text)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  return Object.entries(serverMap(parsed as Record<string, unknown>))
    .map(([name, raw]) => normalizeServer(name, raw, source))
    .filter((item): item is DiscoveredMcpConfig => Boolean(item))
}

export function readMcpConfigFile(path: string, source?: string): DiscoveredMcpConfig[] {
  if (!existsSync(path)) return []
  const format = path.toLowerCase().endsWith('.toml') ? 'toml' : 'json'
  try {
    return parseMcpConfigText(
      readFileSync(path, 'utf8'),
      format,
      source ?? `Imported from ${basename(path)}`
    )
  } catch {
    return []
  }
}

export function knownMcpConfigSources(home = homedir()): ConfigSource[] {
  if (process.platform === 'darwin') {
    return [
      {
        path: join(home, 'Library/Application Support/Claude/claude_desktop_config.json'),
        source: 'Claude Desktop',
        format: 'json'
      },
      { path: join(home, '.claude.json'), source: 'Claude Code', format: 'json' },
      {
        path: join(home, 'Library/Application Support/Code/User/mcp.json'),
        source: 'Visual Studio Code',
        format: 'json'
      },
      {
        path: join(home, 'Library/Application Support/Code - Insiders/User/mcp.json'),
        source: 'Visual Studio Code Insiders',
        format: 'json'
      },
      {
        path: join(home, 'Library/Application Support/Cursor/User/mcp.json'),
        source: 'Cursor',
        format: 'json'
      },
      { path: join(home, '.cursor/mcp.json'), source: 'Cursor', format: 'json' },
      { path: join(home, '.codex/config.toml'), source: 'Codex', format: 'toml' },
      { path: join(home, '.gemini/settings.json'), source: 'Gemini CLI', format: 'json' },
      {
        path: join(home, 'Library/Application Support/Zed/settings.json'),
        source: 'Zed',
        format: 'json'
      },
      {
        path: join(home, '.codeium/windsurf/mcp_config.json'),
        source: 'Windsurf',
        format: 'json'
      }
    ]
  }

  return [
    {
      path: join(home, '.config/Claude/claude_desktop_config.json'),
      source: 'Claude Desktop',
      format: 'json'
    },
    { path: join(home, '.config/Code/User/mcp.json'), source: 'Visual Studio Code', format: 'json' },
    { path: join(home, '.cursor/mcp.json'), source: 'Cursor', format: 'json' },
    { path: join(home, '.codex/config.toml'), source: 'Codex', format: 'toml' },
    { path: join(home, '.claude.json'), source: 'Claude Code', format: 'json' },
    { path: join(home, '.gemini/settings.json'), source: 'Gemini CLI', format: 'json' },
    { path: join(home, '.config/zed/settings.json'), source: 'Zed', format: 'json' }
  ]
}

export function discoverKnownMcpConfigs(home = homedir()): DiscoveredMcpConfig[] {
  const seen = new Set<string>()
  const result: DiscoveredMcpConfig[] = []
  for (const source of knownMcpConfigSources(home)) {
    if (!existsSync(source.path)) continue
    let items: DiscoveredMcpConfig[] = []
    try {
      items = parseMcpConfigText(readFileSync(source.path, 'utf8'), source.format, source.source)
    } catch {
      continue
    }
    for (const item of items) {
      if (seen.has(item.fingerprint)) continue
      seen.add(item.fingerprint)
      result.push(item)
    }
  }
  return result
}
