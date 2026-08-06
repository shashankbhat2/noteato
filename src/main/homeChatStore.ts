import type Database from 'better-sqlite3'
import type { HomeChatThread, HomeChatThreadSummary } from '../shared/homeChat'
import { SqlKvStore } from './db'

interface HomeChatState {
  threads: HomeChatThread[]
}

const MAX_THREADS = 50

export class HomeChatStore {
  private store: SqlKvStore<HomeChatState>

  constructor(db: Database.Database) {
    this.store = new SqlKvStore(db, 'home-chat-history', { threads: [] })
  }

  list(): HomeChatThreadSummary[] {
    return this.store
      .read()
      .threads.map(({ messages, ...thread }) => ({
        ...thread,
        preview: messages.at(-1)?.content.replace(/\s+/g, ' ').trim().slice(0, 120) ?? ''
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  read(id: string): HomeChatThread | null {
    return this.store.read().threads.find((thread) => thread.id === id) ?? null
  }

  save(thread: HomeChatThread): HomeChatThread {
    const current = this.store.read().threads.filter((item) => item.id !== thread.id)
    this.store.write({
      threads: [thread, ...current]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, MAX_THREADS)
    })
    return thread
  }

  delete(id: string): boolean {
    const current = this.store.read().threads
    const threads = current.filter((thread) => thread.id !== id)
    if (threads.length === current.length) return false
    this.store.write({ threads })
    return true
  }
}
