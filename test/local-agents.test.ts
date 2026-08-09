import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findLocalAgentExecutable,
  localAgentInvocation,
  localAgentTool
} from '../src/main/localAgents'

const created: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('local agent discovery', () => {
  it('finds an executable from the explicit GUI PATH without invoking a shell', () => {
    const root = mkdtempSync(join(tmpdir(), 'noteato-agent-'))
    created.push(root)
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const command = join(bin, 'codex')
    writeFileSync(command, '#!/bin/sh\nexit 0\n')
    chmodSync(command, 0o755)

    expect(
      findLocalAgentExecutable('codex', {
        path: bin,
        homeDir: join(root, 'home'),
        platform: process.platform
      })
    ).toBe(realpathSync(command))
  })
})

describe('local agent handoffs', () => {
  it('keeps reviewed Codex context off the process argument list', () => {
    const invocation = localAgentInvocation('codex', {
      instruction: 'Create the follow-up',
      context: 'private meeting text'
    })

    expect(invocation.args).toContain('workspace-write')
    expect(invocation.args).not.toContain('private meeting text')
    expect(invocation.args.join(' ')).not.toContain('dangerously')
    expect(invocation.stdin).toContain('private meeting text')
  })

  it('uses supported one-shot modes without permission bypass flags', () => {
    const claude = localAgentInvocation('claude', { instruction: 'Draft the note' })
    const openclaw = localAgentInvocation('openclaw', { instruction: 'Create the task' })
    const hermes = localAgentInvocation('hermes', { instruction: 'Research the topic' })

    expect(claude.args).toContain('-p')
    expect(claude.args).toContain('acceptEdits')
    expect(claude.args.join(' ')).not.toContain('bypassPermissions')
    expect(openclaw.args).toEqual(expect.arrayContaining(['agent', '--local', '--message-file', '-']))
    expect(hermes.args.slice(0, 2)).toEqual(['chat', '-q'])
  })

  it('publishes one reviewed, destructive handoff tool per connected agent', () => {
    const tool = localAgentTool('agent-1', 'Claude Code')

    expect(tool).toMatchObject({
      connectionId: 'agent-1',
      name: 'delegate_to_agent',
      annotations: { destructiveHint: true },
      recipe: { id: 'custom-action', title: 'Delegate to agent' }
    })
    expect(tool.inputSchema).toMatchObject({ required: ['instruction'] })
  })
})
