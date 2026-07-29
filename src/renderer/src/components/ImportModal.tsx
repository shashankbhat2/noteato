import {
  IconBrandNotion as NotionIcon,
  IconDiamond as ObsidianIcon,
  IconFileTypeDocx as DocxIcon,
  IconFileTypeHtml as HtmlIcon,
  IconMarkdown as MarkdownIcon,
  IconNotebook as OneNoteIcon,
  IconX as X
} from '@tabler/icons-react'

interface Props {
  /** Pick markdown files or a folder to bring in. */
  onImportMarkdown: () => void
  /** Opens the Notion export walkthrough. */
  onImportNotion: () => void
  onClose: () => void
}

/**
 * Bringing notes in is a one-off errand, not something to keep a permanent
 * shelf for in the sidebar — so it's a modal, opened from the sidebar's entry.
 */
export default function ImportModal({ onImportMarkdown, onImportNotion, onClose }: Props) {
  const sources: {
    label: string
    hint: string
    icon: React.ReactNode
    onClick?: () => void
    soon?: boolean
  }[] = [
    {
      label: 'Markdown files',
      hint: 'A folder or a handful of .md files',
      icon: <MarkdownIcon size={18} />,
      onClick: onImportMarkdown
    },
    {
      label: 'Notion export',
      hint: 'The .zip Notion gives you',
      icon: <NotionIcon size={18} />,
      onClick: onImportNotion
    },
    // The badge already says these aren't ready — the hint says what they'll take.
    {
      label: 'Obsidian vault',
      hint: 'A vault folder',
      icon: <ObsidianIcon size={18} />,
      soon: true
    },
    { label: 'HTML', hint: 'Exported .html pages', icon: <HtmlIcon size={18} />, soon: true },
    { label: 'OneNote', hint: 'A notebook export', icon: <OneNoteIcon size={18} />, soon: true },
    { label: 'Word (.docx)', hint: 'Word documents', icon: <DocxIcon size={18} />, soon: true }
  ]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="import-modal-header">
          <div>
            <h2>Import notes</h2>
            <p>Everything lands in your notes folder as plain Markdown.</p>
          </div>
          <button className="modal-close-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="import-sources">
          {sources.map((source) => (
            <button
              key={source.label}
              className="import-source"
              disabled={source.soon}
              onClick={() => {
                source.onClick?.()
                if (source.onClick) onClose()
              }}
            >
              <span className="import-source-icon">{source.icon}</span>
              <span className="import-source-text">
                <strong>{source.label}</strong>
                <span>{source.hint}</span>
              </span>
              {source.soon && <span className="soon-badge">Coming soon</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
