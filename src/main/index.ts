import { basename, join } from 'path'
import { existsSync, linkSync, renameSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import {
  app,
  BrowserWindow,
  Menu,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  net,
  protocol,
  session,
  shell
} from 'electron'
import type {
  AiCompleteRequest,
  Note,
  NoteChange,
  SaveOptions,
  ScratchChange,
  ScratchNote,
  ScratchSaveOptions,
  Settings,
  SettingsTab
} from '../shared/types'
import { getAppDb } from './db'
import { NoteStore } from './storage'
import { ScratchStore } from './scratchStore'
import { ExternalWatcher } from './fileWatcher'
import { createSettingsStore } from './settings'
import { buildAppMenu } from './menu'
import { createWindowStateStore, trackWindowState } from './windowState'
import { completeAi, streamAi } from './ai'
import { ReminderScheduler } from './reminders'
import { importNotionExport } from './notionImport'
import { TrayManager } from './tray'
import { SidebarModeManager } from './sidebarMode'
import { EdgeHoverWatcher } from './edgeHover'
import { GlobalShortcutManager } from './globalShortcuts'
import { removeStaleAgent } from './staleAgent'
import { MeetingRecorder } from './meeting/recorder'
import { RecordingStore } from './meeting/recordingStore'
import { transcribeCapture } from './meeting/transcribe'
import { MeetingNotesGenerator } from './meeting/meetingNotesGenerator'
import { appendMeetingAudio } from './meeting/audioProcess'
import {
  AUDIO_FILE,
  capturePaths,
  createCaptureDir,
  removeCaptureDir,
  removeCaptureInputs
} from './meeting/captureDir'
import { appendMeetingTranscript } from '../shared/meetingTranscript'
import type { MeetingNotesTemplateId } from '../shared/meetingNotes'
import { SherpaServer } from './asr/sherpaServer'
import { ensureModel, getModelStatus, isModelInstalled, onModelStatus } from './asr/model'
import { RecorderWindow } from './recorderWindow'
import { TemplateStore } from './templateStore'
import { HomeChatStore } from './homeChatStore'
import { linkLocalImage, resolveLocalImage } from './localImages'
import {
  parseRecordingMediaUrl,
  RECORDING_MEDIA_SCHEME
} from '../shared/recordingMedia'

// Audio/video elements need the stream privilege to issue range requests.
// This must run before Electron becomes ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: RECORDING_MEDIA_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

const appDb = getAppDb()
const settingsStore = createSettingsStore()
const noteStore = new NoteStore(appDb, settingsStore.read().notesDir ?? undefined)
const scratchStore = new ScratchStore(appDb)
const templateStore = new TemplateStore(noteStore, () => noteStore.getNotesDir())
const homeChatStore = new HomeChatStore(appDb)
// Linked external files/folders reload live: any on-disk change lands as an
// upsert (single file) or refresh (folder) in every window.
const externalWatcher = new ExternalWatcher((rootPath, kind) => {
  if (kind === 'folder') {
    broadcastNoteChange({ kind: 'refresh' })
    return
  }
  try {
    broadcastNoteChange({ kind: 'upsert', note: noteStore.readByPath(rootPath) })
  } catch {
    broadcastNoteChange({ kind: 'refresh' })
  }
})
const windowStateStore = createWindowStateStore(appDb)
const sidebarModeManager = new SidebarModeManager(appDb, () => settingsStore.read())
const reminderScheduler = new ReminderScheduler(
  noteStore,
  scratchStore,
  () => mainWindow,
  (note) => openScratchNote(note),
  (change) => broadcastScratchChange(change)
)
const recorderWindow = new RecorderWindow(appDb)
const recordingStore = new RecordingStore(appDb)
const sherpaServer = new SherpaServer()
const meetingNotesGenerator = new MeetingNotesGenerator({
  getSettings: () => settingsStore.read(),
  readNote: (noteId) => noteStore.read(noteId),
  readTranscript: (noteId) => recordingStore.readTranscript(noteId),
  readSaved: (noteId) => recordingStore.readMeetingNotes(noteId),
  writeSaved: (noteId, markdown) => recordingStore.writeMeetingNotes(noteId, markdown),
  getTemplate: (noteId) => recordingStore.readMeetingNotesTemplate(noteId),
  setTemplate: (noteId, template) =>
    recordingStore.writeMeetingNotesTemplate(noteId, template),
  needsUpdate: (noteId) => recordingStore.meetingNotesNeedUpdate(noteId),
  emit: (state) => broadcastMeeting('meeting:notes-state', state)
})
const meetingTitle = (startedAt: number): string =>
  `Meeting — ${new Date(startedAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })}`
const meetingRecorder = new MeetingRecorder({
  getVault: () => noteStore.getNotesDir(),
  onStateChange: (state) => {
    trayManager.refresh()
    if (state.phase === 'idle') recorderWindow.hide()
    else recorderWindow.show(state)
    // One broadcast drives every surface, so the tray, the pill and the note's
    // own button cannot disagree about whether a recording is running.
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('meeting:state-changed', state)
    }
  },
  onLevels: (levels) => recorderWindow.sendLevels(levels),
  onError: (error) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('meeting:error', error)
    }
    if (error.code === 'screen_recording_denied') explainScreenRecording()
    if (error.code === 'microphone_denied') explainMicrophone()
  },
  onCommitted: async (recording) => {
    // Untargeted callers normally prepare note.md before capture begins. Keep
    // this fallback for old callers and interrupted upgrades: the note still
    // belongs inside the capture folder beside its audio.
    let noteId = recording.noteId
    if (!noteId) {
      noteId = noteStore.createCaptureNote(
        basename(recording.dir),
        meetingTitle(recording.startedAt)
      ).id
    }

    // A second capture for the same note is staged in its own folder. Nothing
    // points at it until its audio and transcript have both been appended, so
    // a failed repeat recording cannot overwrite the meeting already on disk.
    const existing = recordingStore.get(noteId)
    const existingTranscript = existing ? recordingStore.readTranscript(noteId) : null
    if (!existing) {
      // Whether capture began from New meeting or an ordinary note, its first
      // completed recording turns it into one self-contained folder artifact.
      noteStore.moveIntoCapture(noteId, recording.dir)
      recordingStore.add({
        noteId,
        captureDir: recording.dir,
        durationSeconds: recording.seconds,
        systemCaptured: recording.systemCaptured
      })
      reminderScheduler.rebuildAll()
      broadcastNoteChange({ kind: 'refresh' })
      broadcastMeeting('meeting:recorded', noteId)
    }

    // Transcription runs while the session is still in `transcribing`, so the
    // pill keeps reporting work that is genuinely still happening.
    recordingStore.setTranscriptStatus(noteId, 'pending')
    broadcastMeeting('meeting:transcript-changed', noteId)
    try {
      const addition = await transcribeCapture(sherpaServer, recording.dir)

      if (existing) {
        const baseTranscript = existingTranscript ?? {
          version: addition.version,
          engine: addition.engine,
          durationSeconds: existing.durationSeconds,
          segments: []
        }
        const appendedTranscript = {
          ...appendMeetingTranscript(baseTranscript, addition, existing.durationSeconds),
          durationSeconds: existing.durationSeconds + recording.seconds
        }
        const additionAudio = join(recording.dir, AUDIO_FILE)
        const appendedAudio = join(existing.captureDir, '.audio-appending.m4a')
        const audioBackup = join(existing.captureDir, '.audio-before-append.m4a')

        rmSync(appendedAudio, { force: true })
        rmSync(audioBackup, { force: true })
        await appendMeetingAudio(existing.micPath, additionAudio, appendedAudio)

        // A hard link is an instant, zero-copy rollback point. The final audio
        // rename is atomic; if a later transcript/DB write fails, restore the
        // old inode and leave the staged capture available for recovery.
        try {
          linkSync(existing.micPath, audioBackup)
          renameSync(appendedAudio, existing.micPath)
          if (!recordingStore.writeTranscript(noteId, appendedTranscript)) {
            throw new Error('could not save the appended transcript')
          }
          recordingStore.updateAfterAppend(
            noteId,
            appendedTranscript.durationSeconds,
            recording.systemCaptured
          )
          rmSync(audioBackup, { force: true })
          removeCaptureDir(recording.dir)
        } catch (error) {
          if (existsSync(audioBackup)) renameSync(audioBackup, existing.micPath)
          if (existingTranscript) recordingStore.writeTranscript(noteId, existingTranscript)
          else recordingStore.removeTranscript(noteId)
          throw error
        } finally {
          rmSync(appendedAudio, { force: true })
          rmSync(audioBackup, { force: true })
        }
        broadcastMeeting('meeting:recorded', noteId)
      } else {
        recordingStore.setTranscriptStatus(noteId, 'ready')
      }

      // Give any final block edit in the open meeting-notes tab time to save;
      // the generator reads that document back as the draft it must preserve.
      meetingNotesGenerator.schedule(noteId)
    } catch (error) {
      recordingStore.setTranscriptStatus(noteId, existingTranscript ? 'ready' : 'failed')
      // Rethrown so the recorder reports it; the audio is safe either way, and
      // a failed transcript is worth saying out loud rather than swallowing.
      throw error
    } finally {
      // The separate channels exist only to retain Me/Them attribution during
      // transcription. Once that work finishes, the folder exposes one audio
      // file regardless of whether transcription succeeded.
      removeCaptureInputs(recording.dir)
      broadcastMeeting('meeting:transcript-changed', noteId)
    }
  }
})

