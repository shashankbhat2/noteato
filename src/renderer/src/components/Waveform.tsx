import { useEffect, useRef } from 'react'

interface Props {
  analyser: AnalyserNode | null
  active: boolean
}

// A thin oscilloscope line (time-domain) — flat when silent, wiggling while
// speaking. Much lighter than the old frequency-bar look.
export default function Waveform({ analyser, active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!active || !analyser) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const dpr = window.devicePixelRatio || 1
    const cssWidth = canvas.clientWidth
    const cssHeight = canvas.clientHeight
    canvas.width = cssWidth * dpr
    canvas.height = cssHeight * dpr
    ctx.scale(dpr, dpr)

    const lineColor =
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#a1523c'

    const bufferLength = analyser.fftSize
    const data = new Uint8Array(bufferLength)

    const draw = (): void => {
      rafRef.current = requestAnimationFrame(draw)
      analyser.getByteTimeDomainData(data)
      ctx.clearRect(0, 0, cssWidth, cssHeight)
      ctx.lineWidth = 1.5
      ctx.strokeStyle = lineColor
      ctx.lineJoin = 'round'
      ctx.beginPath()

      const mid = cssHeight / 2
      for (let i = 0; i < bufferLength; i++) {
        const x = (i / (bufferLength - 1)) * cssWidth
        const y = mid + ((data[i] - 128) / 128) * (mid - 1)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    draw()
    return () => cancelAnimationFrame(rafRef.current)
  }, [active, analyser])

  return <canvas ref={canvasRef} className="waveform-canvas" />
}
