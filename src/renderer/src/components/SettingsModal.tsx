import { useEffect, useState } from 'react'
import {
  IconAdjustmentsHorizontal as GeneralIcon,
  IconCheck as Check,
  IconDeviceDesktop as Monitor,
  IconFolderOpen as FolderOpen,
  IconMicrophone as MicIcon,
  IconMoon as Moon,
  IconPalette as PaletteIcon,
  IconSparkle as SparklesIcon,
  IconSun as Sun,
  IconX as X
} from '@tabler/icons-react'
import type { AiProvider, ScreenEdge, Settings } from '../../../shared/types'
import { useTheme } from '../theme'
import { FONT_OPTIONS } from '../fonts'
import { ACCENT_OPTIONS } from '../accents'
import { AI_MODELS, CHEAP_AI_MODELS } from '../ai/models'
import { SIDEBAR_MODE_ACCELERATOR, shortcutDisplay } from '../../../shared/globalShortcuts'

interface Props {
  onClose: () => void
  onNotesDirChanged?: () => void
}

type SettingsTab = 'general' | 'appearance' | 'ai' | 'dictation'

/** Offered as steps rather than a free number — this is a feel, not a measurement. */
const HOVER_DELAYS = [
  { ms: 150, label: 'Instant' },
  { ms: 400, label: 'Short' },
  { ms: 800, label: 'Medium' },
  { ms: 1500, label: 'Long' }
]

interface TabMeta {
  id: SettingsTab
  label: string
  icon: React.ReactNode
  title: string
  subtitle: string
}

const NAV_GROUPS: { group: string; tabs: TabMeta[] }[] = [
  {
    group: 'General',
    tabs: [
      {
        id: 'general',
        label: 'General',
        icon: <GeneralIcon size={16} />,
        title: 'General settings',
        subtitle: 'How Noteato behaves and where it keeps your notes'
      },
      {
        id: 'appearance',
        label: 'Appearance',
        icon: <PaletteIcon size={16} />,
        title: 'Appearance settings',
        subtitle: 'Customise how Noteato looks and reads'
      }
    ]
  },
  {
    group: 'Features',
    tabs: [
      {
        id: 'ai',
        label: 'AI',
        icon: <SparklesIcon size={16} />,
        title: 'AI settings',
        subtitle: 'Bring your own key — nothing leaves your machine until you do'
      },
      {
        id: 'dictation',
        label: 'Dictation',
        icon: <MicIcon size={16} />,
        title: 'Dictation settings',
        subtitle: 'Speech-to-text while you write'
      }
    ]
  }
]

const ALL_TABS = NAV_GROUPS.flatMap((g) => g.tabs)

