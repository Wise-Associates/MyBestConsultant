'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import {
  Save, Loader2, Check, ExternalLink,
  Settings2, BarChart2, Type, Film,
  Monitor, Tablet, Smartphone, AlignLeft, AlignCenter, AlignRight,
  ChevronDown, ChevronUp, Eye, Mail, Building2, X, Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { updateSiteContent } from '@/app/admin/design/actions'
import { ImageUpload } from '@/components/page-builder/image-upload'
import type { HomepageContent } from '@/lib/site-config'

// ── Styles ────────────────────────────────────────────────────────────
const inp = "bg-white/[0.06] border-white/[0.1] text-white/80 placeholder:text-white/25 focus:border-white/30 focus:ring-0 rounded-lg text-sm h-9"
const ta  = "bg-white/[0.06] border-white/[0.1] text-white/80 placeholder:text-white/25 focus:border-white/30 focus:ring-0 rounded-lg text-sm resize-none"

// ── Content tab helpers ─────────────────────────────────────────────────
function ContentSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600, marginBottom: 10 }}>
        {title}
      </p>
      <div className="space-y-2.5">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 4, display: 'block' }}>{label}</Label>
      {children}
    </div>
  )
}

// ── Scene config type (all per-scene settings) ────────────────────────
export type SceneCfg = {
  imgUrl: string
  videoUrl: string
  title: string        // two lines separated by "|"
  sub: string
  eyebrow: string      // override the default eyebrow badge
  align: 'left' | 'center' | 'right'
  titleSize: 'sm' | 'md' | 'lg' | 'xl'
  overlayOpacity: number   // 0–90
  overlayColor: 'dark' | 'navy' | 'warm' | 'none'
  ctaPrimary: string
  ctaSecondary: string
  textColor: 'white' | 'cream' | 'light'
}

export const DEFAULT_SCENE: SceneCfg = {
  imgUrl: '', videoUrl: '', title: '', sub: '', eyebrow: '',
  align: 'center', titleSize: 'lg', overlayOpacity: 50,
  overlayColor: 'dark', ctaPrimary: '', ctaSecondary: '', textColor: 'white',
}

// ── Static per-scene defaults (fallback values for preview) ───────────
const SCENE_META = [
  { key: 'hero',      color: '#818cf8', label: '01 — Hero',       defaultEyebrow: "Recrutement propulsé par l'IA",  defaultImg: 'https://images.pexels.com/photos/1323550/pexels-photo-1323550.jpeg?auto=compress&cs=tinysrgb&w=1200', defaultTitle: 'Votre prochaine | grande opportunité',          defaultSub: 'La plateforme qui connecte les meilleurs talents aux missions qui comptent.', defaultCtaP: 'Publier une offre', defaultCtaS: 'Trouver une mission', defaultAlign: 'center' as const },
  { key: 'talent',    color: '#38bdf8', label: '02 — Talents',     defaultEyebrow: '15 000+ consultants',           defaultImg: 'https://images.pexels.com/photos/3184291/pexels-photo-3184291.jpeg?auto=compress&cs=tinysrgb&w=1200', defaultTitle: 'Les talents | qui font bouger les lignes',      defaultSub: "Consultants senior, freelances d'élite — tous présélectionnés.",              defaultCtaP: 'Explorer',          defaultCtaS: '',                   defaultAlign: 'left'   as const },
  { key: 'companies', color: '#34d399', label: '03 — Entreprises', defaultEyebrow: '380+ entreprises partenaires',  defaultImg: 'https://images.pexels.com/photos/1486785/pexels-photo-1486785.jpeg?auto=compress&cs=tinysrgb&w=1200', defaultTitle: 'Les meilleures | entreprises vous cherchent',   defaultSub: "McKinsey, BNP Paribas, Accenture — publiez vos missions en 60 secondes.",     defaultCtaP: 'Je recrute',        defaultCtaS: '',                   defaultAlign: 'right'  as const },
  { key: 'ai',        color: '#fbbf24', label: '04 — IA',          defaultEyebrow: 'Intelligence artificielle',     defaultImg: 'https://images.pexels.com/photos/8386440/pexels-photo-8386440.jpeg?auto=compress&cs=tinysrgb&w=1200', defaultTitle: 'Screening CV | en 8 secondes',                 defaultSub: "L'IA analyse votre profil, score /100, entretien virtuel automatisé.",        defaultCtaP: 'Voir comment',      defaultCtaS: '',                   defaultAlign: 'center' as const },
  { key: 'portal',    color: '#f472b6', label: '05 — Portail',     defaultEyebrow: 'Choisissez votre voie',         defaultImg: 'https://images.pexels.com/photos/3225517/pexels-photo-3225517.jpeg?auto=compress&cs=tinysrgb&w=1200', defaultTitle: 'Prêt à entrer | dans un nouveau monde ?',       defaultSub: '',                                                                            defaultCtaP: 'Je suis recruteur', defaultCtaS: 'Je suis consultant', defaultAlign: 'center' as const },
]

const TITLE_SIZES: Record<string, { base: number; scale: number }> = {
  sm: { base: 1.4, scale: 0.85 },
  md: { base: 1.9, scale: 1.0  },
  lg: { base: 2.4, scale: 1.0  },
  xl: { base: 3.0, scale: 1.0  },
}

