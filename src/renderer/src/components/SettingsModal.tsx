import { useEffect, useState } from 'react'
import {
  IconAdjustmentsHorizontal as GeneralIcon,
  IconCheck as Check,
  IconChevronRight as ChevronRight,
  IconDeviceDesktop as Monitor,
  IconFolderOpen as FolderOpen,
  IconMicrophone as MicIcon,
  IconMoon as Moon,
  IconPalette as PaletteIcon,
  IconPlugConnected as Plug,
  IconPlus as Plus,
  IconRefresh as Refresh,
  IconSearch as Search,
  IconSparkle as SparklesIcon,
  IconSun as Sun,
  IconTool as Tool,
  IconTrash as Trash,
  IconX as X
} from '@tabler/icons-react'
import type { ModelStatus, ScreenEdge, Settings, SettingsTab } from '../../../shared/types'
import type {
  McpConnectionInput,
  McpConnectionSummary,
  McpToolSummary
} from '../../../shared/mcp'
import {
  localAgentManifest,
  type LocalAgentSummary
} from '../../../shared/localAgents'
import {
  INTEGRATION_CATALOG,
  integrationManifest,
  integrationRecipe
} from '../../../shared/integrations'
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
import IntegrationLogo from './IntegrationLogo'

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

function mcpErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error)
  const cleaned = message
    .replace(/^Error invoking remote method ['"]?mcp:[^:]+['"]?:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
  if (/RegistrationRejectedError.*(?:404|not found)/i.test(cleaned)) {
    return 'This provider requires a registered OAuth client. Use its setup option or connect with a token under Custom.'
  }
  return cleaned || fallback
}

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
        id: 'apps',
        label: 'Apps',
        icon: <Plug size={16} />,
        title: 'Apps & agents',
        subtitle: 'Hand work off through connected tools, with review before every action'
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
  const [mcpConnections, setMcpConnections] = useState<McpConnectionSummary[]>([])
  const [localAgents, setLocalAgents] = useState<LocalAgentSummary[]>([])
  const [mcpView, setMcpView] = useState<'connected' | 'browse' | 'agents' | 'custom'>('connected')
  const [mcpSearch, setMcpSearch] = useState('')
  const [mcpExpanded, setMcpExpanded] = useState<Set<string>>(() => new Set())
  const [mcpTools, setMcpTools] = useState<Record<string, McpToolSummary[]>>({})
  const [mcpToolsLoading, setMcpToolsLoading] = useState<Record<string, boolean>>({})
  const [mcpToolErrors, setMcpToolErrors] = useState<Record<string, string>>({})
  const [mcpAdding, setMcpAdding] = useState<'local' | 'remote' | null>(null)
  const [mcpName, setMcpName] = useState('')
  const [mcpCommand, setMcpCommand] = useState('')
  const [mcpArgs, setMcpArgs] = useState('')
  const [mcpUrl, setMcpUrl] = useState('')
  const [mcpToken, setMcpToken] = useState('')
  const [mcpRemoteAuth, setMcpRemoteAuth] = useState<'oauth' | 'bearer' | 'none'>('oauth')
  const [mcpBusy, setMcpBusy] = useState<string | null>(null)
  const [mcpError, setMcpError] = useState<string | null>(null)
  const isMac = window.electron.process.platform === 'darwin'
  const platform = window.electron.process.platform
  const active = ALL_TABS.find((t) => t.id === tab)!

  useEffect(() => {
    window.api.settings.get().then(setSettings)
    window.api.notes.getDir().then(setNotesDir)
    window.api.app.spellcheckerLanguages().then(setSpellLanguages)
  }, [])

  useEffect(() => {
    const load = (): void => {
      void Promise.all([
        window.api.mcp.listConnections(),
        window.api.mcp.listAgents()
      ]).then(([connections, agents]) => {
        setMcpConnections(connections)
        setLocalAgents(agents)
      })
    }
    load()
    return window.api.mcp.subscribeChanged(load)
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

  const resetMcpForm = (): void => {
    setMcpAdding(null)
    setMcpName('')
    setMcpCommand('')
    setMcpArgs('')
    setMcpUrl('')
    setMcpToken('')
    setMcpRemoteAuth('oauth')
  }

  const addMcpConnection = async (): Promise<void> => {
    if (!mcpAdding) return
    const input: McpConnectionInput =
      mcpAdding === 'local'
        ? {
            name: mcpName,
            transport: 'stdio',
            command: mcpCommand,
            args: mcpArgs
              .split('\n')
              .map((item) => item.trim())
              .filter(Boolean),
            source: 'Added in Noteato'
          }
        : {
            name: mcpName,
            transport: 'http',
            url: mcpUrl,
            headers: mcpRemoteAuth === 'bearer' && mcpToken.trim()
              ? { Authorization: `Bearer ${mcpToken.trim()}` }
              : undefined,
            auth: mcpRemoteAuth,
            source: 'Added in Noteato'
          }
    setMcpBusy('add')
    setMcpError(null)
    try {
      await window.api.mcp.add(input)
      setMcpConnections(await window.api.mcp.listConnections())
      resetMcpForm()
    } catch (error) {
      setMcpError(mcpErrorMessage(error, 'Could not add the MCP app.'))
    } finally {
      setMcpBusy(null)
    }
  }

  const toggleMcpTools = async (connection: McpConnectionSummary): Promise<void> => {
    if (mcpExpanded.has(connection.id)) {
      setMcpExpanded((current) => {
        const next = new Set(current)
        next.delete(connection.id)
        return next
      })
      return
    }

    setMcpExpanded((current) => new Set(current).add(connection.id))
    setMcpToolsLoading((current) => ({ ...current, [connection.id]: true }))
    setMcpToolErrors((current) => {
      const next = { ...current }
      delete next[connection.id]
      return next
    })
    try {
      const tools = await window.api.mcp.listTools(connection.id)
      setMcpTools((current) => ({ ...current, [connection.id]: tools }))
    } catch (error) {
      setMcpToolErrors((current) => ({
        ...current,
        [connection.id]: error instanceof Error ? error.message : 'Could not load tools.'
      }))
    } finally {
      setMcpToolsLoading((current) => ({ ...current, [connection.id]: false }))
    }
  }

  const connectCatalogApp = async (catalogId: string): Promise<void> => {
    const manifest = integrationManifest(catalogId)
    if (manifest?.connection === 'api') return
    setMcpBusy(`catalog:${catalogId}`)
    setMcpError(null)
    try {
      const connection = await window.api.mcp.addCatalog(catalogId)
      await window.api.mcp.connect(connection.id)
      setMcpConnections(await window.api.mcp.listConnections())
    } catch (error) {
      setMcpError(mcpErrorMessage(error, 'Could not connect the app.'))
    } finally {
      setMcpBusy(null)
    }
  }

  const toggleLocalAgent = async (agent: LocalAgentSummary): Promise<void> => {
    setMcpBusy(`agent:${agent.id}`)
    setMcpError(null)
    try {
      if (agent.connected && agent.connectionId) {
        await window.api.mcp.remove(agent.connectionId)
      } else {
        await window.api.mcp.connectAgent(agent.id)
      }
      const [connections, agents] = await Promise.all([
        window.api.mcp.listConnections(),
        window.api.mcp.listAgents()
      ])
      setMcpConnections(connections)
      setLocalAgents(agents)
    } catch (error) {
      setMcpError(mcpErrorMessage(error, `Could not connect ${agent.name}.`))
    } finally {
      setMcpBusy(null)
    }
  }

  const refreshLocalAgents = async (): Promise<void> => {
    setMcpBusy('agents:refresh')
    setMcpError(null)
    try {
      setLocalAgents(await window.api.mcp.listAgents())
    } catch (error) {
      setMcpError(mcpErrorMessage(error, 'Could not scan for local agents.'))
    } finally {
      setMcpBusy(null)
    }
  }

  const filteredCatalog = INTEGRATION_CATALOG.filter((manifest) => {
    const query = mcpSearch.trim().toLowerCase()
    if (!query) return true
    const recipeText = manifest.recipeIds
      .map((id) => integrationRecipe(id).title)
      .join(' ')
    return `${manifest.name} ${manifest.description} ${manifest.category} ${recipeText}`
      .toLowerCase()
      .includes(query)
  })
  const dynamicMcpCatalog = filteredCatalog.filter(
    (manifest) => manifest.connection === 'dynamic-mcp'
  )
  const apiCatalog = filteredCatalog.filter((manifest) => manifest.connection === 'api')
  const renderCatalogCard = (
    manifest: (typeof INTEGRATION_CATALOG)[number]
  ): React.ReactNode => {
    const connection = mcpConnections.find((item) => item.catalogId === manifest.id)
    const busy = mcpBusy === `catalog:${manifest.id}`
    const comingSoon = manifest.connection === 'api'
    return (
      <article
        className={`settings-mcp-catalog-card${comingSoon ? ' coming-soon' : ''}`}
        key={manifest.id}
      >
        <div className="settings-mcp-catalog-card-head">
          <span
            className="settings-mcp-brand large"
            style={{ '--mcp-brand': manifest.color } as React.CSSProperties}
            aria-hidden="true"
          >
            <IntegrationLogo id={manifest.id} size={19} />
          </span>
          <span className="settings-mcp-connection-kind">
            {comingSoon ? 'API · Soon' : 'MCP'}
          </span>
        </div>
        <div className="settings-mcp-catalog-copy">
          <strong>{manifest.name}</strong>
          <p>{manifest.description}</p>
        </div>
        <button
          className="settings-btn"
          disabled={comingSoon || busy || connection?.status === 'connected'}
          onClick={() => void connectCatalogApp(manifest.id)}
        >
          {comingSoon
            ? 'Coming soon'
            : busy
              ? 'Opening…'
            : connection?.status === 'connected'
              ? 'Connected'
              : connection?.status === 'authorizing'
                ? 'Open sign-in again'
                : connection
                  ? 'Reconnect'
                  : 'Connect'}
        </button>
      </article>
    )
  }

  const renderApps = (): React.ReactNode => (
    <>
      <div className="settings-mcp-view-tabs" aria-label="App connection views">
        <button
          type="button"
          className={mcpView === 'connected' ? 'active' : undefined}
          onClick={() => {
            setMcpError(null)
            setMcpView('connected')
          }}
        >
          Connected
        </button>
        <button
          type="button"
          className={mcpView === 'browse' ? 'active' : undefined}
          onClick={() => {
            setMcpError(null)
            setMcpView('browse')
          }}
        >
          Browse
        </button>
        <button
          type="button"
          className={mcpView === 'agents' ? 'active' : undefined}
          onClick={() => {
            setMcpError(null)
            setMcpView('agents')
            void refreshLocalAgents()
          }}
        >
          Agents
        </button>
        <button
          type="button"
          className={mcpView === 'custom' ? 'active' : undefined}
          onClick={() => {
            setMcpError(null)
            setMcpView('custom')
          }}
        >
          Custom
        </button>
      </div>

      {mcpView === 'connected' && <Group label="Connected">
        {mcpConnections.length === 0 ? (
          <div className="settings-mcp-empty">
            <Plug size={17} />
            <div>
              <strong>No apps connected</strong>
              <span>Choose a supported app or connect a local agent.</span>
            </div>
            <button className="settings-btn" onClick={() => setMcpView('browse')}>Browse apps</button>
          </div>
        ) : (
          <div className="settings-mcp-list">
            {mcpConnections.map((connection) => {
              const expanded = mcpExpanded.has(connection.id)
              const tools = mcpTools[connection.id] ?? []
              const localAgent = localAgentManifest(connection.agentId)
              const apiComingSoon = connection.transport === 'api'
              return (
                <div className={expanded ? 'settings-mcp-item expanded' : 'settings-mcp-item'} key={connection.id}>
                  <div className="settings-mcp-row">
                    <button
                      type="button"
                      className="settings-mcp-disclosure"
                      aria-expanded={expanded}
                      aria-controls={`mcp-tools-${connection.id}`}
                      title={`${expanded ? 'Hide' : 'Show'} ${connection.name} tools`}
                      disabled={!connection.enabled || apiComingSoon}
                      onClick={() => void toggleMcpTools(connection)}
                    >
                      <ChevronRight size={13} />
                    </button>
                    {localAgent ? (
                      <span
                        className="settings-mcp-brand"
                        style={{ '--mcp-brand': localAgent.color } as React.CSSProperties}
                        aria-hidden="true"
                      >
                        <IntegrationLogo id={`agent:${localAgent.id}`} size={14} />
                      </span>
                    ) : integrationManifest(connection.catalogId) ? (
                      <span
                        className="settings-mcp-brand"
                        style={{
                          '--mcp-brand': integrationManifest(connection.catalogId)?.color
                        } as React.CSSProperties}
                        aria-hidden="true"
                      >
                        <IntegrationLogo id={connection.catalogId} size={14} />
                      </span>
                    ) : (
                      <span className={`settings-mcp-status ${connection.status}`} aria-hidden="true" />
                    )}
                    <button
                      type="button"
                      className="settings-mcp-copy"
                      disabled={!connection.enabled || apiComingSoon}
                      onClick={() => void toggleMcpTools(connection)}
                    >
                      <strong>{connection.name}</strong>
                      <span>
                        {apiComingSoon
                          ? 'Coming soon'
                          : connection.status === 'connected'
                          ? `${connection.toolCount} ${connection.toolCount === 1 ? 'tool' : 'tools'}`
                          : connection.status === 'authorizing'
                            ? 'Finish connecting in your browser…'
                          : connection.status === 'connecting'
                            ? 'Connecting…'
                            : connection.error ||
                              (connection.transport === 'stdio'
                                ? [connection.command, ...connection.args].filter(Boolean).join(' ')
                                : connection.transport === 'api'
                                  ? 'Direct API connection'
                                  : connection.transport === 'agent'
                                    ? 'Agent CLI unavailable'
                                    : connection.url)}
                      </span>
                      <small>{connection.source}</small>
                    </button>
                    <div className="settings-mcp-actions">
                      <Switch
                        checked={!apiComingSoon && connection.enabled}
                        disabled={apiComingSoon}
                        label={`${connection.enabled ? 'Disable' : 'Enable'} ${connection.name}`}
                        onToggle={() => {
                          if (connection.enabled) {
                            setMcpExpanded((current) => {
                              const next = new Set(current)
                              next.delete(connection.id)
                              return next
                            })
                          }
                          setMcpBusy(connection.id)
                          setMcpError(null)
                          void window.api.mcp
                            .setEnabled(connection.id, !connection.enabled)
                            .catch((error) =>
                              setMcpError(mcpErrorMessage(error, 'Could not update app.'))
                            )
                            .finally(() => setMcpBusy(null))
                        }}
                      />
                      <button
                        className="settings-icon-btn"
                        title={
                          connection.transport === 'agent'
                            ? 'Check agent'
                            : connection.status === 'connected'
                              ? 'Disconnect'
                              : 'Connect'
                        }
                        disabled={apiComingSoon || !connection.enabled || mcpBusy === connection.id}
                        onClick={() => {
                          setMcpBusy(connection.id)
                          setMcpError(null)
                          const task =
                            connection.status === 'connected' && connection.transport !== 'agent'
                              ? window.api.mcp.disconnect(connection.id)
                              : window.api.mcp.connect(connection.id)
                          void task
                            .then(() => {
                              if (
                                connection.status === 'connected' &&
                                connection.transport !== 'agent'
                              ) {
                                setMcpTools((current) => {
                                  const next = { ...current }
                                  delete next[connection.id]
                                  return next
                                })
                              }
                            })
                            .catch((error) =>
                              setMcpError(mcpErrorMessage(error, 'Connection failed.'))
                            )
                            .finally(() => setMcpBusy(null))
                        }}
                      >
                        <Refresh size={13} className={mcpBusy === connection.id ? 'spin' : undefined} />
                      </button>
                      <button
                        className="settings-icon-btn danger"
                        title={`Remove ${connection.name}`}
                        onClick={() => void window.api.mcp.remove(connection.id)}
                      >
                        <Trash size={13} />
                      </button>
                    </div>
                  </div>
                  {expanded && (
                    <div
                      className="settings-mcp-tools"
                      id={`mcp-tools-${connection.id}`}
                      role="region"
                      aria-label={`${connection.name} tools`}
                    >
                      {mcpToolsLoading[connection.id] ? (
                        <div className="settings-mcp-tools-state">
                          <Refresh size={12} className="spin" /> Discovering tools…
                        </div>
                      ) : mcpToolErrors[connection.id] ? (
                        <div className="settings-mcp-tools-state error">
                          {mcpToolErrors[connection.id]}
                        </div>
                      ) : tools.length ? (
                        tools.map((tool) => (
                          <div className="settings-mcp-tool" key={`${tool.connectionId}:${tool.name}`}>
                            <Tool size={12} />
                            <div>
                              <strong>{tool.title}</strong>
                              <span>
                                {tool.name}
                                {tool.description && tool.description !== tool.name
                                  ? ` · ${tool.description}`
                                  : ''}
                              </span>
                            </div>
                            <small className={tool.annotations?.destructiveHint ? 'writes' : undefined}>
                              {tool.annotations?.destructiveHint ? 'Writes' : tool.recipe.title}
                            </small>
                          </div>
                        ))
                      ) : (
                        <div className="settings-mcp-tools-state">This app exposes no tools.</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {mcpError && <div className="settings-mcp-error">{mcpError}</div>}
      </Group>}

      {mcpView === 'browse' && <Group label="Browse apps">
        <div className="settings-mcp-catalog-head">
          <label className="settings-mcp-search">
            <Search size={13} />
            <input
              value={mcpSearch}
              placeholder="Search apps or actions"
              onChange={(event) => setMcpSearch(event.target.value)}
            />
          </label>
        </div>
        <div className="settings-mcp-catalog-section">
          <header>
            <strong>Connect with MCP</strong>
            <span>Secure browser sign-in with automatic client registration.</span>
          </header>
          <div className="settings-mcp-catalog">
            {dynamicMcpCatalog.map(renderCatalogCard)}
          </div>
        </div>
        <div className="settings-mcp-catalog-section">
          <header>
            <strong>API integrations</strong>
            <span>OAuth connections for these apps are coming soon.</span>
          </header>
          <div className="settings-mcp-catalog">
            {apiCatalog.map(renderCatalogCard)}
          </div>
        </div>
        <div className="settings-mcp-catalog-results">
          {!filteredCatalog.length && (
            <div className="settings-mcp-catalog-empty">
              No matching apps. Add any MCP under Custom.
            </div>
          )}
        </div>
        {mcpError && <div className="settings-mcp-error">{mcpError}</div>}
      </Group>}

      {mcpView === 'agents' && <Group label="Agents on this Mac">
        <div className="settings-agent-head">
          <div>
            <strong>Delegate to an installed agent</strong>
            <span>Connected agents appear as reviewed Handoff options in notes and meeting notes.</span>
          </div>
          <button
            className="settings-icon-btn"
            title="Scan again"
            disabled={mcpBusy === 'agents:refresh'}
            onClick={() => void refreshLocalAgents()}
          >
            <Refresh size={13} className={mcpBusy === 'agents:refresh' ? 'spin' : undefined} />
          </button>
        </div>
        <div className="settings-agent-grid">
          {localAgents.map((agent) => {
            const busy = mcpBusy === `agent:${agent.id}`
            return (
              <article className={`settings-agent-card${agent.connected ? ' connected' : ''}`} key={agent.id}>
                <div className="settings-agent-card-head">
                  <span
                    className="settings-mcp-brand large"
                    style={{ '--mcp-brand': agent.color } as React.CSSProperties}
                    aria-hidden="true"
                  >
                    <IntegrationLogo id={`agent:${agent.id}`} size={19} />
                  </span>
                  <span className={`settings-agent-state${agent.installed ? ' installed' : ''}`}>
                    {agent.connected ? 'Connected' : agent.installed ? 'Installed' : 'Not found'}
                  </span>
                </div>
                <div className="settings-agent-copy">
                  <strong>{agent.name}</strong>
                  <p>{agent.description}</p>
                  <small title={agent.executablePath}>
                    {agent.installed ? agent.executablePath : `Install the ${agent.command} CLI, then scan again.`}
                  </small>
                </div>
                <button
                  className="settings-btn"
                  disabled={!agent.installed || busy}
                  onClick={() => void toggleLocalAgent(agent)}
                >
                  {busy ? 'Working…' : agent.connected ? 'Disconnect' : agent.installed ? 'Connect' : 'Unavailable'}
                </button>
              </article>
            )
          })}
        </div>
        {mcpError && <div className="settings-mcp-error">{mcpError}</div>}
      </Group>}

      {mcpView === 'custom' && <Group label="Add manually">
        <div className="settings-mcp-add-actions">
          <button className="settings-btn" onClick={() => setMcpAdding('local')}>
            <Plus size={13} /> Local server
          </button>
          <button className="settings-btn" onClick={() => setMcpAdding('remote')}>
            <Plus size={13} /> Remote server
          </button>
        </div>
        {mcpAdding && (
          <div className="settings-mcp-form">
            <input
              value={mcpName}
              placeholder="App name"
              autoFocus
              onChange={(event) => setMcpName(event.target.value)}
            />
            {mcpAdding === 'local' ? (
              <>
                <input
                  value={mcpCommand}
                  placeholder="Executable command, for example npx"
                  onChange={(event) => setMcpCommand(event.target.value)}
                />
                <textarea
                  value={mcpArgs}
                  rows={3}
                  placeholder={'One argument per line\n-y\n@modelcontextprotocol/server-memory'}
                  onChange={(event) => setMcpArgs(event.target.value)}
                />
              </>
            ) : (
              <>
                <input
                  value={mcpUrl}
                  placeholder="https://example.com/mcp"
                  onChange={(event) => setMcpUrl(event.target.value)}
                />
                <div className="settings-mcp-auth-options" aria-label="Authentication method">
                  {(['oauth', 'bearer', 'none'] as const).map((authMode) => (
                    <button
                      type="button"
                      className={mcpRemoteAuth === authMode ? 'active' : undefined}
                      key={authMode}
                      onClick={() => setMcpRemoteAuth(authMode)}
                    >
                      {authMode === 'oauth'
                        ? 'Browser sign-in'
                        : authMode === 'bearer'
                          ? 'Bearer token'
                          : 'No auth'}
                    </button>
                  ))}
                </div>
                {mcpRemoteAuth === 'bearer' && (
                  <input
                    value={mcpToken}
                    type="password"
                    placeholder="Bearer token"
                    onChange={(event) => setMcpToken(event.target.value)}
                  />
                )}
              </>
            )}
            <p>
              {mcpAdding === 'local'
                ? 'Local servers execute this exact command with your user permissions.'
                : 'OAuth opens a secure browser sign-in and stores tokens in Keychain-backed storage.'}
              {' '}Noteato still asks before invoking every write action.
            </p>
            <div className="settings-mcp-form-actions">
              <button className="settings-btn" onClick={resetMcpForm}>Cancel</button>
              <button
                className="settings-btn primary"
                disabled={
                  !mcpName.trim() ||
                  mcpBusy === 'add'
                }
                onClick={() => void addMcpConnection()}
              >
                {mcpBusy === 'add' ? 'Adding…' : 'Add app'}
              </button>
            </div>
          </div>
        )}
        {mcpError && <div className="settings-mcp-error">{mcpError}</div>}
      </Group>}
    </>
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <nav
          className="settings-nav"
          aria-label="Settings sections"
          onWheel={(event) => {
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
            event.currentTarget.scrollLeft += event.deltaY
            event.preventDefault()
          }}
        >
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
            ) : tab === 'apps' ? (
              renderApps()
            ) : (
              renderSpeech(settings)
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