function broadcastMeeting(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}

// Every window gets the model's status: the onboarding card, Settings and any
// later surface all show one download, so they must not each track their own.
onModelStatus((status) => broadcastMeeting('asr:status', status))

/**
 * Start the download without making the caller wait for 680 MB. Rejection is
 * swallowed on purpose — the failure is already reported through the status
 * stream, which is what every caller here actually watches.
 */
function startModelDownload(): void {
  void ensureModel().catch(() => {})
}

/**
 * The one gate for meeting notes, checked here rather than at each button so
 * the tray, the accelerator, the sidebar and both in-app buttons cannot drift
 * apart. Returns true when the caller should stop and let Settings take over.
 *
 * Only start transitions consult it. Stopping and discarding must always work,
 * or a recording begun before the switch was flipped could never be ended.
 */
function meetingGateClosed(): boolean {
  if (settingsStore.read().meetingNotesEnabled) return false
  openMainSettings('speech')
  return true
}

/** Create/open the self-contained meeting note before capture starts. */
function startNewMeeting(templateId?: string): Note | null {
  if (meetingRecorder.getState().phase !== 'idle') return null
  if (meetingGateClosed()) return null

  const startedAt = new Date()
  const capture = createCaptureDir(noteStore.getNotesDir(), startedAt)
  let note: Note
  try {
    const template = templateId ? templateStore.materialize(templateId, startedAt) : null
    note = noteStore.createCaptureNote(
      basename(capture.dir),
      template?.title ?? meetingTitle(startedAt.getTime())
    )
    if (template) {
      note = noteStore.save(note.id, { title: template.title, body: template.body })
    }
  } catch (error) {
    removeCaptureDir(capture.dir)
    throw error
  }

  // Even if the native helper reports a synchronous startup error, retain and
  // open the note the user explicitly created. The recorder removes any
  // partial audio without deleting note.md.
  meetingRecorder.start(note.id, capture)
  broadcastNoteChange({ kind: 'upsert', note })
  return note
}

