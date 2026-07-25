import { watch, type FSWatcher } from 'fs'
import { basename, dirname, join } from 'path'

const DEBOUNCE_MS = 200
// Ignore watcher events for a path this long after Noteato itself wrote it,
// so an editor's own autosave doesn't bounce back as an "external" change.
const SELF_WRITE_SUPPRESS_MS = 1000

interface WatchedRoot {
  path: string
  kind: 'file' | 'folder'
}

/**
 * Watches registered external files and folders so open editors always
 * reflect the latest on-disk content. Single files are watched via their
 * parent directory (surviving atomic save-and-rename by other editors);
 * folders are watched recursively.
 */
export class ExternalWatcher {
  private watchers = new Map<string, FSWatcher>()
  private kinds = new Map<string, 'file' | 'folder'>()
  private debounceTimers = new Map<string, NodeJS.Timeout>()
  private selfWrites = new Map<string, number>()

  constructor(private onChange: (rootPath: string, kind: 'file' | 'folder') => void) {}

  /** Reconcile the watcher set with the currently registered roots. */
  sync(roots: WatchedRoot[]): void {
    const next = new Map(roots.map((root) => [root.path, root.kind] as const))
    for (const [path, watcher] of this.watchers) {
      if (!next.has(path)) {
        watcher.close()
        this.watchers.delete(path)
        this.kinds.delete(path)
      }
    }
    for (const [path, kind] of next) {
      if (!this.watchers.has(path)) this.add(path, kind)
    }
  }

  /** Note that Noteato itself is writing this path right now. */
  markSelfWrite(path: string): void {
    this.selfWrites.set(path, Date.now())
  }

  destroy(): void {
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
    this.kinds.clear()
    for (const timer of this.debounceTimers.values()) clearTimeout(timer)
    this.debounceTimers.clear()
  }

  private add(path: string, kind: 'file' | 'folder'): void {
    try {
      const watcher =
        kind === 'file'
          ? watch(dirname(path), (_event, filename) => {
              if (filename && filename !== basename(path)) return
              this.schedule(path, kind)
            })
          : watch(path, { recursive: true }, (_event, filename) => {
              if (filename) {
                // Only markdown changes matter inside a linked folder, and a
                // change Noteato itself just wrote is not an external edit.
                if (!/\.(md|markdown)$/i.test(filename)) return
                const full = join(path, filename)
                const wroteAt = this.selfWrites.get(full)
                if (wroteAt && Date.now() - wroteAt < SELF_WRITE_SUPPRESS_MS) return
              }
              this.schedule(path, kind)
            })
      watcher.on('error', () => {
        watcher.close()
        this.watchers.delete(path)
      })
      this.watchers.set(path, watcher)
      this.kinds.set(path, kind)
    } catch {
      /* path vanished or is unwatchable — a later sync() can retry */
    }
  }

  private schedule(path: string, kind: 'file' | 'folder'): void {
    if (kind === 'file') {
      const wroteAt = this.selfWrites.get(path)
      if (wroteAt && Date.now() - wroteAt < SELF_WRITE_SUPPRESS_MS) return
    }
    const existing = this.debounceTimers.get(path)
    if (existing) clearTimeout(existing)
    this.debounceTimers.set(
      path,
      setTimeout(() => {
        this.debounceTimers.delete(path)
        this.onChange(path, kind)
      }, DEBOUNCE_MS)
    )
  }
}
