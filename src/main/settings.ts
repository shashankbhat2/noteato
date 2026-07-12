import { join } from 'path'
import { app } from 'electron'
import type { Settings } from '../shared/types'
import { JsonStore } from './jsonStore'

export function createSettingsStore(): JsonStore<Settings> {
  return new JsonStore<Settings>(join(app.getPath('userData'), 'settings.json'), {
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
    keepInMenuBar: false
  })
}
