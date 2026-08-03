import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, Socket } from 'node:net'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import WebSocket from 'ws'
import { modelPaths } from './model'
import { parseAsrResult, type AsrResult } from './parseResult'

const BINARY = 'sherpa-onnx-offline-websocket-server'
/** Shut the server down after this long unused: it holds the model in memory. */
const IDLE_MS = 3 * 60 * 1000
const READY_TIMEOUT_MS = 60_000

function binaryPath(): string | null {
  const candidates = [
    join(process.resourcesPath ?? '', 'bin', BINARY),
    join(app.getAppPath(), 'resources', 'bin', BINARY)
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port ? resolve(port) : reject(new Error('no free port'))))
    })
  })
}

/**
 * The offline sherpa-onnx ASR server, spawned on demand.
 *
 * Kept out of the main process deliberately: the model is hundreds of megabytes
 * resident, and a separate process can be shut down when idle rather than
 * inflating Noteato's own footprint for the rest of the session.
 */
export class SherpaServer {
  private child: ChildProcess | null = null
  private port = 0
  private starting: Promise<number> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private busy = 0

  async ensureRunning(): Promise<number> {
    if (this.child && this.port) return this.port
    if (this.starting) return this.starting
    this.starting = this.launch().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async launch(): Promise<number> {
    const binary = binaryPath()
    if (!binary) throw new Error('the speech recognition server is not installed')

    const model = modelPaths()
    const port = await freePort()

    const child = spawn(
      binary,
      [
        `--port=${port}`,
        `--tokens=${model.tokens}`,
        `--encoder=${model.encoder}`,
        `--decoder=${model.decoder}`,
        `--joiner=${model.joiner}`,
        '--num-work-threads=2',
        '--max-batch-size=1'
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        // The dylibs sit beside the binary; without this dyld cannot find them.
        env: { ...process.env, DYLD_LIBRARY_PATH: dirname(binary) }
      }
    )
    this.child = child
    this.port = port

    child.on('exit', () => {
      if (this.child === child) {
        this.child = null
        this.port = 0
      }
    })

    await this.waitForListening(child, port)
    return port
  }

  /**
   * Wait for the port to accept connections rather than for a log line: the
   * server's readiness message has changed between releases, but a socket that
   * accepts is the actual condition we need.
   */
  private waitForListening(child: ChildProcess, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + READY_TIMEOUT_MS
      let stderr = ''
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-2000)
      })

      const attempt = (): void => {
        if (!this.child) {
          reject(new Error(`speech recognition server exited.\n${stderr.trim()}`))
          return
        }
        if (Date.now() > deadline) {
          reject(new Error(`speech recognition server did not start.\n${stderr.trim()}`))
          return
        }
        const probe = new Socket()
        probe.setTimeout(1000)
        probe.once('connect', () => {
          probe.destroy()
          resolve()
        })
        probe.once('error', () => {
          probe.destroy()
          setTimeout(attempt, 300)
        })
        probe.once('timeout', () => {
          probe.destroy()
          setTimeout(attempt, 300)
        })
        probe.connect(port, '127.0.0.1')
      }
      attempt()
    })
  }

  /**
   * Transcribe 16 kHz mono float32 samples.
   *
   * Wire format is sherpa-onnx's own: [int32LE sampleRate][int32LE byteLength]
   * followed by the raw float32 samples, then a "Done" once the result arrives.
   * The reply is a JSON object carrying the text and per-token timings.
   */
  async transcribe(samples: Float32Array, sampleRate: number): Promise<AsrResult> {
    const port = await this.ensureRunning()
    this.busy += 1
    this.cancelIdleTimer()

    try {
      const raw = await new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`)
        let result = ''

        ws.on('open', () => {
          const audio = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
          const message = Buffer.alloc(8 + audio.length)
          message.writeInt32LE(sampleRate, 0)
          message.writeInt32LE(audio.length, 4)
          audio.copy(message, 8)
          ws.send(message)
        })
        ws.on('message', (data: Buffer) => {
          result += data.toString()
          ws.send('Done')
        })
        ws.on('error', reject)
        ws.on('close', () => resolve(result))
      })
      return parseAsrResult(raw)
    } finally {
      this.busy -= 1
      this.scheduleIdleShutdown()
    }
  }

  private scheduleIdleShutdown(): void {
    this.cancelIdleTimer()
    if (this.busy > 0) return
    this.idleTimer = setTimeout(() => this.stop(), IDLE_MS)
    this.idleTimer.unref?.()
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  stop(): void {
    this.cancelIdleTimer()
    this.child?.kill('SIGTERM')
    this.child = null
    this.port = 0
  }
}
