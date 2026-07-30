import {
  IconArrowBackUp as RestoreIcon,
  IconFileText as FileText,
  IconFolder as Folder,
  IconTrash as Trash,
  IconTrashX as TrashX
} from '@tabler/icons-react'
import type { TrashEntry } from '../../../shared/types'

interface Props {
  trash: TrashEntry[]
  onRestore: (entry: TrashEntry) => void
  onPurge: (entry: TrashEntry) => void
  onEmpty: () => void
  /** This pane's move/close controls; empty when only one pane is open. */
  paneControls?: React.ReactNode
}

function formatDeletedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function originalFolder(entry: TrashEntry): string {
  const slash = entry.originalPath.lastIndexOf('/')
  return slash === -1 ? '' : entry.originalPath.slice(0, slash)
}

/** Full-pane Trash view: everything deleted, restorable until purged. */
export default function TrashView({
  trash,
  onRestore,
  onPurge,
  onEmpty,
  paneControls
}: Props) {
  return (
    <div className="trash-view">
      <header className="trash-view-header">
        <h1>
          <Trash size={18} />
          <span>Trash</span>
          {trash.length > 0 && <span className="trash-view-count">{trash.length}</span>}
        </h1>
        <div className="view-header-actions">
          {trash.length > 0 && (
            <button className="trash-empty-btn" onClick={onEmpty}>
              <TrashX size={14} />
              <span>Empty Trash</span>
            </button>
          )}
          {paneControls}
        </div>
      </header>
      <p className="trash-view-hint">
        Deleted notes and folders stay here until you restore them or delete them forever.
      </p>

      {trash.length === 0 ? (
        <div className="trash-view-empty">Trash is empty.</div>
      ) : (
        <ul className="trash-view-list">
          {trash.map((entry) => (
            <li key={entry.trashName} className="trash-view-item">
              <span className="trash-glyph">
                {entry.isFolder ? <Folder size={16} /> : <FileText size={16} />}
              </span>
              <span className="trash-view-copy">
                <span className="trash-view-title">{entry.title || 'Untitled'}</span>
                <span className="trash-view-meta">
                  {[originalFolder(entry), formatDeletedAt(entry.deletedAt)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="trash-view-actions">
                <button onClick={() => onRestore(entry)}>
                  <RestoreIcon size={13} />
                  <span>Restore</span>
                </button>
                <button className="danger" onClick={() => onPurge(entry)}>
                  <Trash size={13} />
                  <span>Delete forever</span>
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
