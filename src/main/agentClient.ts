import { connect, type Socket } from 'net'
import { join } from 'path'
import { app } from 'electron'

/**
 * Client for the NoteatoAgent socket.
 *
 * The agent is the source of truth; this process is a client that may come and
 * go (revamp brief §2). Nothing here may block startup or fail loudly when the
 * agent is absent — a library that refuses to open because a helper is missing
 * is a worse product than one that opens with its hotkeys temporarily its own.
 *
 * Framing matches AgentCore.Framing: a 4-byte big-endian length, then that many
 * bytes of UTF-8 JSON.
 */

export interface AgentMessage {
  type: 'welcome' | 'pong' | 'showLibrary' | 'toggleSidebar' | 'hudDidShow' | 'hudDidHide'
  version?: string
  pid?: number
  protocolVersion?: number
}

interface ClientMessage {
  type: 'hello' | 'ping' | 'goodbye'
  pid?: number
  protocolVersion?: number
}

const PROTOCOL_VERSION = 1
/** Frames larger than this are a bug or a hostile peer — matches the agent. */
const MAX_FRAME_BYTES = 8 * 1024 * 1024
const RECONNECT_MS = 2000

export function agentSocketPath(): string {
  return join(app.getPath('appData'), 'Noteato', 'agent.sock')
}

export class AgentClient {
  private socket: Socket | null = null
  private buffer = Buffer.alloc(0)
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private connected = false

  constructor(
    private onMessage: (message: AgentMessage) => void,
    private onConnectionChange: (connected: boolean) => void
  ) {}

  isConnected(): boolean {
    return this.connected
  }

  start(): void {
    this.stopped = false
    this.open()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    if (this.socket) {
      this.send({ type: 'goodbye' })
      this.socket.destroy()
      this.socket = null
    }
    this.setConnected(false)
  }

  send(message: ClientMessage): void {
    const socket = this.socket
    if (!socket || socket.destroyed) return
    const payload = Buffer.from(JSON.stringify(message), 'utf-8')
    const frame = Buffer.alloc(4 + payload.length)
    frame.writeUInt32BE(payload.length, 0)
    payload.copy(frame, 4)
    socket.write(frame)
  }

  private setConnected(next: boolean): void {
    if (this.connected === next) return
    this.connected = next
    this.onConnectionChange(next)
  }

  private open(): void {
    if (this.stopped) return
    const socket = connect(agentSocketPath())
    this.socket = socket
    this.buffer = Buffer.alloc(0)

    socket.on('connect', () => {
      this.setConnected(true)
      this.send({
        type: 'hello',
        pid: process.pid,
        protocolVersion: PROTOCOL_VERSION
      })
    })

    socket.on('data', (chunk) => this.consume(chunk))

    // ENOENT simply means the agent is not running; that is an ordinary state,
    // not an error worth surfacing. Retry quietly until it appears.
    socket.on('error', () => undefined)
    socket.on('close', () => {
      this.setConnected(false)
      this.socket = null
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, RECONNECT_MS)
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      if (this.buffer.length < 4) return
      const length = this.buffer.readUInt32BE(0)
      if (length > MAX_FRAME_BYTES) {
        // Framing can no longer be trusted; drop the connection rather than
        // trying to resynchronise a stream of unknown shape.
        this.socket?.destroy()
        return
      }
      if (this.buffer.length < 4 + length) return
      const frame = this.buffer.subarray(4, 4 + length)
      this.buffer = this.buffer.subarray(4 + length)
      try {
        const message = JSON.parse(frame.toString('utf-8')) as AgentMessage
        // Unknown types are ignored, so a newer agent paired with an older
        // library degrades to the intersection rather than failing.
        this.onMessage(message)
      } catch {
        /* malformed frame — skip it, keep the connection */
      }
    }
  }
}
