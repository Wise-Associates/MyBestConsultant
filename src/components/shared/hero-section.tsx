'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Search, MapPin, ArrowRight, Briefcase, Building2, Users } from 'lucide-react'

const SERVICES = [
  'Sourcing candidats',
  'Screening IA',
  'Entretiens IA',
  'Mission freelance',
  'Recrutement CDI',
  'Autre',
]

interface Props {
  heroTitle: string
  heroSubtitle: string
  siteTagline: string
  statsJobs: string
  statsCompanies: string
  statsCandidates: string
  heroImageUrl: string
  heroImageAlt: string
}

export function HeroSection({
  heroTitle,
  heroSubtitle,
  siteTagline,
  statsJobs,
  statsCompanies,
  statsCandidates,
  heroImageUrl,
  heroImageAlt,
}: Props) {
  const [displayed, setDisplayed] = useState('')
  const [typing, setTyping] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mounted, setMounted] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const prevX = useRef<number | null>(null)
  const targetTime = useRef(0)

  useEffect(() => { setMounted(true) }, [])

  // Typewriter
  useEffect(() => {
    let i = 0
    const text = heroTitle
    const delay = () => (i === 0 ? 600 : 45)
    function tick() {
      i++
      setDisplayed(text.slice(0, i))
      if (i < text.length) setTimeout(tick, delay())
      else setTyping(false)
    }
    const t = setTimeout(tick, 400)
    return () => clearTimeout(t)
  }, [heroTitle])

  // Video scrub on mouse move
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onMove = (e: MouseEvent) => {
      if (!video.duration) return
      if (prevX.current !== null) {
        const delta = e.clientX - prevX.current
        targetTime.current = Math.max(0, Math.min(video.duration, targetTime.current + (delta / window.innerWidth) * 0.8 * video.duration))
        video.currentTime = targetTime.current
      }
      prevX.current = e.clientX
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  function toggleService(s: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(s) ? next.delete(s) : next.add(s)
      return next
    })
  }

  const hasVideo = !heroImageUrl

  return (
    <section
      style={{
        background: 'var(--hero-bg, #2C2C2E)',
        color: 'var(--hero-text, #fff)',
        paddingTop: 80,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Background: video (dark) or image */}
      {hasVideo ? (
        <video
          ref={videoRef}
          muted
          playsInline
          preload="auto"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'right bottom',
            opacity: 0.15,
            pointerEvents: 'none',
          }}
        />
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={heroImageUrl}
            alt={heroImageAlt}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(44,44,46,0.75)' }} />
        </>
      )}

      <div className="max-w-7xl mx-auto px-4 lg:px-8" style={{ position: 'relative' }}>

        {/* Eyebrow */}
        <div
          className="flex items-center gap-3 mb-5"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'none' : 'translateY(12px)',
            transition: 'opacity 0.5s ease, transform 0.5s ease',
          }}
        >
          <div style={{ width: 24, height: 1, background: 'var(--color-accent, #E8A33D)' }} />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-accent, #E8A33D)' }}>
            {siteTagline}
          </span>
        </div>

        {/* Headline with typewriter */}
        <h1
          className="max-w-3xl mb-5"
          style={{
            fontSize: 'clamp(2.6rem, 5vw, 4.8rem)',
            fontWeight: 300,
            letterSpacing: '-0.04em',
            lineHeight: 1.05,
            color: 'var(--hero-text, #fff)',
            minHeight: '1.05em',
            opacity: mounted ? 1 : 0,
            transition: 'opacity 0.4s ease 0.1s',
          }}
        >
          {displayed}
          {typing && (
            <span
              style={{
                display: 'inline-block',
                width: 3,
                height: '0.9em',
                background: 'var(--color-accent, #E8A33D)',
                verticalAlign: 'middle',
                marginLeft: 4,
                animation: 'hero-blink 1s step-end infinite',
              }}
            />
          )}
        </h1>

        <p
          className="max-w-xl mb-10"
          style={{
            fontSize: 17,
            lineHeight: 1.7,
            color: 'rgba(255,255,255,0.6)',
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'none' : 'translateY(10px)',
            transition: 'opacity 0.5s ease 0.25s, transform 0.5s ease 0.25s',
          }}
        >
          {heroSubtitle}
        </p>

        {/* Service pills */}
        <div
          style={{
            marginBottom: 24,
            opacity: mounted ? 1 : 0,
            transition: 'opacity 0.5s ease 0.35s',
          }}
        >
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 12, fontWeight: 500 }}>
            Quel service vous intéresse ?
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SERVICES.map(s => {
              const active = selected.has(s)
              return (
                <button
                  key={s}
                  onClick={() => toggleService(s)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 16px',
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'all 0.18s ease',
                    background: active ? '#fff' : 'rgba(255,255,255,0.08)',
                    color: active ? '#2C2C2E' : 'rgba(255,255,255,0.8)',
                    border: active ? '1.5px solid #fff' : '1.5px solid rgba(255,255,255,0.18)',
                  }}
                >
                  {active && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-accent, #E8A33D)' }}>✓</span>
                  )}
                  {s}
                </button>
              )
            })}
          </div>

          {selected.size > 0 && (
            <div
              style={{
                marginTop: 14,
                padding: '12px 18px',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                animation: 'hero-fadein 0.22s ease both',
              }}
            >
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', margin: 0 }}>
                <strong style={{ color: '#fff' }}>Sélection :</strong> {[...selected].join(', ')}
              </p>
              <Link
                href="/register"
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                  color: 'var(--color-accent, #E8A33D)',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  whiteSpace: 'nowrap',
                  transition: 'opacity 0.2s',
                }}
              >
                Commencer <ArrowRight style={{ width: 14, height: 14 }} />
              </Link>
            </div>
          )}
        </div>

        {/* Search bar */}
        <div
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'none' : 'translateY(10px)',
            transition: 'opacity 0.5s ease 0.45s, transform 0.5s ease 0.45s',
          }}
        >
          <div
            className="flex max-w-2xl rounded-lg overflow-hidden"
            style={{ background: '#fff', boxShadow: '0 24px 64px rgba(0,0,0,0.35)' }}
          >
            <div className="flex items-center gap-3 flex-1 px-5">
              <Search className="h-4 w-4 shrink-0" style={{ color: '#94A3B8' }} />
              <input
                placeholder="Métier, compétence, entreprise..."
                className="flex-1 outline-none bg-transparent py-5 text-sm"
                style={{ color: '#2C2C2E' }}
              />
            </div>
            <div style={{ width: 1, background: '#E5E9F5', margin: '14px 0' }} />
            <div className="flex items-center gap-3 flex-1 px-5">
              <MapPin className="h-4 w-4 shrink-0" style={{ color: '#94A3B8' }} />
              <input
                placeholder="Ville, région, remote…"
                className="flex-1 outline-none bg-transparent py-5 text-sm"
                style={{ color: '#2C2C2E' }}
              />
            </div>
            <Link
              href="/jobs"
              className="flex items-center gap-2 px-7 font-bold text-sm shrink-0 no-underline"
              style={{ background: 'var(--color-accent, #E8A33D)', color: '#fff' }}
            >
              <Search className="h-4 w-4" /> Rechercher
            </Link>
          </div>

          {/* Quick filters */}
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>Populaires :</span>
            {['SAP', 'Finance', 'Data Analytics', 'PMO', 'Transformation', 'SIRH'].map(tag => (
              <Link
                key={tag}
                href={`/jobs?q=${tag}`}
                className="text-xs font-medium px-3 py-1 rounded no-underline transition-opacity hover:opacity-80"
                style={{ border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.65)' }}
              >
                {tag}
              </Link>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div
          className="flex flex-wrap gap-10 mt-16 pt-5"
          style={{
            borderTop: '1px solid rgba(255,255,255,0.12)',
            opacity: mounted ? 1 : 0,
            transition: 'opacity 0.5s ease 0.6s',
          }}
        >
          {[
            { icon: Briefcase, val: statsJobs, label: 'offres actives' },
            { icon: Building2, val: statsCompanies, label: 'entreprises partenaires' },
            { icon: Users, val: statsCandidates, label: 'consultants inscrits' },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-2.5">
              <s.icon className="h-4 w-4" style={{ color: 'var(--color-accent, #E8A33D)' }} />
              <span className="font-bold text-lg" style={{ color: '#fff' }}>{s.val}</span>
              <span className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="h-12" />

      <style>{`
        @keyframes hero-blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes hero-fadein { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
      `}</style>
    </section>
  )
}
