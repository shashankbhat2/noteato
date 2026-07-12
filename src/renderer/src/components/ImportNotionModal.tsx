import { useEffect } from 'react'
import { IconBrandNotion as NotionLogo, IconX as X } from '@tabler/icons-react'

interface Props {
  onClose: () => void
  onImport: () => void
}

const STEPS = [
  'In Notion, open the page or workspace you want to export.',
  'Click the "•••" menu in the top right, then choose Export.',
  'Set the export format to Markdown & CSV, and pick a scope (just this page, or everything).',
  'Click Export — Notion downloads a .zip (or emails you one, for large workspaces).',
  'Unzip it — double-clicking in Finder does this automatically.',
  'Click "Choose export folder…" below and select the unzipped folder.'
]

export default function ImportNotionModal({ onClose, onImport }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal import-notion-modal" onClick={(e) => e.stopPropagation()}>
        <div className="import-notion-preview">
          <NotionLogo size={40} />
          <span>Preview coming soon</span>
        </div>
        <div className="import-notion-content">
          <div className="import-notion-header">
            <h1>Import from Notion</h1>
            <button className="modal-close-btn" onClick={onClose} title="Close">
              <X size={16} />
            </button>
          </div>
          <ol className="import-notion-steps">
            {STEPS.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <p className="hint">
            Pages become notes and sub-pages become nested folders, with internal page links and
            images carried over. Database exports come in as plain .csv files.
          </p>
          <div className="import-notion-actions">
            <button className="import-notion-cancel" onClick={onClose}>
              Cancel
            </button>
            <button className="import-notion-submit" onClick={onImport}>
              Choose export folder…
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
