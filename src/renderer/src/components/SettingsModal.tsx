import { useEffect, useState } from 'react'
import {
  IconCheck as Check,
  IconDeviceDesktop as Monitor,
  IconFolderOpen as FolderOpen,
  IconMoon as Moon,
  IconSun as Sun,
  IconX as X
} from '@tabler/icons-react'
import type { AiProvider, Settings } from '../../../shared/types'
import { useTheme } from '../theme'
import { FONT_OPTIONS } from '../fonts'
import { ACCENT_OPTIONS } from '../accents'
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
    accent,
    setAccent,
    zenMode,
    setZenMode,
    aiSelectionActions,
    setAiSelectionActions,
    aiAgentEnabled,
    setAiAgentEnabled
  } = useTheme()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [notesDir, setNotesDir] = useState('')
  const [saved, setSaved] = useState(false)
  const [aiSaved, setAiSaved] = useState(false)
  const [spellLanguages, setSpellLanguages] = useState<string[]>([])
  const isMac = window.electron.process.platform === 'darwin'

  useEffect(() => {
    window.api.settings.get().then(setSettings)
    window.api.notes.getDir().then(setNotesDir)
    window.api.app.spellcheckerLanguages().then(setSpellLanguages)
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
    if (!settings.anthropicApiKey.trim() && !settings.openaiApiKey.trim()) {
      setAiAgentEnabled(false)
    }
    window.dispatchEvent(new Event('noteato:ai-settings-changed'))
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

  const hasAnyAiKey = Boolean(settings?.anthropicApiKey.trim() || settings?.openaiApiKey.trim())

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h1>Settings</h1>
          <button className="modal-close-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="settings-body">
        {!settings ? (
          <div className="empty-state">Loading…</div>
        ) : (
          <>
            <section className="settings-section">
              <h2>Theme</h2>
              <div className="theme-switch">
                <button
                  className={theme === 'system' ? 'theme-option active' : 'theme-option'}
                  onClick={() => setTheme('system')}
                >
                  <Monitor size={15} />
                  <span>System</span>
                </button>
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
              <h2>Accent</h2>
              <div className="accent-swatches">
                {ACCENT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    className={accent === option.id ? 'accent-swatch active' : 'accent-swatch'}
                    style={{ backgroundColor: option.swatch }}
                    title={option.label}
                    aria-label={option.label}
                    onClick={() => setAccent(option.id)}
                  >
                    {accent === option.id && <Check size={13} strokeWidth={3} />}
                  </button>
                ))}
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
              <h2>Menu bar</h2>
              <label className="settings-toggle-row">
                <span>Keep Noteato running in the menu bar</span>
                <button
                  className={settings.keepInMenuBar ? 'settings-switch on' : 'settings-switch'}
                  onClick={() => {
                    const next = !settings.keepInMenuBar
                    setSettings({ ...settings, keepInMenuBar: next })
                    window.api.settings.set({ keepInMenuBar: next })
                  }}
                  role="switch"
                  aria-checked={settings.keepInMenuBar}
                >
                  <span className="settings-switch-knob" />
                </button>
              </label>
              <p className="hint">
                Lets reminders fire even after closing the window or pressing ⌘Q — quit fully
                from the menu bar icon instead.
              </p>
            </section>

            <section className="settings-section settings-ai-preferences">
              <h2>AI</h2>
              <p className="hint">Bring your own API key. Off by default — nothing is sent anywhere until you set a provider.</p>
              <div className="theme-switch settings-ai-providers">
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
                <div className="settings-ai-fields">
                  <label className="settings-label">
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
                </div>
              )}
            </section>

            <section className="settings-section settings-ai-features">
              <h2>AI features</h2>
              <div className="settings-toggle-stack">
                <label className="settings-toggle-row">
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
                <label className="settings-toggle-row">
                  <span>Agent panel — chat with and edit the active note</span>
                  <button
                    className={aiAgentEnabled ? 'settings-switch on' : 'settings-switch'}
                    onClick={() => setAiAgentEnabled(!aiAgentEnabled)}
                    role="switch"
                    aria-checked={aiAgentEnabled}
                    disabled={!hasAnyAiKey}
                    title={hasAnyAiKey ? undefined : 'Add an OpenAI or Anthropic API key first'}
                  >
                    <span className="settings-switch-knob" />
                  </button>
                </label>
              </div>
              {!hasAnyAiKey && <p className="hint">Add an API key to enable the agent panel.</p>}
            </section>

            <section className="settings-section">
              <h2>Spelling</h2>
              {isMac ? (
                <p className="hint">
                  Noteato uses the macOS system spellchecker. To change the language or English
                  variant, open System Settings → Keyboard → Text Input → Edit… → Spelling.
                </p>
              ) : (
                <>
                  <label className="settings-label">
                    Dictionary language
                    <select
                      value={settings.spellcheckLanguage}
                      onChange={(e) => {
                        const next = e.target.value
                        setSettings({ ...settings, spellcheckLanguage: next })
                        window.api.settings.set({ spellcheckLanguage: next })
                      }}
                    >
                      <option value="auto">Automatic (system locale)</option>
                      {[...spellLanguages]
                        .sort((a, b) =>
                          // English variants first — they're what people switch between.
                          Number(b.startsWith('en')) - Number(a.startsWith('en')) ||
                          a.localeCompare(b)
                        )
                        .map((lang) => (
                          <option key={lang} value={lang}>
                            {lang}
                          </option>
                        ))}
                    </select>
                  </label>
                  <p className="hint">Applies to spellcheck everywhere in the app.</p>
                </>
              )}
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
    </div>
  )
}