/**
 * Start from an open note. A new folder-backed note can record in place; a
 * note that already owns audio must use the recorder's fresh staging folder so
 * the old audio remains untouched until append and transcription both finish.
 */
function startMeetingForNote(noteId: string): boolean {
  const noteDirectory = recordingStore.get(noteId) ? null : noteStore.bundledDirectory(noteId)
  return meetingRecorder.start(
    noteId,
    noteDirectory ? capturePaths(noteDirectory) : undefined
  )
}

function toggleUntargetedMeeting(): void {
  const state = meetingRecorder.getState()
  if (state.phase === 'idle') startNewMeeting()
  else if (state.phase === 'recording') meetingRecorder.stop()
}

const globalShortcutManager = new GlobalShortcutManager(
  () => sidebarModeManager.toggle(),
  () => toggleUntargetedMeeting()
)

/**
 * The helper presents the native request on first use. Once access has already
 * been denied, the only way to change it is Settings, and macOS requires a full
 * relaunch after the toggle is flipped.
 */
let screenRecordingGuidanceShown = false
let microphoneGuidanceShown = false

function explainScreenRecording(): void {
  // A denied permission now falls back to microphone-only recording. Explain
  // how to enable system audio once, but never trap the user in a modal loop.
  if (screenRecordingGuidanceShown) return
  screenRecordingGuidanceShown = true
  void dialog
    .showMessageBox({
      type: 'info',
      message: 'Recording microphone only',
      detail:
        'Noteato will keep this recording, but it cannot include your Mac’s audio ' +
        'until Screen Recording access is enabled.\n\n' +
        'Enable Noteato under Privacy & Security → Screen & System Audio Recording, ' +
        'then quit and reopen Noteato. This message will not be shown again during ' +
        'the current app session.',
      buttons: ['Open Settings', 'Later'],
      defaultId: 0,
      cancelId: 1
    })
    .then(({ response }) => {
      if (response === 0) {
        void shell.openExternal(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
        )
      }
    })
}

function explainMicrophone(): void {
  if (microphoneGuidanceShown) return
  microphoneGuidanceShown = true
  void dialog
    .showMessageBox({
      type: 'info',
      message: 'Noteato needs microphone access',
      detail:
        'Enable Noteato under Privacy & Security → Microphone, then try the recording again. ' +
        'This message will not be shown again during the current app session.',
      buttons: ['Open Settings', 'Later'],
      defaultId: 0,
      cancelId: 1
    })
    .then(({ response }) => {
      if (response === 0) {
        void shell.openExternal(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
        )
      }
    })
}

const edgeHoverWatcher = new EdgeHoverWatcher(
  () => {
    const settings = runtimeSettings()
    return {
      enabled: settings.sidebarModeEnabled && settings.sidebarHoverReveal,
      edge: settings.sidebarEdge,
      delayMs: settings.sidebarHoverDelay
    }
  },
  () => sidebarModeManager.isVisible(),
  () => sidebarModeManager.show()
)

function runtimeSettings(settings: Settings = settingsStore.read()): Settings {
  if (settings.onboardingCompleted) return settings
  return { ...settings, keepInMenuBar: false, sidebarModeEnabled: false }
}
// The tray's own "Quit Noteato" sets this before calling app.quit(), so the
// before-quit handler below knows to let that one through.
let allowQuit = false
const trayManager = new TrayManager(
  () => showMainWindow(),
  () => sidebarModeManager.show(),
  () => runtimeSettings().sidebarModeEnabled,
  () => {
    allowQuit = true
    edgeHoverWatcher.stop()
    sidebarModeManager.destroy()
    recorderWindow.destroy()
  },
  () => meetingRecorder.isRecording(),
  () => toggleUntargetedMeeting()
)

/**
 * Electron owns the one visible Noteato menu-bar icon. This used to negotiate
 * with the native agent for it; that helper is gone, so the tray now follows
 * settings alone.
 */
function syncTray(): void {
  trayManager.setEnabled(shouldKeepRunning())
}

function shouldKeepRunning(): boolean {
  const settings = runtimeSettings()
  return settings.keepInMenuBar || settings.sidebarModeEnabled
}