const OVERLAY_COLORS: Record<string, string> = {
  dark:  'rgba(1,4,18,VAR)',
  navy:  'rgba(11,29,81,VAR)',
  warm:  'rgba(40,20,0,VAR)',
  none:  'transparent',
}

type Device = 'desktop' | 'tablet' | 'mobile'
type GlobalCfg = {
  siteName: string; siteTagline: string; logoUrl: string
  heroCtaRecruiter: string; heroCtaCandidate: string
  statsJobs: string; statsCompanies: string; statsCandidates: string
  footerText: string; contactEmail: string; googleTagId: string
}

// ── Helper: resolve scene value with fallback ─────────────────────────
function rv<K extends keyof SceneCfg>(s: SceneCfg, key: K, fallback: SceneCfg[K]): SceneCfg[K] {
  const v = s[key]
  if (v === undefined || v === null || v === '') return fallback
  return v
}

// ── Label component ───────────────────────────────────────────────────
function F({ label, children, hint }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-white/30 uppercase tracking-widest">{label}</Label>
      {children}
      {hint && <p className="text-[10px] text-white/20">{hint}</p>}
    </div>
  )
}

// ── Chip button ───────────────────────────────────────────────────────
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all border ${
        active
          ? 'bg-white/[0.12] border-white/20 text-white'
          : 'bg-transparent border-white/[0.08] text-white/30 hover:text-white/50 hover:border-white/15'
      }`}>
      {children}
    </button>
  )
}

// ── Slider ────────────────────────────────────────────────────────────
function Slider({ value, onChange, min = 0, max = 100, step = 5 }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number
}) {
  return (
    <div className="flex items-center gap-2">
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 h-1 accent-white/60 cursor-pointer" />
      <span className="text-[11px] text-white/40 w-8 text-right tabular-nums">{value}%</span>
    </div>
  )
}

// ── Single scene renderer (used in both preview and thumbnail) ────────
function SceneBlock({
  scene, meta, idx, active, onClick, device, compact = false,
}: {
  scene: SceneCfg; meta: typeof SCENE_META[0]; idx: number
  active?: boolean; onClick?: () => void; device?: Device; compact?: boolean
}) {
  const img        = rv(scene, 'imgUrl',   meta.defaultImg)
  const titleRaw   = rv(scene, 'title',    meta.defaultTitle)
  const sub        = rv(scene, 'sub',      meta.defaultSub)
  const eyebrow    = rv(scene, 'eyebrow',  meta.defaultEyebrow)
  const align      = rv(scene, 'align',    meta.defaultAlign)
  const opacity    = rv(scene, 'overlayOpacity', 50)
  const oColor     = rv(scene, 'overlayColor',   'dark')
  const tsKey      = rv(scene, 'titleSize',       'lg')
  const ctaP       = rv(scene, 'ctaPrimary',  meta.defaultCtaP)
  const ctaS       = rv(scene, 'ctaSecondary', meta.defaultCtaS)
  const textColor  = rv(scene, 'textColor', 'white')

  const [l1, l2] = titleRaw.split('|').map(t => t.trim())
  const ts = TITLE_SIZES[tsKey] ?? TITLE_SIZES.lg
  const fontSize = compact ? ts.base * 0.42 : (device === 'mobile' ? ts.base * 0.7 : ts.base)

  const jc = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'
  const ta = align as 'left' | 'center' | 'right'

  const overlayAlpha = `${opacity / 100}`
  const overlayBg = OVERLAY_COLORS[oColor]?.replace('VAR', overlayAlpha) ?? `rgba(1,4,18,${overlayAlpha})`

  const dirOverlay = align === 'left'
    ? `linear-gradient(to right, ${overlayBg} 30%, transparent 65%)`
    : align === 'right'
    ? `linear-gradient(to left, ${overlayBg} 30%, transparent 65%)`
    : `radial-gradient(ellipse 70% 70% at 50% 50%, transparent 20%, ${overlayBg} 80%)`

  const tc = textColor === 'cream' ? 'rgba(255,248,230,0.95)' : textColor === 'light' ? 'rgba(200,220,255,0.85)' : '#ffffff'
  const subColor = textColor === 'cream' ? 'rgba(255,240,200,0.5)' : 'rgba(210,228,255,0.5)'

  const minH = compact ? 90 : (device === 'mobile' ? 260 : 340)

  // Thumbnail (sidebar list) keeps the old full-bleed style — it's a tiny icon, not
  // the real preview, so pixel-fidelity to the live page doesn't matter there.
  if (compact) {
    return (
      <section
        onClick={onClick}
        className={`relative overflow-hidden flex items-center select-none ${onClick ? 'cursor-pointer' : ''}`}
        style={{ minHeight: minH }}
      >
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${img})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
        <div style={{ position: 'absolute', inset: 0, background: overlayBg }} />
        <div style={{ position: 'absolute', inset: 0, background: dirOverlay }} />
        {active && <div style={{ position: 'absolute', inset: 0, boxShadow: `inset 0 0 0 2px ${meta.color}`, pointerEvents: 'none', zIndex: 10 }} />}
        <div style={{ position: 'relative', zIndex: 2, width: '100%', padding: '6px 8%', display: 'flex', justifyContent: jc }}>
          <div style={{ maxWidth: '80%', textAlign: ta }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center' }}>
              {align !== 'right' && <div style={{ width: 12, height: 1, background: 'linear-gradient(90deg, transparent, #B8860B)' }} />}
              <span style={{ fontSize: 6, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#B8860B' }}>{eyebrow}</span>
              {align !== 'left' && <div style={{ width: 12, height: 1, background: 'linear-gradient(90deg, #B8860B, transparent)' }} />}
            </div>
            <h2 style={{ margin: '0 0 4px', lineHeight: 1.06 }}>
              <span style={{ display: 'block', fontSize: `${fontSize}rem`, fontWeight: 200, letterSpacing: '-0.05em', color: tc }}>{l1}</span>
              {l2 && <span style={{ display: 'block', fontSize: `${fontSize * ts.scale}rem`, fontWeight: 700, letterSpacing: '-0.03em', color: tc }}>{l2}</span>}
            </h2>
          </div>
        </div>
      </section>
    )
  }

  // Real preview — mirrors the live ImmersivePage split layout: media box + text,
  // side by side (or stacked when centered), solid background instead of a full-bleed image.
  const rgb = oColor === 'navy' ? '11,29,81' : oColor === 'warm' ? '40,20,0' : '1,4,18'
  const stacked = align === 'center'
  const mediaSide = align === 'right' ? 'row-reverse' : 'row'

  return (
    <section
      onClick={onClick}
      className={`relative overflow-hidden select-none ${onClick ? 'cursor-pointer' : ''}`}
      style={{ minHeight: minH, background: `rgb(${rgb})` }}
    >
      {scene.videoUrl && (
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 3, display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 99, background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: 9 }}>
          <Film size={8} /> vidéo
        </div>
      )}
      <div style={{ position: 'absolute', top: 8, left: 10, zIndex: 3, fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.18)', letterSpacing: '0.1em' }}>
        0{idx + 1}
      </div>
      {active && <div style={{ position: 'absolute', inset: 0, boxShadow: `inset 0 0 0 2px ${meta.color}`, pointerEvents: 'none', zIndex: 10 }} />}

      <div style={{
        position: 'relative', zIndex: 2, width: '100%', height: minH,
        display: 'flex', flexDirection: stacked ? 'column' : mediaSide,
        alignItems: 'center', justifyContent: 'center',
        gap: device === 'mobile' ? 14 : 24, padding: device === 'mobile' ? '2rem 6%' : '1.5rem 6%',
      }}>
        <div style={{
          flexShrink: 0, width: stacked ? (device === 'mobile' ? 90 : 130) : (device === 'mobile' ? 80 : 120),
          aspectRatio: '1 / 1', borderRadius: 12, overflow: 'hidden',
          border: '1px solid rgba(184,134,11,0.3)', boxShadow: '0 10px 24px -8px rgba(0,0,0,0.5)',
          backgroundImage: `url(${img})`, backgroundSize: 'cover', backgroundPosition: 'center',
        }} />

        <div style={{ flex: stacked ? undefined : 1, maxWidth: stacked ? 420 : 320, textAlign: stacked ? 'center' : ta, minWidth: 0 }}>
          {/* Eyebrow */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
            justifyContent: stacked ? 'center' : align === 'left' ? 'flex-start' : 'flex-end',
          }}>
            {(stacked || align === 'left') && <div style={{ width: 16, height: 1, background: 'linear-gradient(90deg, transparent, #B8860B)' }} />}
            <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#B8860B' }}>{eyebrow}</span>
            {(stacked || align === 'right') && <div style={{ width: 16, height: 1, background: 'linear-gradient(90deg, #B8860B, transparent)' }} />}
          </div>

          {/* Title */}
          <h2 style={{ margin: '0 0 8px', lineHeight: 1.08 }}>
            <span style={{ display: 'block', fontSize: `${fontSize}rem`, fontWeight: 200, letterSpacing: '-0.05em', color: tc }}>{l1}</span>
            {l2 && <span style={{ display: 'block', fontSize: `${fontSize * ts.scale}rem`, fontWeight: 700, letterSpacing: '-0.03em', color: tc }}>{l2}</span>}
          </h2>

          {/* Sub */}
          {sub && (
            <p style={{ fontSize: device === 'mobile' ? '0.68rem' : '0.76rem', color: subColor, lineHeight: 1.6, margin: stacked ? '0 auto 10px' : align === 'left' ? '0 0 10px' : '0 0 10px auto' }}>
              {sub}
            </p>
          )}

          {/* CTAs */}
          {(ctaP || ctaS) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: stacked ? 'center' : align === 'left' ? 'flex-start' : 'flex-end' }}>
              {ctaP && <span style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 14px', borderRadius: 8, background: 'linear-gradient(135deg,rgba(11,29,81,0.9),rgba(22,36,102,0.9))', border: '1px solid rgba(184,134,11,0.45)', color: '#fff', fontSize: 11, fontWeight: 700 }}>{ctaP}</span>}
              {ctaS && <span style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(210,228,255,0.8)', fontSize: 11, fontWeight: 600 }}>{ctaS}</span>}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// ── Left panel: scene detail editor ──────────────────────────────────
function SceneEditor({ scene, meta, onChange }: {
  scene: SceneCfg; meta: typeof SCENE_META[0]; onChange: (key: keyof SceneCfg, val: string | number) => void
}) {
  return (
    <div className="space-y-4 p-3">
      {/* Media */}
      <div>
        <p className="text-[9px] text-white/20 uppercase tracking-widest font-semibold mb-2">Média</p>
        <div className="space-y-3">
          <ImageUpload label="Image de fond" value={scene.imgUrl} onChange={v => onChange('imgUrl', v)} />
          <F label="Vidéo .mp4 (priorité sur l'image)" hint="URL directe vers un .mp4 hébergé">
            <Input value={scene.videoUrl} onChange={e => onChange('videoUrl', e.target.value)} placeholder="https://…/video.mp4" className={inp} />
          </F>
        </div>
      </div>

      {/* Overlay */}
      <div>
        <p className="text-[9px] text-white/20 uppercase tracking-widest font-semibold mb-2">Overlay</p>
        <div className="space-y-2">
          <F label="Couleur d'overlay">
            <div className="flex gap-1.5 flex-wrap">
              {(['dark', 'navy', 'warm', 'none'] as const).map(c => (
                <Chip key={c} active={rv(scene, 'overlayColor', 'dark') === c} onClick={() => onChange('overlayColor', c)}>
                  {{ dark: 'Noir', navy: 'Marine', warm: 'Chaud', none: 'Aucun' }[c]}
                </Chip>
              ))}
            </div>
          </F>
          <F label={`Opacité — ${rv(scene, 'overlayOpacity', 50)}%`}>
            <Slider value={rv(scene, 'overlayOpacity', 50) as number} onChange={v => onChange('overlayOpacity', v)} />
          </F>
        </div>
      </div>

      {/* Texte */}
      <div>
        <p className="text-[9px] text-white/20 uppercase tracking-widest font-semibold mb-2">Texte</p>
        <div className="space-y-2.5">
          <F label="Accroche (eyebrow)">
            <Input value={scene.eyebrow} onChange={e => onChange('eyebrow', e.target.value)} placeholder={meta.defaultEyebrow} className={inp} />
          </F>
          <F label='Titre (2 lignes avec "|")' hint={`Ex: Votre titre | en deux lignes`}>
            <Input value={scene.title} onChange={e => onChange('title', e.target.value)} placeholder={meta.defaultTitle} className={inp} />
          </F>
          <F label="Sous-titre">
            <Textarea value={scene.sub} onChange={e => onChange('sub', e.target.value)} placeholder={meta.defaultSub} className={ta} rows={2} />
          </F>
        </div>
      </div>

      {/* Mise en page */}
      <div>
        <p className="text-[9px] text-white/20 uppercase tracking-widest font-semibold mb-2">Mise en page</p>
        <div className="space-y-2.5">
          <F label="Alignement du contenu">
            <div className="flex gap-1.5">
              {(['left', 'center', 'right'] as const).map(a => {
                const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight
                return (
                  <button key={a} onClick={() => onChange('align', a)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-semibold transition-all ${rv(scene, 'align', 'center') === a ? 'bg-white/[0.12] border-white/20 text-white' : 'border-white/[0.08] text-white/30 hover:text-white/50'}`}>
                    <Icon className="h-3.5 w-3.5" />
                    {{ left: 'Gauche', center: 'Centre', right: 'Droite' }[a]}
                  </button>
                )
              })}
            </div>
          </F>
          <F label="Taille du titre">
            <div className="flex gap-1.5 flex-wrap">
              {(['sm', 'md', 'lg', 'xl'] as const).map(s => (
                <Chip key={s} active={rv(scene, 'titleSize', 'lg') === s} onClick={() => onChange('titleSize', s)}>
                  {{ sm: 'Petit', md: 'Moyen', lg: 'Grand', xl: 'XL' }[s]}
                </Chip>
              ))}
            </div>
          </F>
          <F label="Couleur du texte">
            <div className="flex gap-1.5 flex-wrap">
              {(['white', 'cream', 'light'] as const).map(c => (
                <Chip key={c} active={rv(scene, 'textColor', 'white') === c} onClick={() => onChange('textColor', c)}>
                  {{ white: 'Blanc pur', cream: 'Crème', light: 'Bleu clair' }[c]}
                </Chip>
              ))}
            </div>
          </F>
        </div>
      </div>

      {/* CTAs */}
      <div>
        <p className="text-[9px] text-white/20 uppercase tracking-widest font-semibold mb-2">Boutons</p>
        <div className="space-y-2">
          <F label="Bouton principal">
            <Input value={scene.ctaPrimary} onChange={e => onChange('ctaPrimary', e.target.value)} placeholder={meta.defaultCtaP} className={inp} />
          </F>
          <F label="Bouton secondaire (optionnel)">
            <Input value={scene.ctaSecondary} onChange={e => onChange('ctaSecondary', e.target.value)} placeholder={meta.defaultCtaS || '(vide = masqué)'} className={inp} />
          </F>
        </div>
      </div>
    </div>
  )
}

