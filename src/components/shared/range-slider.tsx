'use client'

import { useCallback, useRef } from 'react'

// Custom dual-handle slider (not two overlapping <input type="range"> — that trick fights
// itself when both thumbs are near the same value). Drag state lives on the DOM via
// setPointerCapture, so move/up listeners stay attached to the captured thumb even once
// the cursor leaves the track.
export function RangeSlider({
  min, max, step = 1, value, onChange, formatLabel,
}: {
  min: number
  max: number
  step?: number
  value: [number, number]
  onChange: (value: [number, number]) => void
  formatLabel?: (v: number) => string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const valueRef = useRef(value)
  valueRef.current = value

  const pct = (v: number) => ((v - min) / (max - min)) * 100

  const valueFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current
    if (!track) return min
    const rect = track.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return Math.round((min + ratio * (max - min)) / step) * step
  }, [min, max, step])

  function startDrag(thumb: 'lo' | 'hi') {
    return (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault()
      const button = e.currentTarget
      button.setPointerCapture(e.pointerId)
      const handleMove = (ev: PointerEvent) => {
        const v = valueFromClientX(ev.clientX)
        const [lo, hi] = valueRef.current
        onChange(thumb === 'lo' ? [Math.min(v, hi), hi] : [lo, Math.max(v, lo)])
      }
      const handleUp = () => {
        button.removeEventListener('pointermove', handleMove)
        button.removeEventListener('pointerup', handleUp)
      }
      button.addEventListener('pointermove', handleMove)
      button.addEventListener('pointerup', handleUp)
    }
  }

  const label = formatLabel ?? ((v: number) => String(v))

  return (
    <div className="pt-3 pb-1 px-1">
      <div ref={trackRef} className="relative h-1.5 rounded-full" style={{ background: 'var(--color-border)' }}>
        <div className="absolute h-1.5 rounded-full" style={{ left: `${pct(value[0])}%`, right: `${100 - pct(value[1])}%`, background: 'var(--navbar-bg)' }} />
        {(['lo', 'hi'] as const).map(thumb => (
          <button key={thumb} type="button" aria-label={thumb === 'lo' ? 'Valeur minimum' : 'Valeur maximum'}
            onPointerDown={startDrag(thumb)}
            className="mbc-range-thumb absolute top-1/2 h-5 w-5 rounded-full touch-none"
            style={{ left: `${pct(thumb === 'lo' ? value[0] : value[1])}%`, background: 'var(--navbar-bg)', border: '3px solid var(--color-surface)' }}
          />
        ))}
      </div>
      <div className="flex justify-between mt-2.5 text-xs font-bold" style={{ color: 'var(--color-text)' }}>
        <span>{label(value[0])}</span>
        <span>{label(value[1])}</span>
      </div>
    </div>
  )
}
