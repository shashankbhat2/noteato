import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { NoteRecording } from '../../shared/types'
import type { MeetingTranscript } from '../../shared/meetingTranscript'
import { MIC_FILE, SYSTEM_FILE } from './captureDir'
import { MEETING_FILE } from './transcribe'

interface Row {
  note_id: string
  capture_dir: string
  duration_seconds: number
  system_captured: number
  transcript_status: string
  created_at: string
}

/**
 * The index from a note to its recording.
 *
 * The heavy data — the audio itself, and later the transcript — stays on disk
 * in the capture directory. This table only answers "does this note have a
 * recording, and where is it".
 */
export class RecordingStore {
  constructor(private db: Database.Database) {}

  add(entry: {
    noteId: string
    captureDir: string
    durationSeconds: number
    systemCaptured: boolean
  }): void {
    this.db
      .prepare(
        `INSERT INTO recordings
           (note_id, capture_dir, duration_seconds, system_captured, transcript_status, created_at)
         VALUES (?, ?, ?, ?, 'none', ?)
         ON CONFLICT(note_id) DO UPDATE SET
           capture_dir = excluded.capture_dir,
           duration_seconds = excluded.duration_seconds,
           system_captured = excluded.system_captured,
           created_at = excluded.created_at`
      )
      .run(
        entry.noteId,
        entry.captureDir,
        entry.durationSeconds,
        entry.systemCaptured ? 1 : 0,
        new Date().toISOString()
      )
  }

  /**
   * Returns null when the note has no recording, or when the audio it points at
   * is gone — a row whose files were deleted outside Noteato would otherwise
   * enable a Transcript tab that can only fail.
   */
  get(noteId: string): NoteRecording | null {
    const row = this.db
      .prepare('SELECT * FROM recordings WHERE note_id = ?')
      .get(noteId) as Row | undefined
    if (!row) return null

    const micPath = join(row.capture_dir, MIC_FILE)
    if (!existsSync(micPath)) return null

    const systemPath = join(row.capture_dir, SYSTEM_FILE)
    return {
      noteId: row.note_id,
      captureDir: row.capture_dir,
      durationSeconds: row.duration_seconds,
      micPath,
      systemPath: existsSync(systemPath) ? systemPath : null,
      transcriptStatus: row.transcript_status as NoteRecording['transcriptStatus'],
      createdAt: row.created_at
    }
  }

  setTranscriptStatus(noteId: string, status: NoteRecording['transcriptStatus']): void {
    this.db.prepare('UPDATE recordings SET transcript_status = ? WHERE note_id = ?').run(
      status,
      noteId
    )
  }

  /**
   * The merged transcript, read from the capture directory rather than the
   * database — it is derived data the user can inspect, back up or delete along
   * with the recording it describes.
   */
  readTranscript(noteId: string): MeetingTranscript | null {
    const recording = this.get(noteId)
    if (!recording) return null
    const path = join(recording.captureDir, MEETING_FILE)
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as MeetingTranscript
    } catch {
      // A truncated or hand-edited file is a missing transcript, not a crash.
      return null
    }
  }

  remove(noteId: string): void {
    this.db.prepare('DELETE FROM recordings WHERE note_id = ?').run(noteId)
  }
}
