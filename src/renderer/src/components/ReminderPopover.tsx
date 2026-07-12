import { useEffect, useRef } from 'react'
import { IconBellOff as BellOff, IconClock as Clock } from '@tabler/icons-react'
import { REMINDER_PRESETS } from '../reminderPresets'

const POPOVER_WIDTH = 240

function toLocalInputValue(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

interface Props {
  position: { x: number; y: number } | null
  value: string | null
  onSet: (iso: string) => void
  onClear: () => void
  onClose: () => void
}

export default function ReminderPopover({ position, value, onSet, onClear, onClose }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const submitCustom = (): void => {
    const raw = inputRef.current?.value
    if (!raw) return
    onSet(new Date(raw).toISOString())
  }

  const left = position
    ? Math.min(Math.max(position.x, 12), window.innerWidth - POPOVER_WIDTH - 12)
    : (window.innerWidth - POPOVER_WIDTH) / 2
  const top = position ? Math.min(position.y, window.innerHeight - 260) : 120

  return (
    <div
      className="ai-popup reminder-popover"
      ref={wrapperRef}
      style={{ left, top, width: POPOVER_WIDTH }}
    >
      <div className="ai-popup-presets">
        {REMINDER_PRESETS.map((preset) => (
          <button
            key={preset.label}
            className="ai-popup-preset"
            onClick={() => onSet(preset.at())}
          >
            <Clock size={13} />
            <span>{preset.label}</span>
          </button>
        ))}
      </div>
      <div className="reminder-popover-custom">
        <input
          ref={inputRef}
          type="datetime-local"
          className="reminder-popover-input"
          defaultValue={toLocalInputValue(
            value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000)
          )}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitCustom()
          }}
        />
        <button className="reminder-popover-set" onClick={submitCustom}>
          Set
        </button>
      </div>
      {value && (
        <button className="ai-popup-preset reminder-popover-clear" onClick={onClear}>
          <BellOff size={13} />
          <span>Clear reminder</span>
        </button>
      )}
    </div>
  )
}
