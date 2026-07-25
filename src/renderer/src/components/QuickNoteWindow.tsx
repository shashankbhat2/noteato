import { useEffect, useState } from 'react'
import { IconX as X } from '@tabler/icons-react'
import type { ScratchNote } from '../../../shared/types'
import {
  QUICK_NOTE_ACCELERATOR,
  shortcutDisplay
} from '../../../shared/globalShortcuts'
import noteatoIcon from '../../../../build/icon.png'
import ScratchEditor from './ScratchEditor'

export default function QuickNoteWindow({ id }: { id: string }) {
  const [note, setNote] = useState<ScratchNote | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let cancelled = false
    void window.api.scratch.read(id).then((loaded) => {
      if (!cancelled) setNote(loaded)
    })
    const unsubscribe = window.api.scratch.subscribeChanged((change) => {
      if (change.kind === 'remove' && change.id === id) {
        void window.api.quickNote.close()
      } else if (change.kind === 'upsert' && change.note.id === id) {
        setNote(change.note)
        setRevision((current) => current + 1)
      }
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [id])

  return (
    <div className="quick-note-shell">
      <header className="quick-note-titlebar">
        <div className="quick-note-identity">
          <img src={noteatoIcon} alt="" className="compact-noteato-icon" />
          <span>Quick note</span>
        </div>
        <div className="quick-note-titlebar-actions">
          <kbd>{shortcutDisplay(QUICK_NOTE_ACCELERATOR, window.electron.process.platform)}</kbd>
          <button onClick={() => void window.api.quickNote.close()} title="Close quick note">
            <X size={16} />
          </button>
        </div>
      </header>
      {note ? (
        <ScratchEditor
          key={`${note.id}:${revision}`}
          note={note}
          onSaved={(saved) => setNote(saved)}
        />
      ) : (
        <div className="sidebar-mode-loading">Preparing a quick note…</div>
      )}
    </div>
  )
}
