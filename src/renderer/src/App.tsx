import { useMemo } from 'react'
import StickyNoteWindow from './components/StickyNoteWindow'
import MainLayout from './components/MainLayout'

export default function App() {
  const stickyId = useMemo(() => new URLSearchParams(window.location.search).get('sticky'), [])

  if (stickyId) return <StickyNoteWindow id={stickyId} />
  return <MainLayout />
}
