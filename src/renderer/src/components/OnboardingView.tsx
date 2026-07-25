import { useEffect, useMemo, useRef, useState } from 'react'
import {
  IconArrowLeft as ArrowLeft,
  IconArrowRight as ArrowRight,
  IconCheck as Check,
  IconCloud as Cloud,
  IconCloudLock as CloudLock,
  IconFolder as Folder,
  IconFolderOpen as FolderOpen,
  IconMoon as Moon,
  IconSun as Sun,
  IconDeviceDesktop as Monitor
} from '@tabler/icons-react'
import type { Settings, SyncPreference } from '../../../shared/types'
import noteatoIcon from '../../../../build/icon.png'
import { ACCENT_OPTIONS } from '../accents'
import { useTheme } from '../theme'

interface Props {
  initialSettings: Settings
  onComplete: () => void
}

const SYNC_OPTIONS: Array<{
  id: Exclude<SyncPreference, 'none'>
  name: string
  description: string
  icon: typeof Cloud
}> = [
  {
    id: 'icloud',
    name: 'iCloud Sync',
    description: 'Keep your Noteato library in your private iCloud Drive.',
    icon: Cloud
  },
  {
    id: 'noteatoPro',
    name: 'Noteato Pro Sync',
    description: 'Sync through Noteato across supported devices.',
    icon: CloudLock
  }
]

function folderName(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '')
  return normalized.slice(normalized.lastIndexOf('/') + 1) || 'Noteato'
}