// ── Full page preview (scrollable) ────────────────────────────────────
function FullPreview({ scenes, global: g, cssVars, activeScene, onSceneClick, device }: {
  scenes: SceneCfg[]
  global: GlobalCfg
  cssVars: string
  activeScene: number | null
  onSceneClick: (i: number) => void
  device: Device
}) {
  const WIDTHS: Record<Device, string> = { desktop: '100%', tablet: '768px', mobile: '390px' }

  return (
    <div style={{
      width: WIDTHS[device], maxWidth: WIDTHS[device],
      margin: '0 auto',
      transition: 'width 0.3s ease',
      boxShadow: device !== 'desktop' ? '0 0 0 1px rgba(255,255,255,0.06),0 8px 40px rgba(0,0,0,0.6)' : 'none',
      borderRadius: device !== 'desktop' ? 16 : 0,
      overflow: 'hidden',
      background: '#01040a',
    }}>
      {/* Navbar stub */}
      <nav style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 1.5rem', background: 'rgba(1,4,18,0.97)', borderBottom: '1px solid rgba(184,134,11,0.1)', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {g.logoUrl
            ? <img src={g.logoUrl} alt="" style={{ height: 28, width: 'auto', objectFit: 'contain' }} />
            : <>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: 'linear-gradient(135deg,#0B1D51,#162466)', border: '1px solid rgba(184,134,11,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, color: '#B8860B' }}>M</div>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#e8eaf6' }}>{g.siteName || 'MyBestConsultant'}</span>
              </>
          }
        </div>
        <span style={{ padding: '6px 14px', borderRadius: 8, background: 'linear-gradient(135deg,#0B1D51,#162466)', border: '1px solid rgba(184,134,11,0.3)', color: '#fff', fontSize: 11, fontWeight: 700 }}>
          {g.heroCtaRecruiter || 'Publier une offre'}
        </span>
      </nav>

      {/* Scenes */}
      {SCENE_META.map((meta, i) => (
        <SceneBlock
          key={meta.key} scene={scenes[i]} meta={meta} idx={i}
          active={activeScene === i} onClick={() => onSceneClick(i)}
          device={device}
        />
      ))}

      {/* Le stats bar + mini-footer internes ont ete retires de la vraie page (redondants
          avec le vrai <SiteFooter>) -- retires ici aussi pour que l'apercu reste fidele. */}
    </div>
  )
}

