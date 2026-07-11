import { BlockNoteEditor, BlockNoteSchema, defaultInlineContentSpecs } from '@blocknote/core'
import { createReactInlineContentSpec } from '@blocknote/react'
import { FileText } from 'lucide-react'

// Note mentions are stored in markdown as "[Title](#note/<id>)". Ids survive
// the target being moved or renamed (paths don't), and a fragment href passes
// BlockNote's link protocol allowlist — a custom "note:" scheme would be
// stripped when the markdown is parsed back on reopen. linkifyBlocks converts
// these links into noteLink inline content after every markdown parse.
export const NOTE_LINK_PREFIX = '#note/'

// Fired by a mention chip (rendered deep inside BlockNote) to ask the app
// shell to open the target note in a tab. detail = the note id.
export const OPEN_NOTE_LINK_EVENT = 'noteato:open-note-link'

export function emitOpenNoteLink(noteId: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_NOTE_LINK_EVENT, { detail: noteId }))
}

// Notion-style page mention: an atomic inline chip, not editable link text.
const NoteLinkMention = createReactInlineContentSpec(
  {
    type: 'noteLink',
    propSchema: {
      noteId: { default: '' },
      title: { default: 'Untitled' }
    },
    content: 'none'
  },
  {
    render: (props) => (
      <span
        className="note-link-mention"
        role="link"
        title="Open note"
        onClick={() => emitOpenNoteLink(props.inlineContent.props.noteId)}
      >
        <FileText size={12} />
        <span>{props.inlineContent.props.title}</span>
      </span>
    ),
    // Markdown export goes through external HTML, so a mention serializes back
    // to the "[Title](#note/<id>)" link form.
    toExternalHTML: (props) => (
      <a href={`${NOTE_LINK_PREFIX}${props.inlineContent.props.noteId}`}>
        {props.inlineContent.props.title}
      </a>
    )
  }
)

export const noteatoSchema = BlockNoteSchema.create({
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    noteLink: NoteLinkMention
  }
})

export type NoteatoEditor = typeof noteatoSchema.BlockNoteEditor
export type NoteatoBlock = typeof noteatoSchema.Block

export function createNoteatoEditor(initialContent?: NoteatoBlock[]): NoteatoEditor {
  return BlockNoteEditor.create({ schema: noteatoSchema, initialContent })
}
