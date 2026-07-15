import { useEffect, useRef, useState } from 'react'
import {
  IconExternalLink as ExternalLink,
  IconKeyboard as Keyboard,
  IconSettings as SettingsIcon
} from '@tabler/icons-react'
import type { Settings } from '../../../shared/types'
import {
  QUICK_NOTE_ACCELERATOR,
  SIDEBAR_MODE_ACCELERATOR,
  shortcutDisplay
} from '../../../shared/globalShortcuts'

export default function SidebarSettingsPopover({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const platform = window.electron.process.platform

  useEffect(() => {
    void window.api.settings.get().then(setSettings)
    const closeOnOutsideClick = (event: MouseEvent): void => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) onClose()
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  const update = (patch: Partial<Settings>): void => {
    if (!settings) return
    setSettings({ ...settings, ...patch })
    void window.api.settings.set(patch).then(setSettings)
  }

  return (
    <div className="sidebar-settings-popover" ref={popoverRef}>
      <div className="sidebar-settings-heading">
        <SettingsIcon size={14} />
        <span>Sidebar settings</span>
      </div>

      <div className="sidebar-settings-shortcut">
        <Keyboard size={13} />
        <span>Show or hide sidebar</span>
        <kbd>{shortcutDisplay(SIDEBAR_MODE_ACCELERATOR, platform)}</kbd>
      </div>

      <div className="sidebar-settings-divider" />

      <div className="sidebar-settings-row">
        <div>
          <strong>Quick note shortcut</strong>
          <span>{shortcutDisplay(QUICK_NOTE_ACCELERATOR, platform)}</span>
        </div>
        <button
          className={settings?.quickNoteShortcutEnabled ? 'settings-switch on' : 'settings-switch'}
          onClick={() =>
            update({ quickNoteShortcutEnabled: !settings?.quickNoteShortcutEnabled })
          }
          role="switch"
          aria-checked={Boolean(settings?.quickNoteShortcutEnabled)}
          disabled={!settings}
        >
          <span className="settings-switch-knob" />
        </button>
      </div>

      <div className="sidebar-settings-row">
        <div>
          <strong>Keep in menu bar</strong>
          <span>Available after closing Noteato</span>
        </div>
        <button
          className={settings?.keepInMenuBar ? 'settings-switch on' : 'settings-switch'}
          onClick={() => update({ keepInMenuBar: !settings?.keepInMenuBar })}
          role="switch"
          aria-checked={Boolean(settings?.keepInMenuBar)}
          disabled={!settings}
        >
          <span className="settings-switch-knob" />
        </button>
      </div>

      <button
        className="sidebar-open-settings"
        onClick={() => {
          onClose()
          void window.api.app.openSettings()
        }}
      >
        <span>Open full settings</span>
        <ExternalLink size={13} />
      </button>
    </div>
  )
}
