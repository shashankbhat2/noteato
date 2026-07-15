import { useMemo } from 'react'
import StickyNoteWindow from './components/StickyNoteWindow'
import MainLayout from './components/MainLayout'
import SidebarModeWindow from './components/SidebarModeWindow'
import QuickNoteWindow from './components/QuickNoteWindow'

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
  return <MainLayout />
}