/** A settings row: label and description on the left, its control on the right. */
function Row({
  label,
  description,
  children
}: {
  label: string
  description?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <strong>{label}</strong>
        {description && <span>{description}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="settings-group">
      <div className="settings-group-label">{label}</div>
      {children}
    </section>
  )
}

function Switch({
  checked,
  onToggle,
  disabled
}: {
  checked: boolean
  onToggle: () => void
  disabled?: boolean
}) {
  return (
    <button
      className={checked ? 'settings-switch on' : 'settings-switch'}
      onClick={onToggle}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
    >
      <span className="settings-switch-knob" />
    </button>
  )
}

export default function SettingsModal({ onClose, onNotesDirChanged }: Props) {
  const {
    theme,
    setTheme,
    fontFamily,
    setFontFamily,
    accent,
    setAccent,
    aiSelectionActions,
    setAiSelectionActions,
    aiAgentEnabled,
    setAiAgentEnabled
  } = useTheme()
  const [tab, setTab] = useState<SettingsTab>('general')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [notesDir, setNotesDir] = useState('')
  const [saved, setSaved] = useState(false)
  const [aiSaved, setAiSaved] = useState(false)
  const [spellLanguages, setSpellLanguages] = useState<string[]>([])
  const isMac = window.electron.process.platform === 'darwin'
  const platform = window.electron.process.platform
  const active = ALL_TABS.find((t) => t.id === tab)!

  useEffect(() => {
    window.api.settings.get().then(setSettings)
    window.api.notes.getDir().then(setNotesDir)
    window.api.app.spellcheckerLanguages().then(setSpellLanguages)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

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

  const handleChooseFolder = async (): Promise<void> => {
    const newDir = await window.api.notes.chooseFolder()
    if (!newDir) return
    setNotesDir(newDir)
    onNotesDirChanged?.()
  }

  const setAndPersist = (patch: Partial<Settings>): void => {
    if (!settings) return
    setSettings({ ...settings, ...patch })
    void window.api.settings.set(patch)
  }

  const hasAnyAiKey = Boolean(settings?.anthropicApiKey.trim() || settings?.openaiApiKey.trim())

  const renderGeneral = (s: Settings): React.ReactNode => (
    <>
      <Group label="Behaviour">
        <Row
          label="Keep in menu bar"
          description="Stay running after the window closes so reminders still fire"
        >
          <Switch
            checked={s.keepInMenuBar}
            onToggle={() => setAndPersist({ keepInMenuBar: !s.keepInMenuBar })}
          />
        </Row>
        <Row
          label="Sidebar mode"
          description={
            <>
              Compact notes panel on the screen edge ·{' '}
              <kbd className="settings-shortcut-key">
                {shortcutDisplay(SIDEBAR_MODE_ACCELERATOR, platform)}
              </kbd>
            </>
          }
        >
          <Switch
            checked={s.sidebarModeEnabled}
            onToggle={() => setAndPersist({ sidebarModeEnabled: !s.sidebarModeEnabled })}
          />
        </Row>
        <Row label="Sidebar edge" description="Which side of the screen the panel docks to">
          <select
            className="settings-select"
            value={s.sidebarEdge}
            disabled={!s.sidebarModeEnabled}
            onChange={(e) => setAndPersist({ sidebarEdge: e.target.value as ScreenEdge })}
          >
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
        </Row>
        <Row
          label="Reveal on hover"
          description="Rest the pointer against that edge to bring the sidebar forward"
        >
          <Switch
            checked={s.sidebarHoverReveal}
            disabled={!s.sidebarModeEnabled}
            onToggle={() => setAndPersist({ sidebarHoverReveal: !s.sidebarHoverReveal })}
          />
        </Row>
        <Row label="Hover delay" description="How long the pointer has to rest there first">
          <select
            className="settings-select"
            value={String(s.sidebarHoverDelay)}
            disabled={!s.sidebarModeEnabled || !s.sidebarHoverReveal}
            onChange={(e) => setAndPersist({ sidebarHoverDelay: Number(e.target.value) })}
          >
            {HOVER_DELAYS.map((option) => (
              <option key={option.ms} value={option.ms}>
                {option.label}
              </option>
            ))}
          </select>
        </Row>
      </Group>

      <Group label="Storage">
        <Row label="Notes folder" description={notesDir}>
          <button className="settings-btn" onClick={handleChooseFolder}>
            <FolderOpen size={13} />
            <span>Change…</span>
          </button>
        </Row>
      </Group>

      <Group label="Spelling">
        {isMac ? (
          <Row
            label="Dictionary"
            description="Noteato uses the macOS spellchecker — change languages in System Settings → Keyboard"
          >
            <span className="settings-static-value">System</span>
          </Row>
        ) : (
          <Row label="Dictionary language" description="Applies everywhere in the app">
            <select
              className="settings-select"
              value={s.spellcheckLanguage}
              onChange={(e) => setAndPersist({ spellcheckLanguage: e.target.value })}
            >
              <option value="auto">Automatic</option>
              {[...spellLanguages]
                .sort(
                  (a, b) =>
                    Number(b.startsWith('en')) - Number(a.startsWith('en')) || a.localeCompare(b)
                )
                .map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
            </select>
          </Row>
        )}
      </Group>
    </>
  )

  const renderAppearance = (): React.ReactNode => (
    <>
      <Group label="Theme">
        <Row label="Colour mode" description="Choose your colour mode">
          <div className="segmented">
            <button
              className={theme === 'system' ? 'active' : undefined}
              onClick={() => setTheme('system')}
            >
              <Monitor size={13} />
              <span>System</span>
            </button>
            <button
              className={theme === 'light' ? 'active' : undefined}
              onClick={() => setTheme('light')}
            >
              <Sun size={13} />
              <span>Light</span>
            </button>
            <button
              className={theme === 'dark' ? 'active' : undefined}
              onClick={() => setTheme('dark')}
            >
              <Moon size={13} />
              <span>Dark</span>
            </button>
          </div>
        </Row>
        <Row label="Accent" description="Used for selection, links, and highlights">
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
                {accent === option.id && <Check size={12} strokeWidth={3} />}
              </button>
            ))}
          </div>
        </Row>
      </Group>

      <Group label="Typography">
        <Row label="Font" description="Applies to the editor and the interface">
          <div className="segmented">
            {FONT_OPTIONS.map((option) => (
              <button
                key={option.id}
                className={fontFamily === option.id ? 'active' : undefined}
                onClick={() => setFontFamily(option.id)}
              >
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </Row>
      </Group>
    </>
  )

  const renderAi = (s: Settings): React.ReactNode => {
    const provider = s.aiProvider
    const cheapModels = provider === 'none' ? [] : CHEAP_AI_MODELS[provider]
    // The cheap tier stays the default — these actions fire on a selection, so
    // the frontier models are offered but not stumbled into.
    const capableModels =
      provider === 'none' ? [] : AI_MODELS[provider].filter((m) => !m.cheap)
    const modelValue = s.aiModel || cheapModels[0]?.id || ''
    const hasCustomModel =
      Boolean(s.aiModel) &&
      !cheapModels.some((m) => m.id === s.aiModel) &&
      !capableModels.some((m) => m.id === s.aiModel)
    return (
      <>
        <Group label="Provider">
          <Row label="Service" description="Off by default — nothing is sent anywhere">
            <div className="segmented">
              {(['none', 'anthropic', 'openai'] as const).map((p) => (
                <button
                  key={p}
                  className={provider === p ? 'active' : undefined}
                  onClick={() => setSettings({ ...s, aiProvider: p, aiModel: '' })}
                >
                  <span>{p === 'none' ? 'Off' : p === 'anthropic' ? 'Anthropic' : 'OpenAI'}</span>
                </button>
              ))}
            </div>
          </Row>

          {provider !== 'none' && (
            <>
              <Row
                label="Model"
                description="Fast models suit note editing; the rest cost more per action"
              >
                <select
                  className="settings-select"
                  value={modelValue}
                  onChange={(e) => setSettings({ ...s, aiModel: e.target.value })}
                >
                  <optgroup label="Fast and inexpensive">
                    {cheapModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="More capable">
                    {capableModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                  {hasCustomModel && <option value={s.aiModel}>{s.aiModel} (custom)</option>}
                </select>
              </Row>
              <Row
                label={provider === 'anthropic' ? 'Anthropic API key' : 'OpenAI API key'}
                description="Stored locally on this machine"
              >
                <div className="settings-inline-field">
                  <input
                    type="password"
                    value={provider === 'anthropic' ? s.anthropicApiKey : s.openaiApiKey}
                    placeholder={provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
                    onChange={(e) =>
                      setSettings(
                        provider === 'anthropic'
                          ? { ...s, anthropicApiKey: e.target.value }
                          : { ...s, openaiApiKey: e.target.value }
                      )
                    }
                  />
                  <button className="settings-btn" onClick={handleSaveAi}>
                    {aiSaved ? 'Saved' : 'Save'}
                  </button>
                </div>
              </Row>
            </>
          )}
        </Group>

        <Group label="Features">
          <Row label="Selection actions" description="Summarise, improve, and extract in place">
            <Switch
              checked={aiSelectionActions}
              onToggle={() => setAiSelectionActions(!aiSelectionActions)}
            />
          </Row>
          <Row
            label="Agent panel"
            description={
              hasAnyAiKey
                ? 'Chat with and edit the active note'
                : 'Add an API key above to enable this'
            }
          >
            <Switch
              checked={aiAgentEnabled}
              onToggle={() => setAiAgentEnabled(!aiAgentEnabled)}
              disabled={!hasAnyAiKey}
            />
          </Row>
        </Group>
      </>
    )
  }

  const renderDictation = (s: Settings): React.ReactNode => (
    <Group label="Deepgram">
      <Row label="API key" description="Required for voice dictation · stored locally">
        <div className="settings-inline-field">
          <input
            type="password"
            value={s.deepgramApiKey}
            onChange={(e) => setSettings({ ...s, deepgramApiKey: e.target.value })}
            placeholder="dg_…"
          />
          <button className="settings-btn" onClick={handleSaveKey}>
            {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </Row>
    </Group>
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <nav className="settings-nav" aria-label="Settings sections">
          <div className="settings-nav-title">Settings</div>
          {NAV_GROUPS.map((group) => (
            <div key={group.group} className="settings-nav-block">
              <div className="settings-nav-group">{group.group}</div>
              {group.tabs.map((item) => (
                <button
                  key={item.id}
                  className={tab === item.id ? 'active' : undefined}
                  onClick={() => setTab(item.id)}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="settings-pane">
          <button className="settings-close" onClick={onClose} title="Close">
            <X size={17} />
          </button>
          <div className="settings-scroll">
            <header className="settings-pane-header">
              <h2>{active.title}</h2>
              <p>{active.subtitle}</p>
            </header>
            {!settings ? (
              <div className="empty-state">Loading…</div>
            ) : tab === 'general' ? (
              renderGeneral(settings)
            ) : tab === 'appearance' ? (
              renderAppearance()
            ) : tab === 'ai' ? (
              renderAi(settings)
            ) : (
              renderDictation(settings)
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
