import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { Settings } from '../shared/types'
import { JsonStore } from './jsonStore'

export function createSettingsStore(): JsonStore<Settings> {
  const filePath = join(app.getPath('userData'), 'settings.json')
  // Existing installations predate onboarding and should not be interrupted.
  // Fresh installs start incomplete; once the field has been written, preserve
  // it so closing halfway through onboarding resumes at setup on the next run.
  let onboardingCompleted = false
  if (existsSync(filePath)) {
    try {
      const stored = JSON.parse(readFileSync(filePath, 'utf-8'))
      onboardingCompleted =
        typeof stored.onboardingCompleted === 'boolean' ? stored.onboardingCompleted : true
    } catch {
      onboardingCompleted = true
    }
  }

  return new JsonStore<Settings>(filePath, {
    onboardingCompleted,
    userName: '',
    licenseKey: '',
    syncPreference: 'none',
    deepgramApiKey: '',
    notesDir: null,
    theme: 'light',
    fontFamily: 'system',
    accent: 'ember',
    zenMode: false,
    aiProvider: 'none',
    aiModel: '',
    anthropicApiKey: '',
    openaiApiKey: '',
    aiSelectionActions: true,
    aiAgentEnabled: false,
    homeAssistantEnabled: true,
    keepInMenuBar: true,
    sidebarModeEnabled: true,
    sidebarPinned: true,
    quickNoteShortcutEnabled: true,
    spellcheckLanguage: 'auto'
  })
}
