export interface NoteMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  tags: string[]
  fullWidth: boolean
  pinned: boolean
  /** ISO timestamp for a pending one-shot reminder, or null if none is set. */
  reminderAt: string | null
}

export interface NoteSummary extends NoteMeta {
  /** Relative POSIX path under the notes dir, e.g. "Work/projects/launch.md". */
  path: string
  /** Parent folder as a relative POSIX path ("" for the root). */
  folder: string
  excerpt: string
  /** True when the note is linked from outside the managed notes directory. */
  external?: boolean
  /**
   * For external notes: the registered opened-files entry (file or folder
   * path) this note surfaced from. Removing that entry unlinks the note.
   */
  externalRoot?: string
  /** True when the note was found by walking a linked folder (no own entry). */
  fromFolder?: boolean
}

export interface Note extends NoteSummary {
  body: string
}

// A trashed note or folder, kept so a delete can be undone.
export interface DeletedEntry {
  trashName: string
  originalPath: string
  isFolder: boolean
}

/** A trashed item as shown in the sidebar's Trash section. */
export interface TrashEntry extends DeletedEntry {
  title: string
  deletedAt: string
}

export interface NotionImportResult {
  created: NoteSummary[]
  /** Relative source paths (within the chosen export folder) that failed to import. */
  skipped: string[]
}

export interface SearchResult {
  id: string
  path: string
  title: string
  folder: string
  snippet: string
  /** The note's own tags, so a result can show what it was tagged with. */
  tags: string[]
  /** Tags on this note that the query matched, lowercased. */
  matchedTags: string[]
}

/**
 * A quick capture note stored in the app's SQLite database — the store behind
 * the quick-note window and the sidebar-mode edge window. Separate from the
 * markdown library on purpose: scratch notes never touch the notes folder.
 */
export interface ScratchNote {
  id: string
  title: string
  body: string
  pinned: boolean
  reminderAt: string | null
  createdAt: string
  updatedAt: string
  excerpt: string
}

export interface ScratchSaveOptions {
  title: string
  body: string
}

export type ScratchChange =
  | { kind: 'upsert'; note: ScratchNote }
  | { kind: 'remove'; id: string }

export type ThemeMode = 'light' | 'dark' | 'system'
export type FontChoice = 'system' | 'serif' | 'mono' | 'rounded'
export type AccentChoice = 'neutral' | 'ember' | 'ocean' | 'forest' | 'violet' | 'rose' | 'amber'
export type AiProvider = 'none' | 'anthropic' | 'openai'
export type SyncPreference = 'none' | 'icloud' | 'noteatoPro'
/** Which screen edge the compact notes panel docks to (and reveals from). */
export type ScreenEdge = 'left' | 'right'

/**
 * Where a meeting recording is in its life. `transcribing` is declared here so
 * every surface handles it from the start; nothing enters it until transcription
 * lands, because a state the app can display but never reach is still a state
 * the UI has to be right about.
 */
export type MeetingPhase = 'idle' | 'recording' | 'transcribing'

export interface MeetingState {
  phase: MeetingPhase
  /** Epoch ms the recording began, or null when idle. Elapsed time is derived
   *  from this rather than counted in the renderer, so the pill stays correct
   *  across a renderer reload and cannot drift from the actual recording. */
  startedAt: number | null
  /**
   * The note this recording belongs to. `null` means it was started from the
   * tray or the accelerator with no note in hand — the usual case, since you
   * start a meeting from inside Zoom — and it will commit to a new note.
   */
  noteId: string | null
}

/** Peak input levels, 0–1, pushed to the recording pill about ten times a second. */
export interface MeetingLevels {
  mic: number
  system: number
}

export interface MeetingError {
  code: string
  message: string
}

/** A note's recording, as the renderer needs it to play and (later) transcribe. */
export interface NoteRecording {
  noteId: string
  captureDir: string
  durationSeconds: number
  /** Absolute path to the microphone track — "me". */
  micPath: string
  /** Absolute path to the system-audio track — "them", or null if never heard. */
  systemPath: string | null
  transcriptStatus: 'none' | 'pending' | 'ready' | 'failed'
  createdAt: string
}

export interface Settings {
  onboardingCompleted: boolean
  userName: string
  licenseKey: string
  /** A future sync product the user expressed interest in during onboarding. */
  syncPreference: SyncPreference
  deepgramApiKey: string
  notesDir: string | null
  theme: ThemeMode
  fontFamily: FontChoice
  accent: AccentChoice
  aiProvider: AiProvider
  aiModel: string
  anthropicApiKey: string
  openaiApiKey: string
  aiSelectionActions: boolean
  /**
   * Seconds of microphone audio the agent keeps buffered so a capture can
   * begin before the hotkey is pressed. 0 closes the microphone entirely —
   * the setting's whole point, so it must not merely buffer and discard.
   */
  preRollSeconds: number
  /** Keep running in the menu bar after closing/quitting, so reminders can still fire. */
  keepInMenuBar: boolean
  /** Make the compact notes/reminders edge window available from the menu bar. */
  sidebarModeEnabled: boolean
  /**
   * Keep the sidebar visible on every Space and over fullscreen apps. It floats
   * above other apps either way — see SidebarModeManager.applyPinned.
   */
  sidebarPinned: boolean
  /** The screen edge the sidebar docks to. */
  sidebarEdge: ScreenEdge
  /** Reveal and focus the sidebar when the pointer rests against that edge. */
  sidebarHoverReveal: boolean
  /** How long the pointer has to rest there first, in milliseconds. */
  sidebarHoverDelay: number
  /**
   * Spellchecker language code (e.g. "en-GB"), or "auto" for the app locale.
   * Windows/Linux only — macOS always uses the system spellchecker.
   */
  spellcheckLanguage: string
}

export interface SidebarModeState {
  enabled: boolean
  pinned: boolean
  visible: boolean
}

/** Small cross-window invalidations; avoids rescanning the full notes tree on autosave. */
export type NoteChange =
  | { kind: 'upsert'; note: NoteSummary }
  | { kind: 'remove'; id: string }
  | { kind: 'refresh' }

export interface SaveOptions {
  title: string
  body: string
  tags?: string[]
  /** User-selected calendar date for the note, stored in frontmatter. */
  createdAt?: string
  fullWidth?: boolean
}

export interface AiCompleteRequest {
  system: string
  prompt: string
  maxTokens?: number
  model?: string
  provider?: Exclude<AiProvider, 'none'>
}

/**
 * The whole-note actions in the floating dock. Deliberately a closed set: AI
 * acts on a note through explicit actions with visible output, not through a
 * chat surface (revamp brief §9/§11).
 */
export type AiNoteAction = 'summarize' | 'improve' | 'extract' | 'proofread' | 'ask'