// Cmd+Q / Dock "Quit" / the app-menu Quit role all call app.quit(), which
// fires this before any window closes. With keepInMenuBar on, treat that as
// "hide to the tray" instead of a real quit — reminder timers live in this
// process regardless of whether any window is open, so keeping the process
// alive is what actually keeps them firing.
app.on('before-quit', (event) => {
  if (allowQuit) {
    sidebarModeManager.destroy()
    return
  }
  if (shouldKeepRunning()) {
    event.preventDefault()
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
  }
})

// Chromium's Hunspell spellchecker takes a language list on Windows/Linux;
// macOS always uses the native system spellchecker (this is a no-op there).
function applySpellcheckLanguage(language: string): void {
  if (process.platform === 'darwin') return
  const ses = session.defaultSession
  try {
    ses.setSpellCheckerLanguages([language === 'auto' ? app.getLocale() : language])
  } catch {
    /* unknown language code — keep the current dictionary */
  }
}

function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const { protocol } = new URL(rawUrl)
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:'
  } catch {
    return false
  }
}

/* Matches --sidebar-bg, the window chrome the app shell paints, so the frame
   the OS shows before the renderer boots is the same colour it lands on. */
const DARK_BG = '#1a1a1a'
const LIGHT_BG = '#ededed'
// Below 400px the compact title-bar controls and the note toolbar begin to
// compete for the same horizontal space. Keep the native window from entering
// that unusable range instead of relying on individual views to clip it.
const MIN_WIDTH = 400
const MIN_HEIGHT = 250
/**
 * First run shows the setup card and nothing else — an empty app window behind
 * it would be showing a workspace the user has not finished setting up. The
 * window is grown to the real thing once onboarding is done.
 */
const ONBOARDING_WIDTH = 480
const ONBOARDING_HEIGHT = 700

let mainWindow: BrowserWindow | null = null

function broadcastNoteChange(change: NoteChange, exceptWebContentsId?: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents.id !== exceptWebContentsId) {
      win.webContents.send('notes:changed', change)
    }
  }
}

function broadcastScratchChange(change: ScratchChange, exceptWebContentsId?: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents.id !== exceptWebContentsId) {
      win.webContents.send('scratch:changed', change)
    }
  }
}

// Clicking a scratch-note reminder notification opens the sidebar-mode window
// on that note (the sidebar is the only surface scratch notes live on). No-op
// if sidebar mode is disabled in settings.
function openScratchNote(note: ScratchNote): void {
  sidebarModeManager.show()
  const win = sidebarModeManager.getWindow()
  if (!win || win.isDestroyed()) return
  const send = (): void => win.webContents.send('scratch:open', note.id)
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
  else send()
}

// While the app lives only in the menu bar (keepInMenuBar on, no visible
// windows), drop the Dock icon and its running dot — the same behavior as
// menu-bar apps like Docker Desktop. Any window becoming visible brings the
// Dock icon back (see browser-window-created below).
function hideDockIfBackgrounded(): void {
  if (process.platform !== 'darwin') return
  const sidebarWindow = sidebarModeManager.getWindow()
  const anyVisibleRegularWindow = BrowserWindow.getAllWindows().some(
    (w) => w !== sidebarWindow && !w.isDestroyed() && w.isVisible()
  )
  if (!anyVisibleRegularWindow && shouldKeepRunning() && app.dock.isVisible()) {
    app.dock.hide()
  }
}

// --- Markdown files opened via the OS (Finder "Open With", double-click) ----
// macOS delivers these through 'open-file' (possibly before the app is ready);
// Windows/Linux pass them on argv. Each file is linked in place, then
// handed to the renderer — queued until it announces readiness.
const pendingExternalNotes: Note[] = []
let rendererReady = false

function openExternalMarkdown(filePath: string): void {
  if (!/\.(md|markdown)$/i.test(filePath)) return
  let note: Note
  try {
    note = noteStore.openExternal(filePath)
  } catch {
    return
  }
  externalWatcher.sync(noteStore.listOpenedRoots())
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('notes:external-open', note)
    mainWindow.show()
  } else {
    pendingExternalNotes.push(note)
  }
}

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (app.isReady()) {
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
    openExternalMarkdown(filePath)
  } else {
    // Imported once the store is safe to use, right after ready.
    app.whenReady().then(() => openExternalMarkdown(filePath))
  }
})

