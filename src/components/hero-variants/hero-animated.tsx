'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import type { HeroSection } from '@/app/admin/pages/types'

// ── floating 3D job universe elements ──────────────────────────────
const ORBIT_ITEMS = [
  { label: 'Senior Dev', sub: 'Paris · CDI', depth: 0.7, angle: 15 },
  { label: 'Data Scientist', sub: 'Remote · Freelance', depth: 0.45, angle: 95 },
  { label: 'Product Manager', sub: 'Lyon · CDI', depth: 0.85, angle: 170 },
  { label: 'UX Designer', sub: 'Bordeaux · Mission', depth: 0.55, angle: 245 },
  { label: 'CTO', sub: '€150k · Startup', depth: 0.75, angle: 320 },
]

const SKILLS_STREAM = [
  'React', 'Python', 'Leadership', 'IA', 'Agile', 'SQL', 'Strategy',
  'Node.js', 'Finance', 'Cloud', 'Branding', 'DevOps',
]

export function HeroAnimated({ s }: { s: HeroSection }) {
  const [mounted, setMounted] = useState(false)
  const [phase, setPhase] = useState(0) // 0=hidden 1=universe-in 2=text-in 3=full
  const [displayed, setDisplayed] = useState('')
  const [typing, setTyping] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const mouse = useRef({ x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 })
  const raf = useRef<number>(0)

  useEffect(() => {
    setMounted(true)
    const t1 = setTimeout(() => setPhase(1), 100)
    const t2 = setTimeout(() => setPhase(2), 800)
    const t3 = setTimeout(() => setPhase(3), 1400)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [])

  // Typewriter — starts when phase >= 2
  useEffect(() => {
    if (phase < 2) return
    let i = 0
    const text = s.title || 'Votre prochaine grande opportunité'
    function tick() {
      i++
      setDisplayed(text.slice(0, i))
      if (i < text.length) setTimeout(tick, i === 1 ? 200 : 38)
      else setTyping(false)
    }
    const t = setTimeout(tick, 200)
    return () => clearTimeout(t)
  }, [phase, s.title])

  // Smooth mouse tracking
  const onMouseMove = useCallback((e: MouseEvent) => {
    mouse.current.tx = e.clientX / window.innerWidth
    mouse.current.ty = e.clientY / window.innerHeight
  }, [])
  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove)
    return () => window.removeEventListener('mousemove', onMouseMove)
  }, [onMouseMove])

  // ── CANVAS: deep space universe ─────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    // Stars
    const STAR_COUNT = 280
    type Star = { x: number; y: number; z: number; r: number; gold: boolean }
    const stars: Star[] = Array.from({ length: STAR_COUNT }, () => ({
      x: Math.random() * 2 - 1,
      y: Math.random() * 2 - 1,
      z: Math.random(),
      r: Math.random() * 1.6 + 0.3,
      gold: Math.random() < 0.12,
    }))

    // Particles (streaming toward viewer)
    type Particle = { x: number; y: number; z: number; speed: number; size: number; gold: boolean }
    const particles: Particle[] = Array.from({ length: 60 }, () => ({
      x: (Math.random() - 0.5) * 2,
      y: (Math.random() - 0.5) * 2,
      z: Math.random(),
      speed: 0.004 + Math.random() * 0.008,
      size: Math.random() * 2 + 0.5,
      gold: Math.random() < 0.3,
    }))

    let frame = 0

    function drawFrame() {
      const W = canvas!.width
      const H = canvas!.height
      const CX = W / 2
      const CY = H / 2

      // Smooth mouse lerp
      mouse.current.x += (mouse.current.tx - mouse.current.x) * 0.05
      mouse.current.y += (mouse.current.ty - mouse.current.y) * 0.05
      const mx = mouse.current.x
      const my = mouse.current.y

      ctx.clearRect(0, 0, W, H)

      // ── Deep space background ──
      const bg = ctx.createRadialGradient(
        CX + (mx - 0.5) * 80, CY + (my - 0.5) * 60, 0,
        CX, CY, Math.max(W, H) * 0.85
      )
      bg.addColorStop(0, '#0d1b3e')
      bg.addColorStop(0.35, '#050c20')
      bg.addColorStop(0.7, '#020810')
      bg.addColorStop(1, '#010409')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, W, H)

      // ── Nebula glow (deep center) ──
      const neb = ctx.createRadialGradient(
        CX + (mx - 0.5) * 40, CY + (my - 0.5) * 30, 0,
        CX, CY, W * 0.5
      )
      neb.addColorStop(0, 'rgba(44,44,46,0.55)')
      neb.addColorStop(0.3, 'rgba(20,40,110,0.25)')
      neb.addColorStop(0.6, 'rgba(232,163,61,0.06)')
      neb.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = neb
      ctx.fillRect(0, 0, W, H)

      // ── Perspective grid (vanishing point = center, mouse-shifted) ──
      const VP = { x: CX + (mx - 0.5) * 60, y: CY + (my - 0.5) * 40 }
      const GRID_LINES = 12
      ctx.save()
      for (let i = 0; i < GRID_LINES; i++) {
        const t = i / GRID_LINES
        const angle = (t * Math.PI * 2) + frame * 0.003
        const ex = VP.x + Math.cos(angle) * W * 0.85
        const ey = VP.y + Math.sin(angle) * H * 0.85
        const alpha = 0.04 + Math.sin(angle + frame * 0.01) * 0.02
        ctx.beginPath()
        ctx.moveTo(VP.x, VP.y)
        ctx.lineTo(ex, ey)
        ctx.strokeStyle = `rgba(232,163,61,${alpha})`
        ctx.lineWidth = 0.5
        ctx.stroke()
      }
      // Horizon rings
      for (let r = 1; r <= 5; r++) {
        const radius = (r / 5) * Math.max(W, H) * 0.7
        const alpha = 0.04 - r * 0.005
        ctx.beginPath()
        ctx.arc(VP.x, VP.y, radius, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(44,44,46,${alpha + 0.05})`
        ctx.lineWidth = 0.6
        ctx.stroke()
      }
      ctx.restore()

      // ── Stars ──
      for (const star of stars) {
        const sx = CX + (star.x + (mx - 0.5) * 0.04 * star.z) * CX
        const sy = CY + (star.y + (my - 0.5) * 0.03 * star.z) * CY
        const flicker = 0.5 + 0.5 * Math.sin(frame * 0.03 + star.z * 10)
        const alpha = (0.4 + flicker * 0.6) * star.z
        ctx.beginPath()
        ctx.arc(sx, sy, star.r * star.z, 0, Math.PI * 2)
        ctx.fillStyle = star.gold
          ? `rgba(212,175,55,${alpha})`
          : `rgba(${180 + Math.round(star.z * 60)},${190 + Math.round(star.z * 50)},255,${alpha})`
        ctx.fill()
      }

      // ── Streaming particles (fly toward viewer) ──
      for (const p of particles) {
        p.z -= p.speed
        if (p.z <= 0) {
          p.x = (Math.random() - 0.5) * 1.6
          p.y = (Math.random() - 0.5) * 1.6
          p.z = 1
        }
        const px = CX + (p.x / p.z) * CX * 0.8 + (mx - 0.5) * 20
        const py = CY + (p.y / p.z) * CY * 0.8 + (my - 0.5) * 15
        const size = p.size * (1 - p.z) * 2.5
        const alpha = (1 - p.z) * 0.7
        // Streak
        const prevZ = p.z + p.speed
        const prevPx = CX + (p.x / prevZ) * CX * 0.8 + (mx - 0.5) * 20
        const prevPy = CY + (p.y / prevZ) * CY * 0.8 + (my - 0.5) * 15
        ctx.beginPath()
        ctx.moveTo(prevPx, prevPy)
        ctx.lineTo(px, py)
        ctx.strokeStyle = p.gold
          ? `rgba(212,175,55,${alpha * 0.9})`
          : `rgba(150,170,255,${alpha * 0.6})`
        ctx.lineWidth = size * 0.4
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(px, py, size * 0.5, 0, Math.PI * 2)
        ctx.fillStyle = p.gold ? `rgba(212,175,55,${alpha})` : `rgba(180,200,255,${alpha * 0.8})`
        ctx.fill()
      }

      // ── Central portal glow ──
      const portalX = CX * 1.45 + (mx - 0.5) * 30
      const portalY = CY + (my - 0.5) * 20
      const portalPulse = 0.85 + 0.15 * Math.sin(frame * 0.04)
      const portal = ctx.createRadialGradient(portalX, portalY, 0, portalX, portalY, W * 0.38 * portalPulse)
      portal.addColorStop(0, 'rgba(44,44,46,0.5)')
      portal.addColorStop(0.2, 'rgba(30,60,140,0.3)')
      portal.addColorStop(0.5, 'rgba(232,163,61,0.1)')
      portal.addColorStop(0.8, 'rgba(44,44,46,0.04)')
      portal.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = portal
      ctx.fillRect(0, 0, W, H)

      frame++
      raf.current = requestAnimationFrame(drawFrame)
    }

    function resize() {
      canvas!.width = canvas!.offsetWidth
      canvas!.height = canvas!.offsetHeight
    }
    resize()
    window.addEventListener('resize', resize)
    drawFrame()
    return () => {
      cancelAnimationFrame(raf.current)
      window.removeEventListener('resize', resize)
    }
  }, [])

  const title = s.title || 'Votre prochaine grande opportunité'
  const subtitle = s.subtitle || 'La plateforme IA qui connecte les meilleurs talents aux missions qui comptent.'

  return (
    <section style={{
      position: 'relative',
      minHeight: s.sectionHeight || '100vh',
      overflow: 'hidden',
      background: '#010409',
      display: 'flex',
      alignItems: 'center',
    }}>
      {/* ── Canvas universe ── */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          display: 'block',
        }}
      />

      {/* ── Floating 3D orbit cards ── */}
      {ORBIT_ITEMS.map((item, i) => {
        const rad = (item.angle * Math.PI) / 180
        const rx = 42 + item.depth * 12  // % from center
        const ry = 28 + item.depth * 8
        const left = `${50 + rx * Math.cos(rad)}%`
        const top = `${50 + ry * Math.sin(rad)}%`
        const delay = 0.6 + i * 0.18
        const scale = 0.65 + item.depth * 0.45
        return (
          <div key={item.label} style={{
            position: 'absolute',
            left, top,
            transform: `translate(-50%,-50%) scale(${scale})`,
            opacity: phase >= 3 ? item.depth * 0.9 : 0,
            transition: `opacity 0.8s ease ${delay}s, transform 0.8s ease ${delay}s`,
            zIndex: Math.round(item.depth * 10),
            pointerEvents: 'none',
          }}>
            <div style={{
              background: 'rgba(44,44,46,0.55)',
              border: '1px solid rgba(232,163,61,0.25)',
              backdropFilter: 'blur(12px)',
              borderRadius: 12,
              padding: '10px 16px',
              whiteSpace: 'nowrap',
              boxShadow: '0 4px 24px rgba(232,163,61,0.08), 0 0 40px rgba(44,44,46,0.4)',
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e8eaf6', letterSpacing: '0.02em' }}>{item.label}</div>
              <div style={{ fontSize: 11, color: 'rgba(232,163,61,0.8)', marginTop: 2 }}>{item.sub}</div>
            </div>
          </div>
        )
      })}

      {/* ── Skill stream pills (bottom arc) ── */}
      <div style={{
        position: 'absolute',
        bottom: '6%', left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex', gap: 8, flexWrap: 'nowrap',
        opacity: phase >= 3 ? 1 : 0,
        transition: 'opacity 1s ease 1.5s',
        zIndex: 4,
      }}>
        {SKILLS_STREAM.map((skill, i) => (
          <div key={skill} style={{
            padding: '5px 13px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.05em',
            color: i % 3 === 0 ? 'rgba(212,175,55,0.9)' : 'rgba(180,200,255,0.55)',
            border: `1px solid ${i % 3 === 0 ? 'rgba(232,163,61,0.3)' : 'rgba(100,130,255,0.15)'}`,
            background: 'rgba(5,12,32,0.6)',
            backdropFilter: 'blur(8px)',
            animation: `ha-float ${3 + (i % 4) * 0.5}s ease-in-out ${i * 0.2}s infinite alternate`,
          }}>
            {skill}
          </div>
        ))}
      </div>

      {/* ── Main content ── */}
      <div style={{
        position: 'relative', zIndex: 10,
        width: '100%',
        maxWidth: 860,
        margin: '0 auto',
        padding: '8rem 2rem 10rem',
        textAlign: 'center',
      }}>

        {/* Eyebrow */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          marginBottom: 28,
          opacity: phase >= 2 ? 1 : 0,
          transform: phase >= 2 ? 'none' : 'translateY(16px)',
          transition: 'opacity 0.7s ease, transform 0.7s ease',
        }}>
          <div style={{ width: 32, height: 1, background: 'linear-gradient(90deg, transparent, #E8A33D)' }} />
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.16em',
            textTransform: 'uppercase', color: '#E8A33D',
            fontFamily: 'var(--font-body)',
          }}>
            Recrutement propulsé par l'IA
          </span>
          <div style={{ width: 32, height: 1, background: 'linear-gradient(90deg, #E8A33D, transparent)' }} />
        </div>

        {/* Headline — typewriter */}
        <h1 style={{
          fontSize: 'clamp(2.6rem, 6vw, 5.2rem)',
          fontWeight: 300,
          letterSpacing: '-0.04em',
          lineHeight: 1.06,
          color: '#f0f4ff',
          marginBottom: '1.5rem',
          minHeight: '1.15em',
          fontFamily: 'var(--font-heading)',
          opacity: phase >= 2 ? 1 : 0,
          transition: 'opacity 0.5s ease 0.1s',
          textShadow: '0 0 80px rgba(44,44,46,0.8)',
        }}>
          {displayed}
          {typing && (
            <span style={{
              display: 'inline-block', width: 3, height: '0.8em',
              background: '#E8A33D',
              verticalAlign: 'middle', marginLeft: 5,
              animation: 'ha-blink 1s step-end infinite',
            }} />
          )}
        </h1>

        {/* Subtitle */}
        <p style={{
          fontSize: 'clamp(1rem, 1.6vw, 1.2rem)',
          lineHeight: 1.75,
          color: 'rgba(180,200,255,0.65)',
          maxWidth: 580,
          margin: '0 auto 2.5rem',
          fontFamily: 'var(--font-body)',
          opacity: phase >= 3 ? 1 : 0,
          transform: phase >= 3 ? 'none' : 'translateY(12px)',
          transition: 'opacity 0.6s ease 0.2s, transform 0.6s ease 0.2s',
        }}>
          {subtitle}
        </p>

        {/* CTAs */}
        <div style={{
          display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap',
          opacity: phase >= 3 ? 1 : 0,
          transform: phase >= 3 ? 'none' : 'translateY(14px)',
          transition: 'opacity 0.6s ease 0.4s, transform 0.6s ease 0.4s',
        }}>
          {(s.ctaLabel || 'Explorer les missions') && (
            <Link href={s.ctaHref || '/jobs'} style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '0.95rem 2.2rem',
              borderRadius: 10,
              background: 'linear-gradient(135deg, #2C2C2E, #3A3A3C)',
              border: '1px solid rgba(232,163,61,0.4)',
              color: '#fff',
              fontWeight: 700, fontSize: 15,
              textDecoration: 'none',
              fontFamily: 'var(--font-body)',
              boxShadow: '0 0 32px rgba(44,44,46,0.6), 0 4px 20px rgba(0,0,0,0.4)',
              transition: 'box-shadow 0.2s, transform 0.2s',
              letterSpacing: '0.02em',
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 48px rgba(232,163,61,0.2), 0 4px 24px rgba(0,0,0,0.5)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 32px rgba(44,44,46,0.6), 0 4px 20px rgba(0,0,0,0.4)'; (e.currentTarget as HTMLElement).style.transform = 'none' }}
            >
              <span style={{ fontSize: 18 }}>✦</span>
              {s.ctaLabel || 'Explorer les missions'}
            </Link>
          )}
          {(s.ctaSecondaryLabel || 'Espace recruteurs') && (
            <Link href={s.ctaSecondaryHref || '/register'} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '0.95rem 2.2rem',
              borderRadius: 10,
              border: '1px solid rgba(180,200,255,0.18)',
              background: 'rgba(5,12,32,0.6)',
              backdropFilter: 'blur(12px)',
              color: 'rgba(180,200,255,0.85)',
              fontWeight: 600, fontSize: 15,
              textDecoration: 'none',
              fontFamily: 'var(--font-body)',
              transition: 'border-color 0.2s, color 0.2s',
              letterSpacing: '0.02em',
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(232,163,61,0.4)'; (e.currentTarget as HTMLElement).style.color = '#fff' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(180,200,255,0.18)'; (e.currentTarget as HTMLElement).style.color = 'rgba(180,200,255,0.85)' }}
            >
              {s.ctaSecondaryLabel || 'Espace recruteurs'}
            </Link>
          )}
        </div>

        {/* Stats row */}
        <div style={{
          display: 'flex', gap: 40, justifyContent: 'center', marginTop: '3.5rem',
          opacity: phase >= 3 ? 1 : 0,
          transition: 'opacity 0.8s ease 0.8s',
        }}>
          {[
            { n: '15 000+', l: 'Consultants' },
            { n: '380+', l: 'Entreprises' },
            { n: '2 400+', l: 'Missions actives' },
          ].map(stat => (
            <div key={stat.l} style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: 'clamp(1.5rem, 2.5vw, 2rem)',
                fontWeight: 700,
                color: '#E8A33D',
                fontFamily: 'var(--font-heading)',
                letterSpacing: '-0.03em',
              }}>{stat.n}</div>
              <div style={{
                fontSize: 12, color: 'rgba(180,200,255,0.45)',
                marginTop: 4, letterSpacing: '0.08em', textTransform: 'uppercase',
                fontFamily: 'var(--font-body)',
              }}>{stat.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Photo overlay (right side, if set) ── */}
      {s.imageUrl && (
        <div style={{
          position: 'absolute',
          right: 0, top: 0, bottom: 0,
          width: '38%',
          opacity: phase >= 3 ? 0.85 : 0,
          transition: 'opacity 1s ease 0.6s',
          pointerEvents: 'none',
          zIndex: 5,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={s.imageUrl} alt={s.imageAlt || ''} style={{
            width: '100%', height: '100%',
            objectFit: 'cover',
            objectPosition: s.imageObjectPosition || 'center top',
            maskImage: 'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.6) 30%, black 70%)',
            WebkitMaskImage: 'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.6) 30%, black 70%)',
          }} />
        </div>
      )}

      {/* ── Vignette ── */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2,
        background: 'radial-gradient(ellipse at center, transparent 40%, rgba(1,4,9,0.7) 100%)',
      }} />

      {/* ── Bottom gradient fade ── */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 120, pointerEvents: 'none', zIndex: 3,
        background: 'linear-gradient(to top, rgba(1,4,9,0.8), transparent)',
      }} />

      <style>{`
        @keyframes ha-blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes ha-float {
          from { transform: translate(-50%,-50%) translateY(0px); }
          to   { transform: translate(-50%,-50%) translateY(-6px); }
        }
        @media (max-width: 768px) {
          .ha-skills { display: none !important; }
        }
      `}</style>
    </section>
  )
}
