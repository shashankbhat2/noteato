import { useEffect, useRef } from 'react'

interface Props {
  analyser: AnalyserNode | null
  active: boolean
}

const BAR_COUNT = 28

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

    const bufferLength = analyser.frequencyBinCount
    const data = new Uint8Array(bufferLength)
    const step = Math.max(1, Math.floor(bufferLength / BAR_COUNT))
    const barColor =
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#a1523c'

    const draw = (): void => {
      rafRef.current = requestAnimationFrame(draw)
      analyser.getByteFrequencyData(data)
      ctx.clearRect(0, 0, cssWidth, cssHeight)
      ctx.fillStyle = barColor

      const barWidth = cssWidth / BAR_COUNT
      const gap = barWidth * 0.35
      const w = barWidth - gap

      for (let i = 0; i < BAR_COUNT; i++) {
        const value = data[i * step] / 255
        const barHeight = Math.max(3, value * cssHeight)
        const x = i * barWidth
        const y = (cssHeight - barHeight) / 2
        const r = Math.min(w / 2, 2)
        ctx.beginPath()
        ctx.roundRect(x, y, w, barHeight, r)
        ctx.fill()
      }
    }

    draw()
    return () => cancelAnimationFrame(rafRef.current)
  }, [active, analyser])

  return <canvas ref={canvasRef} className="waveform-canvas" />
}
