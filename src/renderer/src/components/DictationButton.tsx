import { Mic, Square } from 'lucide-react'
import type { BlockNoteEditor } from '@blocknote/core'
import { useDictation } from '../dictation/useDictation'

export default function DictationButton({ editor }: { editor: BlockNoteEditor }) {
  const { isRecording, error, toggle } = useDictation(editor)

  return (
    <div className="dictation-control">
      <button
        className={isRecording ? 'dictation-btn recording' : 'dictation-btn'}
        onClick={toggle}
        title={isRecording ? 'Stop dictation' : 'Start dictation'}
      >
        {isRecording ? <Square size={13} /> : <Mic size={13} />}
        <span>{isRecording ? 'Stop' : 'Dictate'}</span>
      </button>
      {error && <span className="dictation-error">{error}</span>}
    </div>
  )
}
