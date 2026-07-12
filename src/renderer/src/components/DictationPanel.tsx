import { IconMicrophone as Mic, IconSquare as Square } from '@tabler/icons-react'
import type { NoteatoEditor } from '../noteLink'
import { useDictation } from '../dictation/useDictation'
import Waveform from './Waveform'

export default function DictationPanel({ editor }: { editor: NoteatoEditor }) {
  const { isRecording, error, analyser, toggle } = useDictation(editor)

  return (
    <div className="dictation-panel">
      <div className={isRecording ? 'dictation-bar recording' : 'dictation-bar'}>
        <button
          className="dictation-toggle-btn"
          onClick={toggle}
          title={isRecording ? 'Stop dictation' : 'Start dictation'}
        >
          {isRecording ? <Square size={10} fill="currentColor" /> : <Mic size={14} />}
        </button>
        {isRecording && <Waveform analyser={analyser} active={isRecording} />}
      </div>
      {error && <div className="dictation-panel-error">{error}</div>}
    </div>
  )
}
