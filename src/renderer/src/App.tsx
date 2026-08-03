import { useEffect, useMemo, useState } from 'react'
import type { Settings } from '../../shared/types'
import MainLayout from './components/MainLayout'
import SidebarModeWindow from './components/SidebarModeWindow'
import OnboardingView from './components/OnboardingView'
import RecorderPill from './components/RecorderPill'

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
  const route = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('recorder') === '1') return 'recorder'
    if (params.get('sidebar') === '1') return 'sidebar'
    return 'main'
  }, [])

  // The pill's window is transparent; the shared stylesheet paints a background
  // on html/body that would otherwise show up as an opaque rectangle around it.
  useEffect(() => {
    if (route !== 'recorder') return
    document.documentElement.classList.add('recorder-window')
    return () => document.documentElement.classList.remove('recorder-window')
  }, [route])

  if (route === 'recorder') return <RecorderPill />
  if (route === 'sidebar') return <SidebarModeWindow />
  return <MainWindow />
}
