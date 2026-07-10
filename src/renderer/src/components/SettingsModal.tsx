import { useEffect, useState } from 'react'
import { FolderOpen, Moon, Sun, X } from 'lucide-react'
import type { AiProvider, Settings } from '../../../shared/types'
import { useTheme } from '../theme'
import { FONT_OPTIONS } from '../fonts'
import { AI_MODELS } from '../ai/models'

interface Props {
  onClose: () => void
  onNotesDirChanged?: () => void
}

export default function SettingsModal({ onClose, onNotesDirChanged }: Props) {
  const {
    theme,
    setTheme,
    fontFamily,
    setFontFamily,
    zenMode,
    setZenMode,
    aiDictationPolish,
    setAiDictationPolish,
    aiSelectionActions,
    setAiSelectionActions,
    aiAskNote,
    setAiAskNote
  } = useTheme()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [notesDir, setNotesDir] = useState('')
  const [saved, setSaved] = useState(false)
  const [aiSaved, setAiSaved] = useState(false)

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

  const handleSaveAi = async (): Promise<void> => {
    if (!settings) return
    await window.api.settings.set({
      aiProvider: settings.aiProvider,
      aiModel: settings.aiModel,
      anthropicApiKey: settings.anthropicApiKey,
      openaiApiKey: settings.openaiApiKey
    })
    setAiSaved(true)
    setTimeout(() => setAiSaved(false), 1500)
  }

  const handleProviderChange = (provider: AiProvider): void => {
    if (!settings) return
    setSettings({ ...settings, aiProvider: provider, aiModel: '' })
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
              <h2>AI</h2>
              <p className="hint">Bring your own API key. Off by default — nothing is sent anywhere until you set a provider.</p>
              <div className="theme-switch" style={{ marginTop: 12 }}>
                <button
                  className={settings.aiProvider === 'none' ? 'theme-option active' : 'theme-option'}
                  onClick={() => handleProviderChange('none')}
                >
                  <span>Off</span>
                </button>
                <button
                  className={settings.aiProvider === 'anthropic' ? 'theme-option active' : 'theme-option'}
                  onClick={() => handleProviderChange('anthropic')}
                >
                  <span>Anthropic</span>
                </button>
                <button
                  className={settings.aiProvider === 'openai' ? 'theme-option active' : 'theme-option'}
                  onClick={() => handleProviderChange('openai')}
                >
                  <span>OpenAI</span>
                </button>
              </div>

              {settings.aiProvider !== 'none' && (
                <>
                  <label className="settings-label" style={{ marginTop: 16 }}>
                    Model
                    <input
                      type="text"
                      list="ai-model-list"
                      value={settings.aiModel}
                      placeholder={AI_MODELS[settings.aiProvider][0]?.id}
                      onChange={(e) => setSettings({ ...settings, aiModel: e.target.value })}
                    />
                    <datalist id="ai-model-list">
                      {AI_MODELS[settings.aiProvider].map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </datalist>
                  </label>

                  <label className="settings-label">
                    {settings.aiProvider === 'anthropic' ? 'Anthropic API key' : 'OpenAI API key'}
                    <input
                      type="password"
                      value={
                        settings.aiProvider === 'anthropic'
                          ? settings.anthropicApiKey
                          : settings.openaiApiKey
                      }
                      placeholder={settings.aiProvider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
                      onChange={(e) =>
                        setSettings(
                          settings.aiProvider === 'anthropic'
                            ? { ...settings, anthropicApiKey: e.target.value }
                            : { ...settings, openaiApiKey: e.target.value }
                        )
                      }
                    />
                  </label>
                  <div className="settings-actions">
                    <button className="primary" onClick={handleSaveAi}>
                      {aiSaved ? 'Saved' : 'Save AI settings'}
                    </button>
                  </div>
                </>
              )}
            </section>

            <section className="settings-section">
              <h2>AI features</h2>
              <label className="settings-toggle-row">
                <span>Live dictation polish — clean up and format as you speak</span>
                <button
                  className={aiDictationPolish ? 'settings-switch on' : 'settings-switch'}
                  onClick={() => setAiDictationPolish(!aiDictationPolish)}
                  role="switch"
                  aria-checked={aiDictationPolish}
                >
                  <span className="settings-switch-knob" />
                </button>
              </label>
              <label className="settings-toggle-row" style={{ marginTop: 12 }}>
                <span>Selection actions — summarize, improve, extract in place</span>
                <button
                  className={aiSelectionActions ? 'settings-switch on' : 'settings-switch'}
                  onClick={() => setAiSelectionActions(!aiSelectionActions)}
                  role="switch"
                  aria-checked={aiSelectionActions}
                >
                  <span className="settings-switch-knob" />
                </button>
              </label>
              <label className="settings-toggle-row" style={{ marginTop: 12 }}>
                <span>Ask a question about this note</span>
                <button
                  className={aiAskNote ? 'settings-switch on' : 'settings-switch'}
                  onClick={() => setAiAskNote(!aiAskNote)}
                  role="switch"
                  aria-checked={aiAskNote}
                >
                  <span className="settings-switch-knob" />
                </button>
              </label>
              <p className="hint">The note Q&A popup is also always hidden in Zen mode.</p>
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