export default function OnboardingView({ initialSettings, onComplete }: Props) {
  const { theme, setTheme, accent, setAccent } = useTheme()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [userName, setUserName] = useState(initialSettings.userName)
  const [licenseKey, setLicenseKey] = useState(initialSettings.licenseKey)
  const [syncPreference, setSyncPreference] = useState<SyncPreference>(
    initialSettings.syncPreference
  )
  const [sidebarEnabled, setSidebarEnabled] = useState(initialSettings.sidebarModeEnabled)
  const [menuBarEnabled, setMenuBarEnabled] = useState(initialSettings.keepInMenuBar)
  const [notesDir, setNotesDir] = useState('')
  const [choosingFolder, setChoosingFolder] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.api.notes.getDir().then(setNotesDir)
    nameInputRef.current?.focus()
  }, [])

  const selectedSync = useMemo(
    () => SYNC_OPTIONS.find((option) => option.id === syncPreference),
    [syncPreference]
  )

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

  const continueToSync = async (): Promise<void> => {
    const name = userName.trim()
    if (!name) {
      setError('Add your name to continue.')
      nameInputRef.current?.focus()
      return
    }

    setSaving(true)
    setError(null)
    try {
      await window.api.settings.set({
        userName: name,
        licenseKey: licenseKey.trim()
      })
      setUserName(name)
      setStep(2)
    } catch {
      setError('Your setup could not be saved. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const continueToThanks = async (preference: SyncPreference): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await window.api.settings.set({
        syncPreference: preference,
        sidebarModeEnabled: sidebarEnabled,
        keepInMenuBar: menuBarEnabled
      })
      setSyncPreference(preference)
      setStep(3)
    } catch {
      setError('Your sync preference could not be saved. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const completeOnboarding = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await window.api.settings.set({ onboardingCompleted: true })
      onComplete()
    } catch {
      setError('Noteato could not finish setup. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div className="onboarding-window">
      <div className="onboarding-drag-strip" />
      <main className="onboarding-card" aria-label="Set up Noteato">
        <header className="onboarding-card-header">
          <div className="onboarding-brand">
            <img src={noteatoIcon} alt="" />
            <div>
              <strong>Noteato</strong>
              <span>Step {step} of 3</span>
            </div>
          </div>
          <div className="onboarding-progress" aria-label={`Step ${step} of 3`}>
            {[1, 2, 3].map((number) => (
              <span key={number} className={number <= step ? 'active' : undefined} />
            ))}
          </div>
        </header>

        <section key={step} className="onboarding-card-body">
          {step === 1 && (
            <>
              <div className="onboarding-heading">
                <h1>Welcome to Noteato</h1>
                <p>Choose how your writing space should feel.</p>
              </div>

              <div className="onboarding-fields-row">
                <label className="settings-label onboarding-field">
                  <span>Your name</span>
                  <input
                    ref={nameInputRef}
                    value={userName}
                    onChange={(event) => {
                      setUserName(event.target.value)
                      setError(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void continueToSync()
                    }}
                    placeholder="Your name"
                    autoComplete="name"
                  />
                </label>
                <label className="settings-label onboarding-field">
                  <span>
                    License key <small>Optional</small>
                  </span>
                  <input
                    value={licenseKey}
                    onChange={(event) => setLicenseKey(event.target.value)}
                    placeholder="NTAO-••••-••••"
                    spellCheck={false}
                  />
                </label>
              </div>

              <div className="onboarding-section-block">
                <div className="onboarding-section-label">
                  <span>Storage location</span>
                </div>
                <div className="onboarding-storage-row">
                  <span className="onboarding-storage-icon">
                    <Folder size={18} />
                  </span>
                  <span className="onboarding-storage-copy">
                    <strong>{notesDir ? folderName(notesDir) : 'Local storage'}</strong>
                    <small>{notesDir || 'Preparing folder…'}</small>
                  </span>
                  <button
                    className="onboarding-storage-action"
                    onClick={() => void chooseFolder()}
                    disabled={choosingFolder}
                  >
                    <FolderOpen size={14} />
                    {choosingFolder ? 'Choosing…' : 'Change'}
                  </button>
                </div>
              </div>

              <div className="onboarding-section-block">
                <div className="onboarding-section-label">
                  <span>Theme</span>
                </div>
                <div className="theme-switch onboarding-theme-switch" role="group" aria-label="Theme">
                  <button
                    className={theme === 'system' ? 'theme-option active' : 'theme-option'}
                    onClick={() => setTheme('system')}
                  >
                    <Monitor size={14} /> System
                  </button>
                  <button
                    className={theme === 'light' ? 'theme-option active' : 'theme-option'}
                    onClick={() => setTheme('light')}
                  >
                    <Sun size={14} /> Light
                  </button>
                  <button
                    className={theme === 'dark' ? 'theme-option active' : 'theme-option'}
                    onClick={() => setTheme('dark')}
                  >
                    <Moon size={14} /> Dark
                  </button>
                </div>
              </div>

              <div className="onboarding-section-block">
                <div className="onboarding-section-label">
                  <span>Accent color</span>
                  <small>{ACCENT_OPTIONS.find((option) => option.id === accent)?.label}</small>
                </div>
                <div className="accent-swatches onboarding-accent-swatches" role="group" aria-label="Accent color">
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
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="onboarding-heading">
                <h1>Select sync mode</h1>
                <p>Coming soon. Choose a preference or skip for now.</p>
              </div>

              <div className="onboarding-sync-options">
                {SYNC_OPTIONS.map((option) => {
                  const Icon = option.icon
                  const selected = syncPreference === option.id
                  return (
                    <button
                      key={option.id}
                      className={selected ? 'onboarding-sync-card selected' : 'onboarding-sync-card'}
                      onClick={() => setSyncPreference(option.id)}
                      aria-pressed={selected}
                    >
                      <span className="onboarding-sync-icon">
                        <Icon size={21} />
                      </span>
                      <span className="onboarding-sync-copy">
                        <span className="onboarding-sync-title">
                          <strong>{option.name}</strong>
                          <small>Coming soon</small>
                        </span>
                        <span>{option.description}</span>
                      </span>
                      <span className="onboarding-sync-select">
                        {selected && <Check size={12} strokeWidth={3} />}
                      </span>
                    </button>
                  )
                })}
              </div>

              <p className="onboarding-local-note">
                Notes stay local in <strong>{folderName(notesDir)}</strong> for now.
                {selectedSync && <> We’ll remember {selectedSync.name}.</>}
              </p>

              <div className="onboarding-availability">
                <h2>Availability</h2>
                <div className="onboarding-toggle-stack">
                  <div className="settings-toggle-row">
                    <span>Enable sidebar mode</span>
                    <button
                      className={sidebarEnabled ? 'settings-switch on' : 'settings-switch'}
                      onClick={() => setSidebarEnabled((enabled) => !enabled)}
                      role="switch"
                      aria-checked={sidebarEnabled}
                    >
                      <span className="settings-switch-knob" />
                    </button>
                  </div>
                  <div className="settings-toggle-row">
                    <span>Keep Noteato in the menu bar</span>
                    <button
                      className={menuBarEnabled ? 'settings-switch on' : 'settings-switch'}
                      onClick={() => setMenuBarEnabled((enabled) => !enabled)}
                      role="switch"
                      aria-checked={menuBarEnabled}
                    >
                      <span className="settings-switch-knob" />
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <div className="onboarding-thanks">
              <img src={noteatoIcon} alt="" />
              <span>Setup complete</span>
              <h1>Thank you, {userName.split(/\s+/)[0]}.</h1>
              <p>
                Your quiet place for notes is ready. Everything you write remains plain Markdown
                in the folder you chose.
              </p>
            </div>
          )}
        </section>

        <footer className="onboarding-actions">
          <div>
            {step === 2 && (
              <button className="onboarding-text-button" onClick={() => setStep(1)}>
                <ArrowLeft size={14} /> Back
              </button>
            )}
            {error && <span className="onboarding-error">{error}</span>}
          </div>

          <div>
            {step === 2 && (
              <button
                className="onboarding-skip-button"
                onClick={() => void continueToThanks('none')}
                disabled={saving}
              >
                Skip for now
              </button>
            )}
            {step === 1 && (
              <button
                className="onboarding-primary-button"
                onClick={() => void continueToSync()}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Continue'}
                {!saving && <ArrowRight size={15} />}
              </button>
            )}
            {step === 2 && (
              <button
                className="onboarding-primary-button"
                onClick={() => void continueToThanks(syncPreference)}
                disabled={saving || syncPreference === 'none'}
              >
                {saving ? 'Saving…' : 'Continue'}
                {!saving && <ArrowRight size={15} />}
              </button>
            )}
            {step === 3 && (
              <button
                className="onboarding-primary-button"
                onClick={() => void completeOnboarding()}
                disabled={saving}
              >
                {saving ? 'Opening…' : 'Start writing'}
                {!saving && <ArrowRight size={15} />}
              </button>
            )}
          </div>
        </footer>
      </main>
    </div>
  )
}
