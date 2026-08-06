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
import type { ModelStatus, ScreenEdge, Settings, SettingsTab } from '../../../shared/types'
import {
  AI_PROVIDER_LABELS,
  AI_PROVIDER_ORDER,
  AUTO_AI_MODEL_ID,
  availableAiProviders,
  hasAiProviderKey,
  listedAiModels,
  normalizeAiModelChoice,
  resolveAiModelChoice
} from '../../../shared/aiModels'
import { useTheme } from '../theme'
import { FONT_OPTIONS } from '../fonts'
import { ACCENT_OPTIONS } from '../accents'
import { SIDEBAR_MODE_ACCELERATOR, shortcutDisplay } from '../../../shared/globalShortcuts'
import { ModelProgress, modelStatusLabel } from './ModelDownload'
import { Group, Row, Switch } from './SettingsRow'

interface Props {
  onClose: () => void
  onNotesDirChanged?: () => void
  /** Pane to open on. Main sets this when it opens Settings on the user's behalf. */
  initialTab?: SettingsTab
}

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
        id: 'speech',
        label: 'Speech',
        icon: <MicIcon size={16} />,
        title: 'Speech settings',
        subtitle: 'Meeting notes and dictation — both turn talking into text'
      }
    ]
  }
]

const ALL_TABS = NAV_GROUPS.flatMap((g) => g.tabs)

