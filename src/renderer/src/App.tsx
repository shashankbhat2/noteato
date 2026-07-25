import { useEffect, useMemo, useState } from 'react'
import type { Settings } from '../../shared/types'
import StickyNoteWindow from './components/StickyNoteWindow'
import MainLayout from './components/MainLayout'
import SidebarModeWindow from './components/SidebarModeWindow'
import QuickNoteWindow from './components/QuickNoteWindow'
import OnboardingView from './components/OnboardingView'

function MainWindow() {
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    void window.api.settings.get().then(setSettings)
  }, [])

  if (!settings) return <div className="app-loading" />
  if (!settings.onboardingCompleted) {
    return (
      <OnboardingView
        initialSettings={settings}
        onComplete={() => setSettings((current) => current && { ...current, onboardingCompleted: true })}
      />
    )
  }
  return <MainLayout />
}

export default function App() {
  const stickyId = useMemo(() => new URLSearchParams(window.location.search).get('sticky'), [])
  const sidebarMode = useMemo(
    () => new URLSearchParams(window.location.search).get('sidebar') === '1',
    []
  )
  const quickNoteId = useMemo(
    () => new URLSearchParams(window.location.search).get('quickNote'),
    []
  )

  if (stickyId) return <StickyNoteWindow id={stickyId} />
  if (sidebarMode) return <SidebarModeWindow />
  if (quickNoteId) return <QuickNoteWindow id={quickNoteId} />
  return <MainWindow />
}
