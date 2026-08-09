import { useEffect, useRef, useState } from 'react'
import {
  IconArrowRight as ArrowRight,
  IconCheck as Check,
  IconMoon as Moon,
  IconSun as Sun,
  IconDeviceDesktop as Monitor
} from '@tabler/icons-react'
import type { ModelStatus, Settings } from '../../../shared/types'
import noteatoIcon from '../../../../build/icon.png'
import { ACCENT_OPTIONS } from '../accents'
import { useTheme } from '../theme'
import { ModelProgress, modelStatusLabel } from './ModelDownload'
import { Row, Switch } from './SettingsRow'

interface Props {
  initialSettings: Settings
  onComplete: () => void
}

function folderName(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '')
  return normalized.slice(normalized.lastIndexOf('/') + 1) || 'Noteato'
}

/**
 * One card, shown once, built from the same rows as Settings so first run looks
 * like the app rather than a preamble to it. Everything here has a working
 * default, so the only thing between a new install and a usable app is a name.
 *
 * Theme, accent and the notes folder persist the moment they are touched — they
 * take effect immediately and there is nothing to undo them against. The rest
 * is written by "Start writing".
 */
export default function OnboardingView({ initialSettings, onComplete }: Props) {
  const { theme, setTheme, accent, setAccent } = useTheme()
  const [userName, setUserName] = useState(initialSettings.userName)
  // Both default off. Sync does nothing yet, and meeting notes costs 680 MB —
  // neither is ours to opt someone into.
  const [syncEnabled, setSyncEnabled] = useState(false)
  const [meetingNotes, setMeetingNotes] = useState(false)
  const [modelStatus, setModelStatus] = useState<ModelStatus>({ state: 'absent' })
  const [notesDir, setNotesDir] = useState('')
  const [choosingFolder, setChoosingFolder] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.api.notes.getDir().then(setNotesDir)
    nameInputRef.current?.focus()
  }, [])

  useEffect(() => {
    void window.api.asr.getStatus().then(setModelStatus)
    return window.api.asr.subscribeStatus(setModelStatus)
  }, [])

  /**
   * Start the moment the switch goes on, so the cost is visible here rather
   * than surfacing as an unexplained wait after the user's first meeting. Only
   * from 'absent': a failure waits for a deliberate retry in Settings.
   */
  useEffect(() => {
    if (meetingNotes && modelStatus.state === 'absent') void window.api.asr.download()
  }, [meetingNotes, modelStatus.state])

  const chooseFolder = async (): Promise<void> => {
    setChoosingFolder(true)
    setError(null)
    try {
      const selected = await window.api.notes.chooseFolder()
      if (selected) setNotesDir(selected)
    } catch {
      setError('Could not use that folder. Please choose another location.')
    } finally {
      setChoosingFolder(false)
    }
  }

  const finish = async (): Promise<void> => {
    const name = userName.trim()
    if (!name) {
      setError('Add your name to continue.')
      nameInputRef.current?.focus()
      return
    }

    setSaving(true)
    setError(null)
    try {
      // Never waits on the download. It belongs to the main process and carries
      // on into the app, which is the point of starting it early.
      await window.api.settings.set({
        userName: name,
        syncPreference: syncEnabled ? 'noteatoPro' : 'none',
        meetingNotesEnabled: meetingNotes,
        onboardingCompleted: true
      })
      onComplete()
    } catch {
      setError('Noteato could not finish setup. Please try again.')
      setSaving(false)
    }
  }

  const meetingDescription =
    modelStatus.state === 'failed'
      ? modelStatusLabel(modelStatus)
      : modelStatus.state === 'installed'
        ? 'Transcribe and summarise meetings on this Mac.'
        : 'Transcribe and summarise meetings on this Mac. Downloads a 680 MB model.'

  return (
    <div className="onboarding-window">
      <div className="onboarding-drag-strip" />
      <main className="onboarding-card" aria-label="Set up Noteato">
        <header className="onboarding-card-header">
          <img src={noteatoIcon} alt="" />
          <h1>Welcome to Noteato</h1>
          <p>A quiet place for notes. Everything stays as plain Markdown on your Mac.</p>
        </header>

        <section className="onboarding-card-body">
          <label className="onboarding-name">
            <span>Your name</span>
            <input
              ref={nameInputRef}
              value={userName}
              onChange={(event) => {
                setUserName(event.target.value)
                setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void finish()
              }}
              placeholder="Your name"
              autoComplete="name"
            />
          </label>

          <div className="onboarding-rows">
            <Row label="Notes folder" description={notesDir || 'Preparing folder…'}>
              <button
                className="settings-btn"
                onClick={() => void chooseFolder()}
                disabled={choosingFolder}
              >
                {choosingFolder ? 'Choosing…' : folderName(notesDir)}
              </button>
            </Row>

            <Row label="Theme" description="Follows your Mac unless you pick one.">
              <div className="theme-switch" role="group" aria-label="Theme">
                <button
                  className={theme === 'system' ? 'theme-option active' : 'theme-option'}
                  onClick={() => setTheme('system')}
                  title="System"
                >
                  <Monitor size={14} />
                </button>
                <button
                  className={theme === 'light' ? 'theme-option active' : 'theme-option'}
                  onClick={() => setTheme('light')}
                  title="Light"
                >
                  <Sun size={14} />
                </button>
                <button
                  className={theme === 'dark' ? 'theme-option active' : 'theme-option'}
                  onClick={() => setTheme('dark')}
                  title="Dark"
                >
                  <Moon size={14} />
                </button>
              </div>
            </Row>

            <Row
              label="Accent"
              description={ACCENT_OPTIONS.find((option) => option.id === accent)?.label}
            >
              <div className="accent-swatches" role="group" aria-label="Accent colour">
                {ACCENT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    className={accent === option.id ? 'accent-swatch active' : 'accent-swatch'}
                    style={{ backgroundColor: option.swatch }}
                    onClick={() => setAccent(option.id)}
                    title={option.label}
                    aria-label={option.label}
                  >
                    {accent === option.id && <Check size={11} strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </Row>

            <Row label="Sync" description="Coming soon — everything stays on this Mac for now.">
              <Switch
                checked={syncEnabled}
                onToggle={() => setSyncEnabled((enabled) => !enabled)}
                label="Sync"
              />
            </Row>

            <Row label="Meeting notes" description={meetingDescription}>
              <Switch
                checked={meetingNotes}
                onToggle={() => setMeetingNotes((enabled) => !enabled)}
                label="Meeting notes"
              />
            </Row>

            {meetingNotes && modelStatus.state === 'downloading' && (
              <ModelProgress status={modelStatus} />
            )}
          </div>
        </section>

        <footer className="onboarding-actions">
          {error && <span className="onboarding-error">{error}</span>}
          <button
            className="onboarding-primary-button"
            onClick={() => void finish()}
            disabled={saving}
          >
            {saving ? 'Opening…' : 'Start writing'}
            {!saving && <ArrowRight size={15} />}
          </button>
        </footer>
      </main>
    </div>
  )
}