// ── MAIN EDITOR ───────────────────────────────────────────────────────
type InitialConfig = GlobalCfg & { scenes: SceneCfg[]; trustedLogos: string[]; homepageContent: HomepageContent }

export function HomepageEditor({ initialConfig, initialCssVars, pageId }: { initialConfig: InitialConfig; initialCssVars: string; pageId: string }) {
  const [global, setGlobal] = useState<GlobalCfg>({
    siteName: initialConfig.siteName,
    siteTagline: initialConfig.siteTagline,
    logoUrl: initialConfig.logoUrl,
    heroCtaRecruiter: initialConfig.heroCtaRecruiter,
    heroCtaCandidate: initialConfig.heroCtaCandidate,
    statsJobs: initialConfig.statsJobs,
    statsCompanies: initialConfig.statsCompanies,
    statsCandidates: initialConfig.statsCandidates,
    footerText: initialConfig.footerText,
    contactEmail: initialConfig.contactEmail,
    googleTagId: initialConfig.googleTagId,
  })
  const [scenes, setScenes] = useState<SceneCfg[]>(initialConfig.scenes)
  const [trustedLogos, setTrustedLogos] = useState<string[]>(initialConfig.trustedLogos)
  const [homepageContent, setHomepageContent] = useState<HomepageContent>(initialConfig.homepageContent)
  const [activeScene, setActiveScene] = useState<number | null>(0)
  const [tab, setTab] = useState<'scenes' | 'global' | 'content'>('content')
  const [device, setDevice] = useState<Device>('desktop')
  const [expandedScenes, setExpandedScenes] = useState<Set<number>>(new Set([0]))
  const [isPending, startTransition] = useTransition()
  const [saveStatus, setSaveStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const setupDone = useRef(false)

  // Inject CSS vars
  useEffect(() => {
    if (!initialCssVars) return
    let el = document.getElementById('mbc-vars') as HTMLStyleElement | null
    if (!el) { el = document.createElement('style'); el.id = 'mbc-vars'; document.head.appendChild(el) }
    el.textContent = `:root { ${initialCssVars} }`
    return () => { el?.remove() }
  }, [initialCssVars])

  // Auto-setup Appwrite attributes
  useEffect(() => {
    if (setupDone.current) return
    setupDone.current = true
    fetch('/api/admin/setup-attrs', { method: 'POST' }).catch(() => {})
  }, [])

  function setSceneField(i: number, key: keyof SceneCfg, val: string | number) {
    setScenes(prev => prev.map((s, idx) => idx === i ? { ...s, [key]: val } : s))
  }

  function setContentField(key: keyof HomepageContent, val: string) {
    setHomepageContent(prev => ({ ...prev, [key]: val }))
  }

  function toggleExpand(i: number) {
    setExpandedScenes(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  function handleSceneClick(i: number) {
    setActiveScene(i)
    setTab('scenes')
    setExpandedScenes(prev => new Set([...prev, i]))
    // scroll left panel to that scene
    const el = document.getElementById(`scene-panel-${i}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function save() {
    setSaveStatus('idle')
    startTransition(async () => {
      // Ensure all Appwrite attributes exist (incl. scenesJson) before saving
      await fetch('/api/admin/setup-attrs', { method: 'POST' }).catch(() => {})

      const payload: Record<string, string> = {
        siteName: global.siteName,
        siteTagline: global.siteTagline,
        logoUrl: global.logoUrl,
        heroCtaRecruiter: global.heroCtaRecruiter,
        heroCtaCandidate: global.heroCtaCandidate,
        statsJobs: global.statsJobs,
        statsCompanies: global.statsCompanies,
        statsCandidates: global.statsCandidates,
        footerText: global.footerText,
        contactEmail: global.contactEmail,
        googleTagId: global.googleTagId,
        scenesJson: JSON.stringify(scenes),
        trustedLogosJson: JSON.stringify(trustedLogos),
        homepageContentJson: JSON.stringify(homepageContent),
      }
      const r = await updateSiteContent(payload)
      if ('error' in r) { setSaveStatus('error'); setErrorMsg(r.error) }
      else { setSaveStatus('ok'); setTimeout(() => setSaveStatus('idle'), 4000) }
    })
  }

  const curScene = activeScene !== null ? scenes[activeScene] : null
  const curMeta = activeScene !== null ? SCENE_META[activeScene] : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0A0C10', color: '#fff', overflow: 'hidden' }}>

      {/* ── TOP BAR ── */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', height: 48, borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        <Film size={16} color="#818cf8" />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>Éditeur immersif</span>

        {/* Device switcher */}
        <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', marginLeft: 8 }}>
          {([['desktop', Monitor], ['tablet', Tablet], ['mobile', Smartphone]] as [Device, React.ElementType][]).map(([d, Icon]) => (
            <button key={d} onClick={() => setDevice(d)}
              style={{ padding: '5px 8px', borderRadius: 8, background: device === d ? 'rgba(255,255,255,0.1)' : 'transparent', color: device === d ? '#fff' : 'rgba(255,255,255,0.25)', border: 'none', cursor: 'pointer', display: 'flex', transition: 'all 0.15s' }}>
              <Icon size={14} />
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {saveStatus === 'error' && (
          <span style={{ fontSize: 11, color: '#f87171', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ✗ {errorMsg}
          </span>
        )}

        <a href={`/admin/pages/${pageId}`}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)', fontSize: 11, color: 'rgba(255,255,255,0.3)', textDecoration: 'none', transition: 'color 0.15s' }}>
          <Plus size={12} /> Sections additionnelles
        </a>

        <a href="/" target="_blank" rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)', fontSize: 11, color: 'rgba(255,255,255,0.3)', textDecoration: 'none', transition: 'color 0.15s' }}>
          <Eye size={12} /> Aperçu live
        </a>

        <Button onClick={save} disabled={isPending} size="sm"
          className={`gap-1.5 font-semibold text-sm px-4 h-8 ${
            saveStatus === 'ok'    ? 'bg-emerald-500 hover:bg-emerald-400 text-white' :
            saveStatus === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                                     'bg-white text-black hover:bg-white/90'
          }`}>
          {isPending         ? <Loader2 size={13} className="animate-spin" /> :
           saveStatus==='ok' ? <Check size={13} /> : <Save size={13} />}
          {isPending ? 'Sauvegarde…' : saveStatus==='ok' ? 'Sauvegardé !' : 'Sauvegarder'}
        </Button>
      </header>

      {/* ── BODY ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── LEFT PANEL ── */}
        <aside style={{ width: 300, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0c0e14' }}>

          {/* Tab switcher */}
          <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
            {([['content', '📝 Contenu'], ['scenes', '🎬 Scènes'], ['global', '⚙️ Site']] as const).map(([t, lbl]) => (
              <button key={t} onClick={() => setTab(t)}
                style={{ flex: 1, padding: '10px 0', fontSize: 11, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', color: tab === t ? '#fff' : 'rgba(255,255,255,0.3)', borderBottom: tab === t ? '2px solid #818cf8' : '2px solid transparent', transition: 'all 0.15s' }}>
                {lbl}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* CONTENT TAB — text for the 5 live homepage sections (hero/mission/about/features/testimonials) */}
            {tab === 'content' && (
              <div style={{ padding: 12 }}>
                <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', padding: '0 0 12px', lineHeight: 1.6 }}>
                  Textes réellement affichés sur la page d&apos;accueil publique. Les images, icônes et
                  cartes de fonctionnalités restent gérées dans le code.
                </p>

                <ContentSection title="Hero">
                  <Field label="Texte au-dessus des cartes">
                    <Textarea className={ta} rows={2} value={homepageContent.heroCaption} onChange={e => setContentField('heroCaption', e.target.value)} />
                  </Field>
                </ContentSection>

                <ContentSection title="Notre mission">
                  <Field label="Badge (eyebrow)"><Input className={inp} value={homepageContent.missionEyebrow} onChange={e => setContentField('missionEyebrow', e.target.value)} /></Field>
                  <Field label="Titre — ligne 1"><Input className={inp} value={homepageContent.missionTitleLine1} onChange={e => setContentField('missionTitleLine1', e.target.value)} /></Field>
                  <Field label="Titre — ligne 2 (orange)"><Input className={inp} value={homepageContent.missionTitleLine2} onChange={e => setContentField('missionTitleLine2', e.target.value)} /></Field>
                  <Field label="Sous-titre"><Input className={inp} value={homepageContent.missionSubtitle} onChange={e => setContentField('missionSubtitle', e.target.value)} /></Field>
                  <Field label="Bouton d'action"><Input className={inp} value={homepageContent.missionCta} onChange={e => setContentField('missionCta', e.target.value)} /></Field>
                </ContentSection>

                <ContentSection title="Qui sommes-nous">
                  <Field label="Badge (eyebrow)"><Input className={inp} value={homepageContent.aboutEyebrow} onChange={e => setContentField('aboutEyebrow', e.target.value)} /></Field>
                  <Field label="Titre"><Textarea className={ta} rows={2} value={homepageContent.aboutTitle} onChange={e => setContentField('aboutTitle', e.target.value)} /></Field>
                  <Field label="Paragraphe 1"><Textarea className={ta} rows={3} value={homepageContent.aboutParagraph1} onChange={e => setContentField('aboutParagraph1', e.target.value)} /></Field>
                  <Field label="Paragraphe 2"><Textarea className={ta} rows={3} value={homepageContent.aboutParagraph2} onChange={e => setContentField('aboutParagraph2', e.target.value)} /></Field>
                  <Field label="Phrase différenciante"><Textarea className={ta} rows={3} value={homepageContent.aboutDifferentiator} onChange={e => setContentField('aboutDifferentiator', e.target.value)} /></Field>
                </ContentSection>

                <ContentSection title="Fonctionnalités">
                  <Field label="Titre de section"><Input className={inp} value={homepageContent.featuresTitle} onChange={e => setContentField('featuresTitle', e.target.value)} /></Field>
                  <Field label="Sous-titre"><Textarea className={ta} rows={2} value={homepageContent.featuresSubtitle} onChange={e => setContentField('featuresSubtitle', e.target.value)} /></Field>
                </ContentSection>

                <ContentSection title="Témoignages">
                  <Field label="Titre de section"><Textarea className={ta} rows={2} value={homepageContent.testimonialsTitle} onChange={e => setContentField('testimonialsTitle', e.target.value)} /></Field>
                  <Field label="Bandeau CTA — titre"><Input className={inp} value={homepageContent.testimonialsCtaTitle} onChange={e => setContentField('testimonialsCtaTitle', e.target.value)} /></Field>
                  <Field label="Bandeau CTA — sous-titre"><Input className={inp} value={homepageContent.testimonialsCtaSubtitle} onChange={e => setContentField('testimonialsCtaSubtitle', e.target.value)} /></Field>
                  <Field label="Bandeau CTA — bouton"><Input className={inp} value={homepageContent.testimonialsCtaButton} onChange={e => setContentField('testimonialsCtaButton', e.target.value)} /></Field>
                </ContentSection>
              </div>
            )}

            {/* SCENES TAB */}
            {tab === 'scenes' && (
              <div>
                <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', padding: '8px 12px 4px', lineHeight: 1.6 }}>
                  Cliquez sur une scène dans le preview pour la sélectionner. Laissez un champ vide = valeur par défaut.
                </p>
                {SCENE_META.map((meta, i) => {
                  const expanded = expandedScenes.has(i)
                  const isActive = activeScene === i
                  return (
                    <div key={i} id={`scene-panel-${i}`}
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', transition: 'background 0.15s', background: isActive ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                      {/* Scene header */}
                      <button
                        onClick={() => { setActiveScene(i); toggleExpand(i) }}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', borderLeft: `3px solid ${isActive ? meta.color : 'transparent'}`, transition: 'all 0.15s' }}>
                        {/* Mini thumbnail */}
                        <div style={{ width: 44, height: 28, borderRadius: 6, overflow: 'hidden', flexShrink: 0, border: `1px solid ${isActive ? meta.color + '55' : 'rgba(255,255,255,0.1)'}` }}>
                          <SceneBlock scene={scenes[i]} meta={meta} idx={i} compact device="desktop" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                          <p style={{ fontSize: 11, fontWeight: 600, color: isActive ? '#fff' : 'rgba(255,255,255,0.55)', margin: 0 }}>{meta.label}</p>
                          <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {(scenes[i]?.title || meta.defaultTitle).replace('|', '·').slice(0, 40)}
                          </p>
                        </div>
                        {expanded ? <ChevronUp size={12} color="rgba(255,255,255,0.25)" /> : <ChevronDown size={12} color="rgba(255,255,255,0.25)" />}
                      </button>

                      {/* Expanded editor */}
                      {expanded && (
                        <SceneEditor
                          scene={scenes[i]}
                          meta={meta}
                          onChange={(key, val) => setSceneField(i, key, val)}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* GLOBAL TAB */}
            {tab === 'global' && (
              <div style={{ padding: 12 }}>

                {/* Identité */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    <Settings2 size={12} color="rgba(255,255,255,0.25)" />
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>Identité</span>
                  </div>
                  <div className="space-y-2.5">
                    <F label="Nom du site"><Input value={global.siteName} onChange={e => setGlobal(p => ({ ...p, siteName: e.target.value }))} className={inp} /></F>
                    <F label="Tagline"><Input value={global.siteTagline} onChange={e => setGlobal(p => ({ ...p, siteTagline: e.target.value }))} className={inp} /></F>
                    <ImageUpload label="Logo" value={global.logoUrl} onChange={v => setGlobal(p => ({ ...p, logoUrl: v }))} />
                  </div>
                </div>

                {/* Stats */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    <BarChart2 size={12} color="rgba(255,255,255,0.25)" />
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>Stats</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <F label="Missions"><Input value={global.statsJobs} onChange={e => setGlobal(p => ({ ...p, statsJobs: e.target.value }))} className={inp} placeholder="2 400+" /></F>
                    <F label="Entreprises"><Input value={global.statsCompanies} onChange={e => setGlobal(p => ({ ...p, statsCompanies: e.target.value }))} className={inp} placeholder="380+" /></F>
                    <F label="Consultants"><Input value={global.statsCandidates} onChange={e => setGlobal(p => ({ ...p, statsCandidates: e.target.value }))} className={inp} placeholder="15 000+" /></F>
                  </div>
                </div>

                {/* CTAs */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    <Type size={12} color="rgba(255,255,255,0.25)" />
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>Boutons navbar</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <F label="Recruteur"><Input value={global.heroCtaRecruiter} onChange={e => setGlobal(p => ({ ...p, heroCtaRecruiter: e.target.value }))} className={inp} /></F>
                    <F label="Candidat"><Input value={global.heroCtaCandidate} onChange={e => setGlobal(p => ({ ...p, heroCtaCandidate: e.target.value }))} className={inp} /></F>
                  </div>
                </div>

                {/* Footer */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    <Type size={12} color="rgba(255,255,255,0.25)" />
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>Footer</span>
                  </div>
                  <F label="Texte copyright"><Input value={global.footerText} onChange={e => setGlobal(p => ({ ...p, footerText: e.target.value }))} className={inp} /></F>
                </div>

                {/* Contact */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    <Mail size={12} color="rgba(255,255,255,0.25)" />
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>Contact</span>
                  </div>
                  <F label="Email de contact" hint="Lien « Nous contacter » affiché sur l'accueil (ouvre le client mail du visiteur)">
                    <Input type="email" value={global.contactEmail} onChange={e => setGlobal(p => ({ ...p, contactEmail: e.target.value }))} className={inp} placeholder="contact@mybestconsultant.fr" />
                  </F>
                </div>

                {/* SEO / Google Ads */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    <BarChart2 size={12} color="rgba(255,255,255,0.25)" />
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>SEO &amp; Google Ads</span>
                  </div>
                  <F label="ID de suivi Google (Ads / Analytics)" hint="Format G-XXXXXXX ou AW-XXXXXXXXX. Laissez vide tant que vous n'avez pas de compte — le suivi ne s'active qu'avec un ID renseigné.">
                    <Input value={global.googleTagId} onChange={e => setGlobal(p => ({ ...p, googleTagId: e.target.value }))} className={inp} placeholder="G-XXXXXXXXXX" />
                  </F>
                </div>

                {/* Logos partenaires */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    <Building2 size={12} color="rgba(255,255,255,0.25)" />
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>
                      Logos partenaires (&quot;Ils nous ont fait confiance&quot;)
                    </span>
                  </div>
                  <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginBottom: 10 }}>
                    Bandeau défilant sous la page d&apos;accueil — ajoutez autant de logos que nécessaire.
                  </p>
                  <div className="space-y-2 mb-2.5">
                    {trustedLogos.map((url, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <ImageUpload label={`Logo ${i + 1}`} value={url} onChange={v => setTrustedLogos(prev => prev.map((u, j) => j === i ? v : u))} />
                        </div>
                        <button onClick={() => setTrustedLogos(prev => prev.filter((_, j) => j !== i))}
                          style={{ padding: 6, borderRadius: 8, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setTrustedLogos(prev => [...prev, ''])}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'rgba(255,255,255,0.4)', padding: '6px 10px', borderRadius: 8, border: '1px dashed rgba(255,255,255,0.15)' }}>
                    <Plus size={12} />Ajouter un logo
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* ── RIGHT: live preview (scrollable) ── */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#050709' }}>
          {/* Preview header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
              Preview · Cliquez une section pour l&apos;éditer
            </span>
            <div style={{ flex: 1 }} />
            {activeScene !== null && (
              <span style={{ fontSize: 10, color: SCENE_META[activeScene].color, fontWeight: 600 }}>
                ● {SCENE_META[activeScene].label} sélectionnée
              </span>
            )}
          </div>

          {/* Scrollable preview area */}
          <div style={{ flex: 1, overflow: 'auto', padding: device !== 'desktop' ? '16px' : 0 }}>
            <FullPreview
              scenes={scenes}
              global={global}
              cssVars={initialCssVars}
              activeScene={activeScene}
              onSceneClick={handleSceneClick}
              device={device}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