function createMainWindow(): void {
  // themeSource is set to the saved mode (incl. 'system') at startup, so
  // shouldUseDarkColors reflects the resolved appearance.
  const isDark = nativeTheme.shouldUseDarkColors
  const state = windowStateStore.read()
  const onboarding = !settingsStore.read().onboardingCompleted
  const win = new BrowserWindow({
    width: onboarding ? ONBOARDING_WIDTH : Math.max(state.width, MIN_WIDTH),
    height: onboarding ? ONBOARDING_HEIGHT : Math.max(state.height, MIN_HEIGHT),
    // Centred rather than restored: a card has no earlier position to return to.
    x: onboarding ? undefined : state.x,
    y: onboarding ? undefined : state.y,
    minWidth: onboarding ? ONBOARDING_WIDTH : MIN_WIDTH,
    minHeight: onboarding ? ONBOARDING_HEIGHT : MIN_HEIGHT,
    resizable: !onboarding,
    maximizable: !onboarding,
    fullscreenable: !onboarding,
    show: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 13, y: 13 },
    backgroundColor: isDark ? DARK_BG : LIGHT_BG,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
      rendererReady = false
    }
  })
  // With "keep in menu bar" on, the traffic-light close / Cmd+W-with-no-tabs
  // hides the window instead of destroying it — reminder timers already run
  // regardless of whether a window exists, but keeping it around (rather than
  // fully destroyed) means a fired reminder's notification can still open it.
  // allowQuit distinguishes this from a window closing as part of a real quit
  // the tray itself initiated (see the before-quit handler above).
  win.on('close', (event) => {
    if (!allowQuit && shouldKeepRunning()) {
      event.preventDefault()
      win.hide()
    }
  })

  // Not while onboarding: the card's fixed bounds are not a workspace layout
  // and must not overwrite the size the app will open at.
  if (!onboarding) trackWindowState(win, windowStateStore)

  win.on('ready-to-show', () => {
    if (state.isMaximized && !onboarding) win.maximize()
    win.show()
  })
  win.webContents.setWindowOpenHandler((details) => {
    if (isSafeExternalUrl(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Right-clicks are handled by the renderer (custom menus), but only the main
  // process sees the spellchecker's suggestions — forward what it needs.
  win.webContents.on('context-menu', (_event, params) => {
    win.webContents.send('app:context-menu', {
      x: params.x,
      y: params.y,
      misspelledWord: params.misspelledWord,
      dictionarySuggestions: params.dictionarySuggestions,
      selectionText: params.selectionText,
      isEditable: params.isEditable,
      editFlags: {
        canCut: params.editFlags.canCut,
        canCopy: params.editFlags.canCopy,
        canPaste: params.editFlags.canPaste
      }
    })
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.show()
  mainWindow.focus()
}

/**
 * Grow the setup card into the app proper. The renderer swaps its own contents;
 * this gives that content somewhere to live and hands back the resizing,
 * maximizing and bounds-tracking that the card had switched off.
 */
function leaveOnboardingChrome(): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return

  const state = windowStateStore.read()
  win.setResizable(true)
  win.setMaximizable(true)
  win.setFullScreenable(true)
  win.setMinimumSize(MIN_WIDTH, MIN_HEIGHT)
  win.setSize(Math.max(state.width, MIN_WIDTH), Math.max(state.height, MIN_HEIGHT), true)
  win.center()
  trackWindowState(win, windowStateStore)
}

function openMainSettings(tab?: SettingsTab): void {
  showMainWindow()
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  const send = (): void => win.webContents.send('shortcut', 'open-settings', tab)
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
  else send()
}

function registerIpcHandlers(): void {
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('images:chooseLocal', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [
        {
          name: 'Images',
          extensions: [
            'avif',
            'bmp',
            'gif',
            'heic',
            'heif',
            'ico',
            'jpeg',
            'jpg',
            'png',
            'svg',
            'tif',
            'tiff',
            'webp'
          ]
        }
      ]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return linkLocalImage(result.filePaths[0])
  })
  ipcMain.handle('images:resolveLocal', (_e, fileUrl: string) => resolveLocalImage(fileUrl))
  ipcMain.handle('notes:list', () => noteStore.list())
  ipcMain.handle('notes:read', (_e, id: string) => noteStore.read(id))
  ipcMain.handle('notes:create', (e, title?: string) => {
    const created = noteStore.create(title)
    broadcastNoteChange({ kind: 'upsert', note: created }, e.sender.id)
    return created
  })
  ipcMain.handle('notes:save', (e, id: string, options: SaveOptions) => {
    // An external save writes the watched file itself — flag it so the change
    // doesn't echo back as an "edited outside Noteato" reload.
    const notePath = noteStore.resolvePath(id)
    if (notePath.startsWith('/')) externalWatcher.markSelfWrite(notePath)
    const saved = noteStore.save(id, options)
    reminderScheduler.reschedule(saved)
    broadcastNoteChange({ kind: 'upsert', note: saved }, e.sender.id)
    return saved
  })
  ipcMain.handle('notes:setPinned', (e, id: string, pinned: boolean) => {
    const result = noteStore.setPinned(id, pinned)
    if (result) broadcastNoteChange({ kind: 'upsert', note: result }, e.sender.id)
    return result
  })
  ipcMain.handle('notes:setReminder', (e, id: string, reminderAt: string | null) => {
    const result = noteStore.setReminder(id, reminderAt)
    if (result) {
      reminderScheduler.reschedule(result)
      broadcastNoteChange({ kind: 'upsert', note: result }, e.sender.id)
    }
    return result
  })
  ipcMain.handle('notes:delete', (e, id: string) => {
    const result = noteStore.delete(id)
    reminderScheduler.unschedule(id)
    broadcastNoteChange({ kind: 'remove', id }, e.sender.id)
    return result
  })
  ipcMain.handle('notes:removeLinkedFolder', (e, rootPath: string) => {
    const result = noteStore.removeLinkedFolder(rootPath)
    externalWatcher.sync(noteStore.listOpenedRoots())
    reminderScheduler.rebuildAll()
    // Unlinking a folder removes many notes at once — easier to rescan.
    broadcastNoteChange({ kind: 'refresh' }, e.sender.id)
    return result
  })
  ipcMain.handle('notes:removeExternal', (e, id: string) => {
    const result = noteStore.removeExternal(id)
    externalWatcher.sync(noteStore.listOpenedRoots())
    reminderScheduler.unschedule(id)
    broadcastNoteChange({ kind: 'remove', id }, e.sender.id)
    return result
  })
  ipcMain.handle('notes:restore', (e, trashName: string, originalPath: string, isFolder: boolean) => {
    const restored = noteStore.restore(trashName, originalPath, isFolder)
    if (restored) {
      reminderScheduler.reschedule(restored)
      broadcastNoteChange({ kind: 'upsert', note: restored }, e.sender.id)
    } else {
      reminderScheduler.rebuildAll()
      broadcastNoteChange({ kind: 'refresh' }, e.sender.id)
    }
    return restored
  })
  ipcMain.handle('notes:search', (_e, query: string) => noteStore.search(query))
  ipcMain.handle('notes:getDir', () => noteStore.getNotesDir())
  ipcMain.handle('notes:copyPath', (_e, id: string) => {
    const full = noteStore.absolutePath(id)
    clipboard.writeText(full)
    return full
  })
  ipcMain.handle('notes:revealInFinder', (_e, id: string) => {
    shell.showItemInFolder(noteStore.absolutePath(id))
  })
  ipcMain.handle('notes:listTrash', () => noteStore.listTrash())
  ipcMain.handle('notes:purgeTrash', (_e, trashName: string) => noteStore.purgeTrash(trashName))
  ipcMain.handle('notes:emptyTrash', () => noteStore.emptyTrash())

  ipcMain.handle('notes:chooseFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: noteStore.getNotesDir()
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null

    const newDir = result.filePaths[0]
    noteStore.setNotesDir(newDir)
    settingsStore.write({ ...settingsStore.read(), notesDir: newDir })
    reminderScheduler.rebuildAll()
    broadcastNoteChange({ kind: 'refresh' }, e.sender.id)
    return newDir
  })

  ipcMain.handle('notes:import', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled) return []

    const opened = result.filePaths.map((filePath) => noteStore.openExternal(filePath))
    externalWatcher.sync(noteStore.listOpenedRoots())
    for (const note of opened) broadcastNoteChange({ kind: 'upsert', note }, e.sender.id)
    return opened
  })

  ipcMain.handle('notes:openFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return []

    const opened = noteStore.openExternalFolder(result.filePaths[0])
    externalWatcher.sync(noteStore.listOpenedRoots())
    broadcastNoteChange({ kind: 'refresh' }, e.sender.id)
    return opened
  })

  ipcMain.handle('notes:importNotion', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    const imported = importNotionExport(noteStore, result.filePaths[0])
    broadcastNoteChange({ kind: 'refresh' }, e.sender.id)
    return imported
  })

  ipcMain.handle('notes:takeExternalOpens', () => {
    rendererReady = true
    return pendingExternalNotes.splice(0)
  })

  ipcMain.handle('templates:list', () => templateStore.list())
  ipcMain.handle('templates:create', (_e, draft) => templateStore.create(draft))
  ipcMain.handle('templates:delete', (_e, id: string) => templateStore.delete(id))
  ipcMain.handle('templates:createNote', (e, id: string) => {
    const note = templateStore.instantiate(id)
    reminderScheduler.reschedule(note)
    broadcastNoteChange({ kind: 'upsert', note }, e.sender.id)
    return note
  })
  ipcMain.handle('templates:createMeeting', (_e, id: string) => startNewMeeting(id))

  ipcMain.handle('homeChat:list', () => homeChatStore.list())
  ipcMain.handle('homeChat:read', (_e, id: string) => homeChatStore.read(id))
  ipcMain.handle('homeChat:save', (_e, thread) => homeChatStore.save(thread))
  ipcMain.handle('homeChat:delete', (_e, id: string) => homeChatStore.delete(id))

  ipcMain.handle('reminders:takeFired', () => reminderScheduler.markReady())

  // --- Scratch notes (SQLite-backed; quick note + sidebar mode) -------------
  ipcMain.handle('scratch:list', () => scratchStore.list())
  ipcMain.handle('scratch:read', (_e, id: string) => scratchStore.read(id))
  ipcMain.handle('scratch:create', (e) => {
    const created = scratchStore.create()
    broadcastScratchChange({ kind: 'upsert', note: created }, e.sender.id)
    return created
  })
  ipcMain.handle('scratch:save', (e, id: string, options: ScratchSaveOptions) => {
    const saved = scratchStore.save(id, options)
    if (saved) broadcastScratchChange({ kind: 'upsert', note: saved }, e.sender.id)
    return saved
  })
  ipcMain.handle('scratch:delete', (e, id: string) => {
    const removed = scratchStore.delete(id)
    if (removed) {
      reminderScheduler.unschedule(id)
      broadcastScratchChange({ kind: 'remove', id }, e.sender.id)
    }
    return removed
  })
  ipcMain.handle('scratch:setPinned', (e, id: string, pinned: boolean) => {
    const updated = scratchStore.setPinned(id, pinned)
    if (updated) broadcastScratchChange({ kind: 'upsert', note: updated }, e.sender.id)
    return updated
  })
  ipcMain.handle('scratch:setReminder', (e, id: string, reminderAt: string | null) => {
    const updated = scratchStore.setReminder(id, reminderAt)
    if (updated) {
      reminderScheduler.rescheduleScratch(updated)
      broadcastScratchChange({ kind: 'upsert', note: updated }, e.sender.id)
    }
    return updated
  })

  ipcMain.handle('settings:get', () => settingsStore.read())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const next = { ...settingsStore.read(), ...patch }
    settingsStore.write(next)
    const runtime = runtimeSettings(next)
    if (patch.theme) nativeTheme.themeSource = patch.theme
    if ('spellcheckLanguage' in patch) applySpellcheckLanguage(next.spellcheckLanguage)
    // Enabling meetings is a promise the feature will work, and it cannot
    // until the model is here. Start it now rather than at the end of the
    // user's first recording, where the wait has nowhere to be shown.
    if (patch.meetingNotesEnabled && !isModelInstalled()) startModelDownload()
    if (patch.onboardingCompleted) leaveOnboardingChrome()
    if (
      'aiProvider' in patch ||
      'anthropicApiKey' in patch ||
      'openaiApiKey' in patch ||
      'xaiApiKey' in patch
    ) {
      meetingNotesGenerator.resumeConfigured()
    }
    if ('sidebarModeEnabled' in patch || 'onboardingCompleted' in patch) {
      sidebarModeManager.setEnabled(runtime.sidebarModeEnabled)
      globalShortcutManager.sync(runtime)
    }
    if ('sidebarEdge' in patch) sidebarModeManager.applyEdge()
    if (
      'sidebarModeEnabled' in patch ||
      'sidebarHoverReveal' in patch ||
      'onboardingCompleted' in patch
    ) {
      edgeHoverWatcher.sync()
    }
    if (
      'keepInMenuBar' in patch ||
      'sidebarModeEnabled' in patch ||
      'onboardingCompleted' in patch
    ) {
      syncTray()
      // Turning the tray off must never leave the app unreachable with a
      // hidden Dock icon and no menu bar presence.
      if (!runtime.keepInMenuBar && !runtime.sidebarModeEnabled && process.platform === 'darwin') {
        void app.dock.show()
      }
    }
    return next
  })

  ipcMain.handle('sidebar:getState', () => sidebarModeManager.getState())
  ipcMain.handle('sidebar:show', () => sidebarModeManager.show())
  ipcMain.handle('sidebar:close', () => sidebarModeManager.requestClose())
  ipcMain.handle('sidebar:setPinned', (_e, pinned: boolean) => {
    const next = { ...settingsStore.read(), sidebarPinned: pinned }
    settingsStore.write(next)
    sidebarModeManager.setPinned(pinned)
    return sidebarModeManager.getState()
  })
  ipcMain.handle('meeting:getState', () => meetingRecorder.getState())
  ipcMain.handle('meeting:getRecording', (_e, noteId: string) => recordingStore.get(noteId))
  ipcMain.handle('meeting:getTranscript', (_e, noteId: string) =>
    recordingStore.readTranscript(noteId)
  )
  ipcMain.handle('meeting:saveTranscript', (_e, noteId: string, texts: string[]) => {
    return recordingStore.saveTranscript(noteId, texts)
  })
  ipcMain.handle('meeting:getNotesState', (_e, noteId: string) =>
    meetingNotesGenerator.ensure(noteId)
  )
  ipcMain.handle('meeting:getNotesMarkdown', (_e, noteId: string) =>
    recordingStore.readMeetingNotes(noteId)
  )
  ipcMain.handle('meeting:retryNotes', (_e, noteId: string) => {
    meetingNotesGenerator.retry(noteId)
    return meetingNotesGenerator.getState(noteId)
  })
  ipcMain.handle('meeting:saveNotes', (_e, noteId: string, markdown: string) =>
    meetingNotesGenerator.saveManual(noteId, markdown)
  )
  ipcMain.handle(
    'meeting:setNotesTemplate',
    (_e, noteId: string, template: MeetingNotesTemplateId) =>
      meetingNotesGenerator.selectTemplate(noteId, template)
  )
  ipcMain.handle('meeting:startNew', () => startNewMeeting())
  ipcMain.handle('meeting:start', (_e, noteId: string | null = null) => {
    if (!noteId) startNewMeeting()
    else if (!meetingGateClosed()) startMeetingForNote(noteId)
    return meetingRecorder.getState()
  })
  ipcMain.handle('meeting:stop', () => {
    meetingRecorder.stop()
    return meetingRecorder.getState()
  })
  ipcMain.handle('meeting:discard', () => {
    meetingRecorder.discard()
    return meetingRecorder.getState()
  })
  ipcMain.handle('meeting:toggle', (_e, noteId: string | null = null) => {
    if (!noteId) toggleUntargetedMeeting()
    // Only the start half is gated; a recording already running must still be
    // stoppable from the button that started it.
    else if (meetingRecorder.getState().phase !== 'idle') {
      meetingRecorder.toggle(noteId)
    } else if (!meetingGateClosed()) {
      startMeetingForNote(noteId)
    }
    return meetingRecorder.getState()
  })

  ipcMain.handle('asr:getStatus', () => getModelStatus())
  ipcMain.handle('asr:download', () => {
    startModelDownload()
    return getModelStatus()
  })

  ipcMain.handle('ai:complete', (_e, req: AiCompleteRequest) => completeAi(settingsStore.read(), req))
  const aiStreamAborts = new Map<number, AbortController>()
  ipcMain.handle('ai:stream', (e, requestId: number, req: AiCompleteRequest) => {
    const controller = new AbortController()
    aiStreamAborts.set(requestId, controller)
    return streamAi(
      settingsStore.read(),
      req,
      (delta) => {
        if (!e.sender.isDestroyed()) e.sender.send(`ai:stream:${requestId}`, delta)
      },
      controller.signal
    ).finally(() => aiStreamAborts.delete(requestId))
  })
  ipcMain.handle('ai:stream:abort', (_e, requestId: number) => {
    aiStreamAborts.get(requestId)?.abort()
  })

  ipcMain.handle('app:spellcheckerLanguages', () =>
    process.platform === 'darwin' ? [] : session.defaultSession.availableSpellCheckerLanguages
  )

  // Actions for the renderer's custom right-click menu. Cut/copy/paste go
  // through webContents so they hit the OS clipboard and the focused editable.
  ipcMain.handle('app:replaceMisspelling', (e, word: string) =>
    e.sender.replaceMisspelling(word)
  )
  ipcMain.handle('app:addToDictionary', (e, word: string) =>
    e.sender.session.addWordToSpellCheckerDictionary(word)
  )
  ipcMain.handle('app:lookUpSelection', (e) => {
    if (process.platform === 'darwin') e.sender.showDefinitionForSelection()
  })
  ipcMain.handle('app:searchGoogle', (_e, text: string) =>
    shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(text)}`)
  )
  ipcMain.handle('app:cut', (e) => e.sender.cut())
  ipcMain.handle('app:copy', (e) => e.sender.copy())
  ipcMain.handle('app:paste', (e) => e.sender.paste())
  ipcMain.handle('app:openSettings', (_e, tab?: SettingsTab) => openMainSettings(tab))

  ipcMain.handle('app:closeWindow', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.handle('app:toggleMaximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.noteato.app')
  nativeTheme.themeSource = settingsStore.read().theme

  protocol.handle(RECORDING_MEDIA_SCHEME, (request) => {
    const target = parseRecordingMediaUrl(request.url)
    if (!target) return new Response(null, { status: 404 })

    const recording = recordingStore.get(target.noteId)
    const path = target.track === 'mic' ? recording?.micPath : recording?.systemPath
    if (!path) return new Response(null, { status: 404 })

    // Electron's file handler streams from disk and preserves Range requests,
    // which makes long recordings seekable without loading them into memory.
    return net.fetch(pathToFileURL(path).href, {
      method: request.method,
      headers: request.headers,
      bypassCustomProtocolHandlers: true
    })
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
    // Restoring the Dock icon flips the app back to a regular Dock app; the
    // window is refocused once that completes because the activation-policy
    // switch can steal focus from a window shown in the same beat.
    window.on('show', () => {
      if (window === sidebarModeManager.getWindow()) {
        setImmediate(hideDockIfBackgrounded)
        return
      }
      if (process.platform !== 'darwin' || app.dock.isVisible()) return
      void app.dock.show().then(() => {
        if (!window.isDestroyed()) window.focus()
      })
    })
    window.on('hide', () => hideDockIfBackgrounded())
    window.on('closed', () => setImmediate(hideDockIfBackgrounded))
  })

  Menu.setApplicationMenu(buildAppMenu())
  registerIpcHandlers()
  applySpellcheckLanguage(settingsStore.read().spellcheckLanguage)
  externalWatcher.sync(noteStore.listOpenedRoots())
  createMainWindow()
  reminderScheduler.rebuildAll()
  const runtime = runtimeSettings()
  // Sidebar mode stays available from the tray, shortcut and edge reveal, but
  // a fresh app launch should remain quiet instead of opening the notes panel.
  if (!runtime.sidebarModeEnabled) sidebarModeManager.setEnabled(false)
  globalShortcutManager.sync(runtime)
  edgeHoverWatcher.sync()
  syncTray()
  // Upgrades from a build that shipped NoteatoAgent can leave the helper
  // running: it would still hold the Fn tap and paint a second menu-bar icon
  // this process knows nothing about.
  void removeStaleAgent()

  // Picks up a download that a previous run started and a quit interrupted.
  // Only for installs that asked for meetings — nobody else should spend
  // 680 MB — and never during onboarding, where the card owns the decision and
  // would otherwise be showing an untouched switch over a running download.
  const startup = settingsStore.read()
  if (startup.onboardingCompleted && startup.meetingNotesEnabled && !isModelInstalled()) {
    startModelDownload()
  }

  // Windows/Linux deliver OS-opened files as launch arguments.
  for (const arg of process.argv.slice(1)) openExternalMarkdown(arg)

  app.on('activate', () => {
    showMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !shouldKeepRunning()) app.quit()
})

app.on('will-quit', () => {
  // Close the helper's files rather than killing it: an m4a without its moov
  // atom is an hour of audio nobody can play.
  meetingRecorder.shutdown()
  meetingNotesGenerator.destroy()
  sherpaServer.stop()
  recorderWindow.destroy()
  globalShortcutManager.destroy()
  edgeHoverWatcher.stop()
  externalWatcher.destroy()
})
