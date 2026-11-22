import { useEffect, useRef, type ReactElement } from 'react'

interface WaveformProps {
  peaks: number[] | null
  duration: number
  maxDuration: number
  color: string
  label: string
  playhead?: number
  emptyText?: string
}

export default function Waveform({
  peaks,
  duration,
  maxDuration,
  color,
  label,
  playhead = 0,
  emptyText = '暂无波形'
}: WaveformProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const draw = (): void => {
      const rect = canvas.getBoundingClientRect()
      const width = Math.max(1, rect.width)
      const height = Math.max(1, rect.height)
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)

      const mid = height / 2
      context.fillStyle = 'rgba(255, 255, 255, 0.055)'
      context.fillRect(0, mid, width, 1)

      if (peaks && peaks.length > 0 && maxDuration > 0) {
        const drawableWidth =
          Math.min(1, Math.max(0, duration / maxDuration)) * width
        const barWidth = 2
        const gap = 1
        const count = Math.max(
          1,
          Math.floor((drawableWidth - 2 + gap) / (barWidth + gap))
        )
        const maxAmplitude = mid - 5
        context.fillStyle = color
        for (let index = 0; index < count; index += 1) {
          const peak =
            peaks[Math.min(peaks.length - 1, Math.floor((index / count) * peaks.length))] ??
            0
          const amplitude = Math.max(0.025, peak) * maxAmplitude
          const x = 1 + index * (barWidth + gap)
          context.fillRect(x, mid - amplitude, barWidth, amplitude * 2)
        }
      }

      if (playhead > 0 && maxDuration > 0) {
        const x = Math.min(width - 1, (playhead / maxDuration) * width)
        context.fillStyle = 'rgba(232, 238, 247, 0.7)'
        context.fillRect(x, 3, 1, height - 6)
      }
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [peaks, duration, maxDuration, color, playhead])

  return (
    <div className="waveform-row">
      <div className="waveform-label">
        <span className="waveform-dot" style={{ background: color }} />
        <span>{label}</span>
        <span className="waveform-duration">{duration.toFixed(1)}s</span>
      </div>
      <div className="waveform-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="waveform-canvas"
          aria-label={`${label}，时长 ${duration.toFixed(1)} 秒`}
        />
        {!peaks ? <span className="waveform-empty">{emptyText}</span> : null}
      </div>
    </div>
  )
}
