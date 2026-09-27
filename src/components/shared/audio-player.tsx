'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Pause, Download, Loader2, SkipBack, SkipForward } from 'lucide-react'

const BAR_COUNT = 56

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// Decodes the audio once client-side (Web Audio API — same approach already used for the
// interview mic mixing graph) to draw a real waveform instead of a plain progress bar.
// Best-effort: some browsers/media types can fail to decode, in which case we fall back to
// a plain bar so playback still works.
function usePeaks(src: string) {
  const [peaks, setPeaks] = useState<number[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(src)
        const buf = await res.arrayBuffer()
        const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new AudioCtx()
        const audioBuffer = await ctx.decodeAudioData(buf)
        const data = audioBuffer.getChannelData(0)
        const blockSize = Math.max(1, Math.floor(data.length / BAR_COUNT))
        const result: number[] = []
        for (let i = 0; i < BAR_COUNT; i++) {
          const start = i * blockSize
          let sum = 0
          for (let j = 0; j < blockSize; j++) sum += Math.abs(data[start + j] ?? 0)
          result.push(sum / blockSize)
        }
        const max = Math.max(...result, 0.0001)
        if (!cancelled) setPeaks(result.map(v => Math.min(1, (v / max) * 1.15)))
        await ctx.close()
      } catch {
        if (!cancelled) setPeaks(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [src])

  return { peaks, loading }
}

export function AudioPlayer({
  src, label, sublabel, accentColor = 'var(--color-primary)', downloadName, dark = false,
}: {
  src: string
  label: string
  sublabel?: string
  accentColor?: string
  downloadName?: string
  dark?: boolean
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const waveRef = useRef<HTMLDivElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const { peaks, loading } = usePeaks(src)

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) audio.pause()
    else audio.play().catch(() => {})
  }, [playing])

  const seekToClientX = useCallback((clientX: number) => {
    const audio = audioRef.current
    const wave = waveRef.current
    if (!audio || !wave || !duration) return
    const rect = wave.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    audio.currentTime = ratio * duration
  }, [duration])

  const progress = duration ? current / duration : 0

  const text = dark ? 'rgba(255,255,255,0.75)' : 'var(--color-text)'
  const muted = dark ? 'rgba(255,255,255,0.35)' : 'var(--color-text-muted)'
  const surface = dark ? 'rgba(255,255,255,0.03)' : 'var(--color-surface)'
  const border = dark ? 'rgba(255,255,255,0.08)' : 'var(--color-border)'
  const trackColor = dark ? 'rgba(255,255,255,0.12)' : 'var(--color-border)'

  return (
    <div className="mbc-audio-player rounded-2xl p-4" style={{ background: surface, border: `1px solid ${border}` }}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={e => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
        onEnded={() => setPlaying(false)}
      />

      <div className="flex items-center gap-3 mb-3">
        <button type="button" onClick={togglePlay}
          className="mbc-audio-playbtn shrink-0 flex items-center justify-center rounded-full"
          style={{ width: 38, height: 38, background: accentColor, color: 'white' }}
          aria-label={playing ? 'Pause' : 'Lecture'}>
          {playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="h-4 w-4 ml-0.5" fill="currentColor" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold truncate" style={{ color: text }}>{label}</p>
          {sublabel && <p className="text-xs truncate" style={{ color: muted }}>{sublabel}</p>}
        </div>
        {downloadName && (
          <a href={src} download={downloadName}
            className="mbc-audio-download shrink-0 flex items-center justify-center rounded-full"
            style={{ width: 30, height: 30, color: muted, border: `1px solid ${border}` }}
            title="Télécharger">
            <Download className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      <div ref={waveRef}
        className="mbc-audio-wave relative flex items-center gap-[2px] cursor-pointer"
        style={{ height: 36 }}
        onClick={e => seekToClientX(e.clientX)}>
        {loading ? (
          <div className="flex items-center gap-2 text-xs" style={{ color: muted }}>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement de la piste…
          </div>
        ) : peaks ? (
          peaks.map((p, i) => (
            <div key={i} className="flex-1 rounded-full mbc-audio-bar"
              style={{
                height: `${Math.max(p * 100, 10)}%`,
                background: i / BAR_COUNT <= progress ? accentColor : trackColor,
              }} />
          ))
        ) : (
          <div className="w-full rounded-full" style={{ height: 6, background: trackColor, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0, width: `${progress * 100}%`, background: accentColor }} />
          </div>
        )}
      </div>

      <div className="flex justify-between mt-1.5 text-[11px] font-semibold" style={{ color: muted }}>
        <span>{formatTime(current)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  )
}

export interface AudioTrack {
  url: string
  label: string
  sublabel?: string
}

// For interviews recorded before the mic+TTS mixing fix, where the only data available is
// a pile of separate per-question clips. Rather than stacking N native <audio> players (the
// exact "plusieurs audios" complaint), this plays them back-to-back as ONE session: a single
// play button and one combined seek bar spanning every track, auto-advancing at each track's
// end. Track durations are probed upfront (silently, via detached <audio> elements) so the
// combined bar's total length and segment boundaries are correct from the start rather than
// growing as playback discovers each track.
export function MultiTrackAudioPlayer({
  tracks, accentColor = 'var(--color-primary)', dark = false,
}: {
  tracks: AudioTrack[]
  accentColor?: string
  dark?: boolean
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [durations, setDurations] = useState<number[]>(() => tracks.map(() => 0))

  // Playback position/durations must reset when the track list itself changes (a different
  // interview's recordings) — done at render time (React's recommended way to adjust state
  // when a prop changes) rather than in the effect below, which only owns the probing
  // side-effect itself.
  const tracksKey = tracks.map(t => t.url).join('|')
  const [lastTracksKey, setLastTracksKey] = useState(tracksKey)
  if (tracksKey !== lastTracksKey) {
    setLastTracksKey(tracksKey)
    setIndex(0)
    setCurrent(0)
    setPlaying(false)
    setDurations(tracks.map(() => 0))
  }

  useEffect(() => {
    let cancelled = false
    const probes = tracks.map((t, i) => {
      const probe = new Audio()
      probe.preload = 'metadata'
      probe.src = t.url
      probe.addEventListener('loadedmetadata', () => {
        if (cancelled) return
        setDurations(d => { const next = [...d]; next[i] = probe.duration || 0; return next })
      })
      return probe
    })
    return () => { cancelled = true; probes.forEach(p => { p.src = '' }) }
  }, [tracks])

  const goTo = useCallback((i: number, autoplay: boolean) => {
    const clamped = Math.min(tracks.length - 1, Math.max(0, i))
    setIndex(clamped)
    setCurrent(0)
    if (autoplay) requestAnimationFrame(() => audioRef.current?.play().catch(() => {}))
  }, [tracks.length])

  const handleEnded = useCallback(() => {
    if (index < tracks.length - 1) goTo(index + 1, true)
    else setPlaying(false)
  }, [index, tracks.length, goTo])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) audio.pause()
    else audio.play().catch(() => {})
  }, [playing])

  const totalDuration = durations.reduce((a, b) => a + b, 0)
  const elapsedBeforeCurrent = durations.slice(0, index).reduce((a, b) => a + b, 0)
  const overallCurrent = elapsedBeforeCurrent + current
  const progress = totalDuration ? overallCurrent / totalDuration : 0

  const seekToClientX = useCallback((clientX: number) => {
    const bar = barRef.current
    if (!bar || !totalDuration) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    let target = ratio * totalDuration
    let i = 0
    while (i < durations.length - 1 && target > durations[i]) { target -= durations[i]; i++ }
    if (i !== index) {
      setIndex(i)
      requestAnimationFrame(() => { if (audioRef.current) audioRef.current.currentTime = target })
    } else if (audioRef.current) {
      audioRef.current.currentTime = target
    }
    setCurrent(target)
  }, [durations, totalDuration, index])

  const track = tracks[index]
  const text = dark ? 'rgba(255,255,255,0.75)' : 'var(--color-text)'
  const muted = dark ? 'rgba(255,255,255,0.35)' : 'var(--color-text-muted)'
  const surface = dark ? 'rgba(255,255,255,0.03)' : 'var(--color-surface)'
  const border = dark ? 'rgba(255,255,255,0.08)' : 'var(--color-border)'
  const trackBg = dark ? 'rgba(255,255,255,0.12)' : 'var(--color-border)'

  if (!track) return null

  return (
    <div className="mbc-audio-player rounded-2xl p-4" style={{ background: surface, border: `1px solid ${border}` }}>
      <audio
        ref={audioRef}
        src={track.url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={e => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={e => {
          const loaded = e.currentTarget.duration || 0
          setDurations(d => { const next = [...d]; next[index] = loaded; return next })
        }}
        onEnded={handleEnded}
      />

      <div className="flex items-center gap-2 mb-3">
        <button type="button" onClick={() => goTo(index - 1, playing)} disabled={index === 0}
          className="mbc-audio-playbtn shrink-0 flex items-center justify-center rounded-full"
          style={{ width: 30, height: 30, color: index === 0 ? muted : text, opacity: index === 0 ? 0.35 : 1 }}
          aria-label="Piste précédente">
          <SkipBack className="h-3.5 w-3.5" fill="currentColor" />
        </button>
        <button type="button" onClick={togglePlay}
          className="mbc-audio-playbtn shrink-0 flex items-center justify-center rounded-full"
          style={{ width: 38, height: 38, background: accentColor, color: 'white' }}
          aria-label={playing ? 'Pause' : 'Lecture'}>
          {playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="h-4 w-4 ml-0.5" fill="currentColor" />}
        </button>
        <button type="button" onClick={() => goTo(index + 1, playing)} disabled={index === tracks.length - 1}
          className="mbc-audio-playbtn shrink-0 flex items-center justify-center rounded-full"
          style={{ width: 30, height: 30, color: index === tracks.length - 1 ? muted : text, opacity: index === tracks.length - 1 ? 0.35 : 1 }}
          aria-label="Piste suivante">
          <SkipForward className="h-3.5 w-3.5" fill="currentColor" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold truncate" style={{ color: text }}>{track.label}</p>
          {track.sublabel && <p className="text-xs truncate" style={{ color: muted }}>{track.sublabel}</p>}
        </div>
        <span className="text-[10px] font-bold shrink-0 px-2 py-1 rounded-full" style={{ color: accentColor, background: dark ? 'rgba(255,255,255,0.06)' : 'var(--color-background)' }}>
          {index + 1}/{tracks.length}
        </span>
      </div>

      <div ref={barRef} className="relative rounded-full cursor-pointer" style={{ height: 8 }}
        onClick={e => seekToClientX(e.clientX)}>
        <div className="absolute inset-0 rounded-full" style={{ background: trackBg }} />
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${progress * 100}%`, background: accentColor }} />
        {totalDuration > 0 && durations.slice(0, -1).reduce<{ acc: number; marks: number[] }>((state, d) => {
          state.acc += d
          state.marks.push(state.acc)
          return state
        }, { acc: 0, marks: [] }).marks.map((t, i) => (
          <div key={i} className="absolute top-0 bottom-0" style={{ left: `${(t / totalDuration) * 100}%`, width: 2, background: dark ? 'rgba(0,0,0,0.3)' : 'white' }} />
        ))}
      </div>

      <div className="flex justify-between mt-1.5 text-[11px] font-semibold" style={{ color: muted }}>
        <span>{formatTime(overallCurrent)}</span>
        <span>{formatTime(totalDuration)}</span>
      </div>
    </div>
  )
}
