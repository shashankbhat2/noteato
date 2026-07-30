import { useEffect, useMemo, useState } from 'react'
import type { Settings } from '../../shared/types'
import MainLayout from './components/MainLayout'
import SidebarModeWindow from './components/SidebarModeWindow'
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
  const sidebarMode = useMemo(
    () => new URLSearchParams(window.location.search).get('sidebar') === '1',
    []
  )

  if (sidebarMode) return <SidebarModeWindow />
  return <MainWindow />
}
