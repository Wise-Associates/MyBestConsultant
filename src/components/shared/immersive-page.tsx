'use client'

import { useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import type { SceneConfig } from '@/lib/site-config'
import type { UserRole } from '@/types'

type UserCtx = { role: UserRole } | null

function smartHref(intent: 'deposit' | 'discover' | 'recruiter-cta' | 'candidate-cta' | 'cvtheque', user: UserCtx): string {
  const role = user?.role
  if (intent === 'deposit') {
    if (role === 'recruiter' || role === 'admin') return '/recruiter/dashboard?openCreateJob=1'
    if (role === 'candidate') return '/jobs'
    return '/register?role=recruiter'
  }
  if (intent === 'discover') {
    if (role === 'recruiter' || role === 'admin') return '/recruiter/dashboard'
    if (role === 'candidate') return '/jobs'
    return '/register'
  }
  if (intent === 'recruiter-cta') {
    if (role === 'recruiter' || role === 'admin') return '/recruiter/dashboard'
    return '/register?role=recruiter'
  }
  if (intent === 'candidate-cta') {
    if (role === 'candidate') return '/candidate/dashboard'
    return '/register?role=candidate'
  }
  if (intent === 'cvtheque') {
    if (role === 'recruiter' || role === 'admin') return '/recruiter/cvtheque'
    return '/register?role=recruiter'
  }
  return '/'
}

// ── DEFAULT SCENES ────────────────────────────────────────────────────
// These are overridden by scenesConfig from admin
const DEFAULTS = [
  {
    img: 'https://images.pexels.com/photos/1323550/pexels-photo-1323550.jpeg?auto=compress&cs=tinysrgb&w=1920',
    eyebrow: "Recrutement propulsé par l'IA",
    title: ['Votre prochaine', 'grande opportunité'],
    sub: 'La plateforme qui connecte les meilleurs talents aux missions qui comptent.',
    cta: { label: 'Explorer les missions', href: '/jobs' },
    ghost: { label: 'Créer mon profil', href: '/register' },
    align: 'center',
  },
  {
    img: 'https://images.pexels.com/photos/3184291/pexels-photo-3184291.jpeg?auto=compress&cs=tinysrgb&w=1920',
    eyebrow: '15 000+ consultants',
    title: ['Les talents', 'qui font bouger les lignes'],
    sub: "Consultants senior, experts métier, freelances d'élite — tous présélectionnés.",
    cta: { label: 'Voir les profils', href: '/jobs' },
    align: 'left',
  },
  {
    img: 'https://images.pexels.com/photos/1486785/pexels-photo-1486785.jpeg?auto=compress&cs=tinysrgb&w=1920',
    eyebrow: '380+ entreprises partenaires',
    title: ['Les meilleures', 'entreprises vous cherchent'],
    sub: "McKinsey, BNP Paribas, Accenture — publiez vos missions en 60 secondes.",
    cta: { label: 'Déposer une offre', href: '/register?role=recruiter' },
    align: 'right',
  },
  {
    img: 'https://images.pexels.com/photos/8386440/pexels-photo-8386440.jpeg?auto=compress&cs=tinysrgb&w=1920',
    eyebrow: 'Intelligence artificielle',
    title: ['Screening CV', 'en 8 secondes'],
    sub: "L'IA analyse votre profil, score /100, entretien virtuel automatisé.",
    cta: { label: 'Découvrir la technologie', href: '/register' },
    align: 'center',
  },
  {
    img: 'https://images.pexels.com/photos/3225517/pexels-photo-3225517.jpeg?auto=compress&cs=tinysrgb&w=1920',
    eyebrow: 'Choisissez votre voie',
    title: ['Prêt à entrer', 'dans un nouveau monde ?'],
    sub: '',
    align: 'center',
    isFinal: true,
  },
]

// ── Media box (image + Ken Burns OR video) — contained square, not full-bleed ──
function SceneBg({ imgUrl, videoUrl }: { imgUrl: string; videoUrl?: string }) {
  if (videoUrl) {
    return (
      <video
        src={videoUrl}
        autoPlay muted loop playsInline
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
      />
    )
  }
  return (
    <div
      className="iv-kenburns"
      style={{
        position: 'absolute', inset: 0,
        backgroundImage: `url(${imgUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    />
  )
}

// ── SINGLE SCENE ──────────────────────────────────────────────────────
interface SceneRefs { wrapper: HTMLDivElement | null }

const OVERLAY_BASE: Record<string, string> = {
  dark:  '28,28,30',
  navy:  '11,29,81',
  warm:  '40,20,0',
  none:  '28,28,30',
}
const TITLE_FS: Record<string, string> = {
  sm: 'clamp(1.8rem,3.5vw,3.2rem)',
  md: 'clamp(2.2rem,4.5vw,4.5rem)',
  lg: 'clamp(2.8rem,6.5vw,6rem)',
  xl: 'clamp(3.4rem,8vw,7.5rem)',
}
const TEXT_COLOR: Record<string, string> = {
  white: '#ffffff',
  cream: 'rgba(255,248,230,0.95)',
  light: 'rgba(200,220,255,0.88)',
}

function Scene({
  idx, imgUrl, videoUrl, eyebrow, title, sub, cta, ghost, align, isFinal,
  overlayColor, titleSize, textColor, ctaPrimary, ctaSecondary,
  user, refsOut,
}: {
  idx: number; imgUrl: string; videoUrl?: string
  eyebrow: string; title: string[]; sub: string
  cta?: { label: string; href: string }
  ghost?: { label: string; href: string }
  align: string; isFinal?: boolean
  overlayColor: string
  titleSize: string; textColor: string
  ctaPrimary?: string; ctaSecondary?: string
  user: UserCtx
  refsOut: (r: SceneRefs) => void
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    refsOut({ wrapper: wrapperRef.current })
  }, [refsOut])

  const isLeft = align === 'left'
  const isRight = align === 'right'
  const stacked = !isLeft && !isRight // 'center' scenes: image above, text below
  const rgb = OVERLAY_BASE[overlayColor] ?? '28,28,30'
  const fs = TITLE_FS[titleSize] ?? TITLE_FS.lg
  const tc = TEXT_COLOR[textColor] ?? '#ffffff'

  return (
    <div
      ref={wrapperRef}
      // Scene 0 is visible on load (it's already in view) — no need to wait for the
      // IntersectionObserver, which avoids a brief flash of an invisible hero on page load.
      className={idx === 0 ? 'iv-scene iv-revealed' : 'iv-scene'}
      style={{
        position: 'relative',
        minHeight: '78vh',
        // The homepage navbar has no spacer (it's meant to float over a full-bleed hero
        // image) — with our solid-background layout, scene 0's content needs its own
        // clearance or the fixed 68px navbar overlaps and hides the top of it.
        paddingTop: idx === 0 ? 68 : 0,
        background: `rgb(${rgb})`,
      }}
    >
      {/* Scene counter */}
      <div style={{
        position: 'absolute', bottom: 28, right: 34, zIndex: 8,
        fontFamily: 'monospace', fontSize: 10,
        color: 'rgba(255,255,255,0.16)', letterSpacing: '0.18em',
      }}>
        {String(idx + 1).padStart(2,'0')} / {String(DEFAULTS.length).padStart(2,'0')}
      </div>

      {/* Scroll hint on first scene */}
      {idx === 0 && (
        <div className="iv-scroll-cue">
          <span>scroll</span>
          <div className="iv-scroll-line" />
        </div>
      )}

      {/* Split layout: media box + text, side by side (or stacked for centered scenes) */}
      <div className={`iv-scene-row${stacked ? ' iv-scene-stacked' : ''}${isRight ? ' iv-scene-reverse' : ''}`}>
        <div className="iv-scene-media">
          <SceneBg imgUrl={imgUrl} videoUrl={videoUrl} />
        </div>

        <div className="iv-scene-text" style={{ textAlign: stacked ? 'center' : isRight ? 'right' : 'left' }}>
          {/* Eyebrow */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18,
            justifyContent: stacked ? 'center' : isRight ? 'flex-end' : 'flex-start',
          }}>
            {(stacked || !isRight) && <div style={{ width: 32, height: 1, background: 'linear-gradient(90deg,transparent,#E8A33D)' }} />}
            <span style={{ fontSize: 14, fontWeight: 900, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#E8A33D' }}>
              {eyebrow}
            </span>
            {!isRight && <div style={{ width: 32, height: 1, background: 'linear-gradient(90deg,#E8A33D,transparent)' }} />}
          </div>

          {/* Title */}
          <h2 style={{ margin: '0 0 1.1rem' }}>
            {title.map((line, li) => (
              <span key={li} style={{
                display: 'block',
                fontSize: fs,
                fontWeight: li === 0 ? 200 : 700,
                letterSpacing: li === 0 ? '-0.06em' : '-0.03em',
                lineHeight: 1.08,
                color: tc,
                fontFamily: 'var(--font-heading)',
                marginBottom: li === 0 ? '0.06em' : 0,
              }}>
                {line}
              </span>
            ))}
          </h2>

          {/* Sub */}
          {sub && (
            <p style={{
              fontSize: 'clamp(0.95rem,1.6vw,1.1rem)', lineHeight: 1.75,
              color: 'rgba(210,228,255,0.56)',
              margin: stacked ? '0 auto 1.8rem' : isRight ? '0 0 1.8rem auto' : '0 0 1.8rem',
              maxWidth: 460,
            }}>
              {sub}
            </p>
          )}

          {/* CTAs — smart routing based on user role */}
          {isFinal ? (
            <div style={{ display: 'flex', gap: 14, justifyContent: stacked ? 'center' : isRight ? 'flex-end' : 'flex-start', flexWrap: 'wrap', marginTop: '1rem' }}>
              {/* "Je suis recruteur" — visible si guest ou recruteur/admin */}
              {(!user || user.role === 'recruiter' || user.role === 'admin') && (
                <Link href={smartHref('recruiter-cta', user)} className="iv-btn-primary">
                  {ctaPrimary || (user?.role === 'recruiter' || user?.role === 'admin' ? 'Mon dashboard recruteur' : 'Je suis recruteur')}
                  <ArrowRight style={{ width: 15, height: 15 }} />
                </Link>
              )}
              {/* "Je suis consultant" — visible si guest ou candidat */}
              {(!user || user.role === 'candidate') && (
                <Link href={smartHref('candidate-cta', user)} className="iv-btn-ghost">
                  {ctaSecondary || (user?.role === 'candidate' ? 'Mon espace consultant' : 'Je suis consultant')}
                  <ArrowRight style={{ width: 15, height: 15 }} />
                </Link>
              )}
            </div>
          ) : (ctaPrimary || cta) ? (
            <div style={{
              display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: '0.25rem',
              justifyContent: stacked ? 'center' : isRight ? 'flex-end' : 'flex-start',
            }}>
              {/* Scene 1 (voir les profils -> CVthèque), 2 (deposit) and 3 (discover) use smart hrefs */}
              <Link
                href={
                  idx === 1 ? smartHref('cvtheque', user)
                  : idx === 2 ? smartHref('deposit', user)
                  : idx === 3 ? smartHref('discover', user)
                  : (cta?.href ?? '/jobs')
                }
                className="iv-btn-primary"
              >
                {ctaPrimary || cta?.label} <ArrowRight style={{ width: 15, height: 15 }} />
              </Link>
              {/* Ghost button scene 0 — "Créer mon profil" hidden if logged in */}
              {(ctaSecondary || ghost) && !user && (
                <Link href={ghost?.href ?? '/register'} className="iv-btn-ghost">
                  {ctaSecondary || ghost?.label}
                </Link>
              )}
            </div>
          ) : null}

          {idx === 0 && (
            <Link href="/contact" className="iv-contact-link">
              Nous contacter
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

// ── SCROLL REVEAL ─────────────────────────────────────────────────────
// No more pinned/sticky "storytelling" scroll (virtual scroll height + scroll-scrubbed
// transforms) — the page now scrolls at normal speed like any regular page. Each scene
// just fades in once when it enters the viewport, via IntersectionObserver + a CSS
// transition (no per-frame JS, no scroll-position math).
function useRevealOnScroll(sceneRefs: React.MutableRefObject<SceneRefs[]>) {
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).classList.add('iv-revealed')
            observer.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.15 },
    )
    for (const refs of sceneRefs.current) {
      if (refs?.wrapper) observer.observe(refs.wrapper)
    }
    return () => observer.disconnect()
  }, [sceneRefs])
}

// ── MAIN ──────────────────────────────────────────────────────────────
interface Props {
  ctaRecruiter: string; ctaCandidate: string
  scenesConfig?: SceneConfig[]
  user?: UserCtx
}

export function ImmersivePage({
  scenesConfig = [], user = null,
}: Props) {
  const sceneRefs = useRef<SceneRefs[]>(
    Array(DEFAULTS.length).fill(null).map(() => ({ wrapper: null }))
  )

  const setRef = useCallback((idx: number) => (r: SceneRefs) => {
    sceneRefs.current[idx] = r
  }, [])

  useRevealOnScroll(sceneRefs)

  // Merge admin config over defaults
  const scenes = DEFAULTS.map((def, i) => {
    const cfg = scenesConfig[i]
    return {
      ...def,
      imgUrl: cfg?.imgUrl || def.img,
      videoUrl: cfg?.videoUrl || undefined,
      title: cfg?.title
        ? cfg.title.split('|').map(s => s.trim())
        : def.title,
      sub: cfg?.sub ?? def.sub,
      eyebrow:       cfg?.eyebrow      || def.eyebrow,
      align:         cfg?.align        || def.align,
      overlayOpacity: cfg?.overlayOpacity ?? 46,
      overlayColor:  cfg?.overlayColor  || 'dark',
      titleSize:     cfg?.titleSize     || 'lg',
      textColor:     cfg?.textColor     || 'white',
      ctaPrimary:    cfg?.ctaPrimary    || undefined,
      ctaSecondary:  cfg?.ctaSecondary  || undefined,
    }
  })

  return (
    <>
      {/* Scenes stack normally in the page flow — scrolling advances at normal speed,
          no pinning, no scroll-jacking. Each scene just fades in once when it comes
          into view (see useRevealOnScroll). */}
      {scenes.map((s, i) => (
        <Scene
          key={i}
          idx={i}
          imgUrl={s.imgUrl}
          videoUrl={s.videoUrl}
          eyebrow={s.eyebrow}
          title={s.title}
          sub={s.sub}
          cta={'cta' in DEFAULTS[i] ? (DEFAULTS[i] as { cta: { label: string; href: string } }).cta : undefined}
          ghost={'ghost' in DEFAULTS[i] ? (DEFAULTS[i] as { ghost: { label: string; href: string } }).ghost : undefined}
          align={s.align}
          isFinal={'isFinal' in DEFAULTS[i]}
          overlayColor={s.overlayColor}
          titleSize={s.titleSize}
          textColor={s.textColor}
          ctaPrimary={s.ctaPrimary}
          ctaSecondary={s.ctaSecondary}
          user={user}
          refsOut={setRef(i)}
        />
      ))}

      {/* Le stats bar + mini-footer internes ont été retirés : redondants avec le
          <SiteFooter> déjà rendu juste après ImmersivePage sur la page d'accueil. */}

      {/* Global styles */}
      <style>{`
        /* Ken Burns — continuous slow zoom+pan makes the image "alive" */
        @keyframes iv-kenburns {
          0%   { transform: scale(1.0) translate(0%, 0%); }
          25%  { transform: scale(1.08) translate(-1.5%, -1%); }
          50%  { transform: scale(1.14) translate(1%, -2%); }
          75%  { transform: scale(1.08) translate(-0.5%, 1.5%); }
          100% { transform: scale(1.0) translate(0%, 0%); }
        }
        .iv-kenburns {
          animation: iv-kenburns 18s ease-in-out infinite;
          will-change: transform;
        }
        /* Fade in once, the first time a scene scrolls into view */
        .iv-scene { opacity: 0; transform: translateY(24px); transition: opacity .7s ease, transform .7s ease; }
        .iv-scene.iv-revealed { opacity: 1; transform: translateY(0); }
        /* Split layout: media box + text, side by side. Normal flow (not absolutely
           positioned) so the row grows with its content instead of being clipped when
           text is taller than the scene's min-height. */
        .iv-scene-row {
          position: relative; z-index: 6; min-height: inherit; box-sizing: border-box;
          display: flex; align-items: center; justify-content: center;
          gap: 5vw; padding: 3.5rem 7vw; flex-direction: row;
        }
        .iv-scene-row.iv-scene-reverse { flex-direction: row-reverse; }
        .iv-scene-row.iv-scene-stacked { flex-direction: column; gap: 2.2rem; }
        .iv-scene-media {
          position: relative; flex-shrink: 0;
          width: min(34vw, 420px); aspect-ratio: 1 / 1;
          border-radius: 22px; overflow: hidden;
          box-shadow: 0 30px 70px -18px rgba(0,0,0,0.55);
          border: 1px solid rgba(232,163,61,0.28);
        }
        .iv-scene-stacked .iv-scene-media { width: min(46vw, 280px); }
        .iv-scene-text { flex: 1; max-width: 520px; min-width: 0; }
        .iv-scene-stacked .iv-scene-text { max-width: 620px; }
        @media (max-width: 860px) {
          .iv-scene-row, .iv-scene-row.iv-scene-reverse {
            flex-direction: column; gap: 1.6rem; padding: 5.5rem 7vw 2rem;
          }
          .iv-scene-media, .iv-scene-stacked .iv-scene-media { width: min(58vw, 260px); }
          .iv-scene-text, .iv-scene-stacked .iv-scene-text { max-width: 100%; text-align: center !important; }
        }
        .iv-scroll-cue {
          position: absolute; bottom: 26px; left: 50%;
          transform: translateX(-50%);
          display: flex; flex-direction: column; align-items: center; gap: 6px;
          z-index: 8; animation: iv-cue 2.4s ease-in-out infinite;
        }
        .iv-scroll-cue span {
          font-size: 15px; color: #E8A33D; font-weight: 700;
          letter-spacing: 0.2em; text-transform: uppercase; font-family: monospace;
        }
        .iv-contact-link {
          display: inline-block; margin-top: 1.1rem;
          font-size: 13px; color: rgba(255,255,255,0.55);
          text-decoration: underline; text-underline-offset: 3px;
          transition: color 0.2s;
        }
        .iv-contact-link:hover { color: #E8A33D; }
        .iv-scroll-line {
          width: 1px; height: 40px;
          background: linear-gradient(to bottom, rgba(232,163,61,0.75), transparent);
        }
        @keyframes iv-cue {
          0%,100% { opacity:.35; transform:translateX(-50%) translateY(0) }
          50%      { opacity:1;   transform:translateX(-50%) translateY(9px) }
        }
        .iv-btn-primary {
          display: inline-flex; align-items: center; gap: 8px;
          padding: .95rem 2.1rem; border-radius: 10px;
          background: linear-gradient(135deg,rgba(44,44,46,.9),rgba(22,36,102,.9));
          border: 1px solid rgba(232,163,61,.42); color: #fff;
          font-weight: 700; font-size: 14px; text-decoration: none;
          backdrop-filter: blur(20px);
          box-shadow: 0 0 40px rgba(44,44,46,.5),0 4px 24px rgba(0,0,0,.3);
          transition: border-color .2s, box-shadow .2s, transform .2s;
          letter-spacing: .02em;
        }
        .iv-btn-primary:hover {
          border-color: rgba(232,163,61,.88);
          box-shadow: 0 0 64px rgba(232,163,61,.2),0 6px 32px rgba(0,0,0,.4);
          transform: translateY(-2px);
        }
        .iv-btn-ghost {
          display: inline-flex; align-items: center; gap: 8px;
          padding: .95rem 2.1rem; border-radius: 10px;
          border: 1px solid rgba(255,255,255,.14);
          background: rgba(28,28,30,.35); backdrop-filter: blur(20px);
          color: rgba(210,228,255,.78); font-weight: 600; font-size: 14px;
          text-decoration: none; letter-spacing: .02em;
          transition: border-color .2s, color .2s, transform .2s;
        }
        .iv-btn-ghost:hover { border-color:rgba(232,163,61,.42); color:#fff; transform:translateY(-2px); }
        .iv-job-card {
          position: relative; overflow: hidden; padding: 24px; border-radius: 16px;
          background: rgba(4,10,30,.82); border: 1px solid rgba(180,200,255,.06);
          backdrop-filter: blur(24px); text-decoration: none; display: block;
          transition: transform .3s cubic-bezier(.16,1,.3,1), border-color .25s, box-shadow .25s;
        }
        .iv-job-card:hover {
          transform: translateY(-5px);
          border-color: rgba(232,163,61,.25);
          box-shadow: 0 24px 60px rgba(44,44,46,.5);
        }
      `}</style>
    </>
  )
}