export default function SettingsModal({ onClose, onNotesDirChanged, initialTab }: Props) {
  const {
    theme,
    setTheme,
    fontFamily,
    setFontFamily,
    accent,
    setAccent,
    aiSelectionActions,
    setAiSelectionActions
  } = useTheme()
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'general')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [notesDir, setNotesDir] = useState('')
  const [saved, setSaved] = useState(false)
  const [aiSaved, setAiSaved] = useState(false)
  const [spellLanguages, setSpellLanguages] = useState<string[]>([])
  const [modelStatus, setModelStatus] = useState<ModelStatus>({ state: 'absent' })
  const isMac = window.electron.process.platform === 'darwin'
  const platform = window.electron.process.platform
  const active = ALL_TABS.find((t) => t.id === tab)!

  useEffect(() => {
    window.api.settings.get().then(setSettings)
    window.api.notes.getDir().then(setNotesDir)
    window.api.app.spellcheckerLanguages().then(setSpellLanguages)
  }, [])

  // A download started during onboarding may still be running, so read the
  // current status as well as subscribing to what happens next.
  useEffect(() => {
    void window.api.asr.getStatus().then(setModelStatus)
    return window.api.asr.subscribeStatus(setModelStatus)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const modelDescription = modelStatusLabel(modelStatus)

  /**
   * Turning meetings on pulls the model down with it — otherwise the switch
   * reads as done while the feature is still unusable. Main ignores the request
   * if the model is already there.
   */
  const handleToggleMeetingNotes = async (s: Settings): Promise<void> => {
    const meetingNotesEnabled = !s.meetingNotesEnabled
    setSettings({ ...s, meetingNotesEnabled })
    await window.api.settings.set({ meetingNotesEnabled })
  }

  const handleSaveKey = async (): Promise<void> => {
    if (!settings) return
    await window.api.settings.set({ deepgramApiKey: settings.deepgramApiKey })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const handleSaveAi = async (): Promise<void> => {
    if (!settings) return
    const selected = resolveAiModelChoice(settings.aiModel, settings.aiProvider, settings)
    const savedSettings = await window.api.settings.set({
      aiProvider: selected.provider,
      aiModel: selected.choice,
      anthropicApiKey: settings.anthropicApiKey,
      openaiApiKey: settings.openaiApiKey,
      xaiApiKey: settings.xaiApiKey
    })
    setSettings(savedSettings)
    // Clearing the last key leaves the note actions with nothing to run.
    if (
      !settings.anthropicApiKey.trim() &&
      !settings.openaiApiKey.trim() &&
      !settings.xaiApiKey.trim()
    ) {
      setAiSelectionActions(false)
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

  const hasAnyAiKey = Boolean(
    settings?.anthropicApiKey.trim() ||
      settings?.openaiApiKey.trim() ||
      settings?.xaiApiKey.trim()
  )

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
    const modelValue = normalizeAiModelChoice(s.aiModel)
    const knownModel =
      modelValue === AUTO_AI_MODEL_ID ||
      AI_PROVIDER_ORDER.some((provider) =>
        listedAiModels(provider).some((model) => model.id === modelValue)
      )
    return (
      <>
        <Group label="Model">
          <Row
            label="Default model"
            description="Used by text enhancements and note chat"
          >
            <select
              className="settings-select ai-model-settings-select"
              value={modelValue}
              onChange={(event) => {
                const next = resolveAiModelChoice(event.target.value, s.aiProvider, s)
                setSettings({ ...s, aiProvider: next.provider, aiModel: next.choice })
              }}
            >
              <option
                value={AUTO_AI_MODEL_ID}
                disabled={availableAiProviders(s).length === 0}
              >
                Auto
              </option>
              {AI_PROVIDER_ORDER.map((provider) => (
                <optgroup
                  key={provider}
                  label={AI_PROVIDER_LABELS[provider]}
                  disabled={!hasAiProviderKey(s, provider)}
                >
                  {listedAiModels(provider).map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </optgroup>
              ))}
              {!knownModel && <option value={modelValue}>{modelValue} (custom)</option>}
            </select>
          </Row>
        </Group>

        <Group label="Provider keys">
          <Row label="OpenAI" description="Required for GPT models · stored locally">
            <input
              className="settings-api-key"
              type="password"
              value={s.openaiApiKey}
              placeholder="sk-…"
              onChange={(event) => setSettings({ ...s, openaiApiKey: event.target.value })}
            />
          </Row>
          <Row label="Anthropic" description="Required for Claude models · stored locally">
            <input
              className="settings-api-key"
              type="password"
              value={s.anthropicApiKey}
              placeholder="sk-ant-…"
              onChange={(event) => setSettings({ ...s, anthropicApiKey: event.target.value })}
            />
          </Row>
          <Row label="xAI" description="Required for Grok models · stored locally">
            <input
              className="settings-api-key"
              type="password"
              value={s.xaiApiKey}
              placeholder="xai-…"
              onChange={(event) => setSettings({ ...s, xaiApiKey: event.target.value })}
            />
          </Row>
          <Row label="Save provider settings">
            <button className="settings-btn" onClick={handleSaveAi}>
              {aiSaved ? 'Saved' : 'Save'}
            </button>
          </Row>
        </Group>

        <Group label="Features">
          <Row
            label="Note actions"
            description={
              hasAnyAiKey
                ? 'Summarize, proofread and ask, from the bar under each note'
                : 'Add an API key above to enable this'
            }
          >
            <Switch
              checked={aiSelectionActions}
              onToggle={() => setAiSelectionActions(!aiSelectionActions)}
              disabled={!hasAnyAiKey}
            />
          </Row>
        </Group>
      </>
    )
  }

  const renderSpeech = (s: Settings): React.ReactNode => (
    <>
      {/* First, because this is where the meeting gate sends people. */}
      <Group label="Meeting notes">
        <Row
          label="Record meetings"
          description="Transcribe and summarise meetings on this Mac"
        >
          <Switch
            checked={s.meetingNotesEnabled}
            onToggle={() => void handleToggleMeetingNotes(s)}
          />
        </Row>
        <Row label="Speech model" description={modelDescription}>
          {modelStatus.state === 'downloading' ? (
            <ModelProgress status={modelStatus} />
          ) : modelStatus.state === 'installed' ? (
            <span className="settings-hint">Ready</span>
          ) : (
            <button className="settings-btn" onClick={() => void window.api.asr.download()}>
              {modelStatus.state === 'failed' ? 'Retry' : 'Download'}
            </button>
          )}
        </Row>
      </Group>

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
    </>
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
              renderSpeech(settings)
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
