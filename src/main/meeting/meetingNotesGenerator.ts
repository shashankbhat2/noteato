import type { Note, Settings } from '../../shared/types'
import type { MeetingTranscript } from '../../shared/meetingTranscript'
import {
  CHEAPEST_MEETING_MODELS,
  cleanMeetingNotes,
  meetingNotesRequest,
  type MeetingNotesState,
  type MeetingNotesTemplateId
} from '../../shared/meetingNotes'
import { streamAi } from '../ai'

interface Options {
  getSettings: () => Settings
  readNote: (noteId: string) => Note
  readTranscript: (noteId: string) => MeetingTranscript | null
  readSaved: (noteId: string) => string | null
  writeSaved: (noteId: string, markdown: string) => boolean
  getTemplate: (noteId: string) => MeetingNotesTemplateId
  setTemplate: (noteId: string, template: MeetingNotesTemplateId) => boolean
  needsUpdate: (noteId: string) => boolean
  emit: (state: MeetingNotesState) => void
}

interface Job {
  version: number
  timer?: ReturnType<typeof setTimeout>
  abort?: AbortController
}

const UPDATE_DEBOUNCE_MS = 2200

function providerReady(settings: Settings): settings is Settings & {
  aiProvider: 'anthropic' | 'openai'
} {
  if (settings.aiProvider === 'anthropic') return Boolean(settings.anthropicApiKey)
  if (settings.aiProvider === 'openai') return Boolean(settings.openaiApiKey)
  return false
}

/**
 * Keeps meeting-notes.md derived from the transcript plus note context.
 *
 * Completed recording transcripts and explicit template/retry actions schedule
 * work. Ordinary note/transcript edits do not. The model stream is broadcast
 * for the third tab, but only a complete current response is committed.
 */
export class MeetingNotesGenerator {
  private jobs = new Map<string, Job>()
  private states = new Map<string, MeetingNotesState>()

  constructor(private options: Options) {}

  getState(noteId: string): MeetingNotesState {
    const template = this.options.getTemplate(noteId)
    const live = this.states.get(noteId)
    if (live?.status === 'generating') return live

    const saved = this.options.readSaved(noteId)
    if (saved) return { noteId, template, status: 'ready', content: saved }

    const settings = this.options.getSettings()
    if (this.options.readTranscript(noteId) && !providerReady(settings)) {
      return { noteId, template, status: 'unconfigured', content: '' }
    }
    return live ?? { noteId, template, status: 'waiting', content: '' }
  }

  /** Generate on demand only when a transcript exists but the file does not. */
  ensure(noteId: string): MeetingNotesState {
    try {
      this.options.readNote(noteId)
      if (this.options.needsUpdate(noteId)) this.schedule(noteId, 0)
    } catch {
      /* The note or recording disappeared while its pane was opening. */
    }
    return this.getState(noteId)
  }

  schedule(noteId: string, delayMs = UPDATE_DEBOUNCE_MS): void {
    if (!this.options.readTranscript(noteId)) return

    const previous = this.jobs.get(noteId)
    if (previous?.timer) clearTimeout(previous.timer)
    previous?.abort?.abort()

    const version = (previous?.version ?? 0) + 1
    const job: Job = { version }
    job.timer = setTimeout(() => {
      job.timer = undefined
      void this.generate(noteId, version)
    }, delayMs)
    this.jobs.set(noteId, job)
  }

  retry(noteId: string): void {
    this.schedule(noteId, 0)
  }

  saveManual(noteId: string, markdown: string): boolean {
    return this.options.writeSaved(noteId, cleanMeetingNotes(markdown))
  }

  selectTemplate(noteId: string, template: MeetingNotesTemplateId): MeetingNotesState {
    if (!this.options.setTemplate(noteId, template)) return this.getState(noteId)
    this.schedule(noteId, 0)
    return { ...this.getState(noteId), template }
  }

  /** Resume only notes that already asked for synthesis; never fan out across a vault. */
  resumeConfigured(): void {
    for (const [noteId, state] of this.states) {
      if (state.status === 'unconfigured') this.schedule(noteId, 0)
    }
  }

  destroy(): void {
    for (const job of this.jobs.values()) {
      if (job.timer) clearTimeout(job.timer)
      job.abort?.abort()
    }
    this.jobs.clear()
  }

  private async generate(noteId: string, version: number): Promise<void> {
    const job = this.jobs.get(noteId)
    if (!job || job.version !== version) return

    const settings = this.options.getSettings()
    const template = this.options.getTemplate(noteId)
    if (!providerReady(settings)) {
      const state: MeetingNotesState = { noteId, template, status: 'unconfigured', content: '' }
      this.states.set(noteId, state)
      this.options.emit(state)
      this.jobs.delete(noteId)
      return
    }

    let note: Note
    let transcript: MeetingTranscript | null
    try {
      note = this.options.readNote(noteId)
      transcript = this.options.readTranscript(noteId)
    } catch {
      this.jobs.delete(noteId)
      return
    }
    if (!transcript) {
      this.jobs.delete(noteId)
      return
    }

    const abort = new AbortController()
    job.abort = abort
    const state: MeetingNotesState = { noteId, template, status: 'generating', content: '' }
    this.states.set(noteId, state)
    this.options.emit(state)

    const request = meetingNotesRequest(
      note.title,
      note.body,
      transcript,
      template,
      this.options.readSaved(noteId) ?? ''
    )
    try {
      const result = await streamAi(
        settings,
        {
          ...request,
          provider: settings.aiProvider,
          model: CHEAPEST_MEETING_MODELS[settings.aiProvider],
          maxTokens: 4096
        },
        (delta) => {
          const current = this.jobs.get(noteId)
          if (abort.signal.aborted || current?.version !== version) return
          state.content += delta
          this.options.emit({ ...state })
        },
        abort.signal
      )

      const current = this.jobs.get(noteId)
      if (abort.signal.aborted || current?.version !== version) return
      const markdown = cleanMeetingNotes(result)
      if (!markdown.trim()) throw new Error('The AI provider returned empty meeting notes.')
      if (!this.options.writeSaved(noteId, markdown)) return

      const ready: MeetingNotesState = { noteId, template, status: 'ready', content: markdown }
      this.states.set(noteId, ready)
      this.options.emit(ready)
    } catch (error) {
      if (abort.signal.aborted) return
      const failed: MeetingNotesState = {
        noteId,
        template,
        status: 'failed',
        content: this.options.readSaved(noteId) ?? '',
        error: error instanceof Error ? error.message : String(error)
      }
      this.states.set(noteId, failed)
      this.options.emit(failed)
    } finally {
      if (this.jobs.get(noteId)?.version === version) this.jobs.delete(noteId)
    }
  }
}
