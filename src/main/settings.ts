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
  // Meetings predate the gate, so an install that already exists keeps them.
  // Only a fresh install starts gated, and onboarding writes the real value.
  let meetingNotesEnabled = false
  if (existsSync(filePath)) {
    try {
      const stored = JSON.parse(readFileSync(filePath, 'utf-8'))
      onboardingCompleted =
        typeof stored.onboardingCompleted === 'boolean' ? stored.onboardingCompleted : true
      meetingNotesEnabled =
        typeof stored.meetingNotesEnabled === 'boolean' ? stored.meetingNotesEnabled : true
    } catch {
      onboardingCompleted = true
      meetingNotesEnabled = true
    }
  }

  return new JsonStore<Settings>(filePath, {
    onboardingCompleted,
    meetingNotesEnabled,
    userName: '',
    licenseKey: '',
    syncPreference: 'none',
    deepgramApiKey: '',
    notesDir: null,
    preRollSeconds: 10,
    theme: 'light',
    fontFamily: 'system',
    accent: 'neutral',
    aiProvider: 'openai',
    aiModel: 'auto',
    anthropicApiKey: '',
    openaiApiKey: '',
    xaiApiKey: '',
    aiSelectionActions: true,
    keepInMenuBar: true,
    sidebarModeEnabled: true,
    sidebarPinned: true,
    sidebarEdge: 'left',
    sidebarHoverReveal: true,
    sidebarHoverDelay: 400,
    spellcheckLanguage: 'auto'
  })
}
