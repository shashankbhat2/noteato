import { useEffect, useState } from 'react'
import { FolderOpen, Moon, Sun, X } from 'lucide-react'
import type { Settings } from '../../../shared/types'
import { useTheme } from '../theme'
import { FONT_OPTIONS } from '../fonts'

interface Props {
  onClose: () => void
  onNotesDirChanged?: () => void
}

export default function SettingsModal({ onClose, onNotesDirChanged }: Props) {
  const { theme, setTheme, fontFamily, setFontFamily, zenMode, setZenMode } = useTheme()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [notesDir, setNotesDir] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.api.settings.get().then(setSettings)
    window.api.notes.getDir().then(setNotesDir)
  }, [])

  const handleSaveKey = async (): Promise<void> => {
    if (!settings) return
    await window.api.settings.set({ deepgramApiKey: settings.deepgramApiKey })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const handleChooseFolder = async (): Promise<void> => {
    const newDir = await window.api.notes.chooseFolder()
    if (!newDir) return
    setNotesDir(newDir)
    onNotesDirChanged?.()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h1>Settings</h1>
          <button className="modal-close-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        {!settings ? (
          <div className="empty-state">Loading…</div>
        ) : (
          <>
            <section className="settings-section">
              <h2>Appearance</h2>
              <div className="theme-switch">
                <button
                  className={theme === 'light' ? 'theme-option active' : 'theme-option'}
                  onClick={() => setTheme('light')}
                >
                  <Sun size={15} />
                  <span>Light</span>
                </button>
                <button
                  className={theme === 'dark' ? 'theme-option active' : 'theme-option'}
                  onClick={() => setTheme('dark')}
                >
                  <Moon size={15} />
                  <span>Dark</span>
                </button>
              </div>
            </section>

            <section className="settings-section">
              <h2>Font</h2>
              <div className="theme-switch">
                {FONT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    className={fontFamily === option.id ? 'theme-option active' : 'theme-option'}
                    onClick={() => setFontFamily(option.id)}
                  >
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="settings-section">
              <h2>Zen mode</h2>
              <label className="settings-toggle-row">
                <span>Hide the sidebar and tabs for distraction-free writing</span>
                <button
                  className={zenMode ? 'settings-switch on' : 'settings-switch'}
                  onClick={() => setZenMode(!zenMode)}
                  role="switch"
                  aria-checked={zenMode}
                >
                  <span className="settings-switch-knob" />
                </button>
              </label>
              <p className="hint">Persists across restarts. Press ⌘. or ⌘, to get back here.</p>
            </section>

            <section className="settings-section">
              <h2>Dictation</h2>
              <label className="settings-label">
                Deepgram API key
                <input
                  type="password"
                  value={settings.deepgramApiKey}
                  onChange={(e) => setSettings({ ...settings, deepgramApiKey: e.target.value })}
                  placeholder="dg_..."
                />
              </label>
              <div className="settings-actions">
                <button className="primary" onClick={handleSaveKey}>
                  {saved ? 'Saved' : 'Save key'}
                </button>
              </div>
            </section>

            <section className="settings-section">
              <h2>Storage</h2>
              <p className="hint">{notesDir}</p>
              <div className="settings-actions">
                <button className="primary" onClick={handleChooseFolder}>
                  <FolderOpen size={13} />
                  <span>Choose folder…</span>
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
