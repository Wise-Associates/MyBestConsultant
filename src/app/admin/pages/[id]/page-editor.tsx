'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import Link from 'next/link'
import {
  Plus, Trash2, Settings2, Loader2, Check, AlertCircle,
  ArrowLeft, Layout, Type, ImageIcon, Zap, Grid3X3, BarChart2, Minus, GalleryHorizontal,
  Monitor, Tablet, Smartphone, Save, Globe, Lock, Palette, PenLine, Eye,
  Wand2, Code2, ChevronDown, Download, Building2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { savePage } from '../actions'
import type { PageSection, SectionType, HeroVariant } from '../types'
import { SECTION_DEFAULTS } from '../types'
import { HERO_TEMPLATES } from '@/components/hero-variants'
import { PAGE_TEMPLATES } from '@/components/page-builder/page-templates'
import { getGithubComponents, GITHUB_CATEGORIES, GITHUB_SOURCES } from '../github-data'
import { fetchGithubComponentHtml } from '../github-fetch'
import { SectionClientRenderer } from './section-preview'
import { ImageUpload } from '@/components/page-builder/image-upload'

// Parse "  --foo: bar; --baz: qux;" into a React style object for scoped preview vars
function parseCssVars(vars: string): React.CSSProperties {
  const style: Record<string, string> = {}
  for (const m of vars.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) {
    style[m[1].trim()] = m[2].trim()
  }
  return style as React.CSSProperties
}

const inp = "bg-white/[0.06] border-white/[0.1] text-white/80 placeholder:text-white/25 focus:border-white/30 focus:ring-0 rounded-lg text-sm h-9"
const ta  = "bg-white/[0.06] border-white/[0.1] text-white/80 placeholder:text-white/25 focus:border-white/30 focus:ring-0 rounded-lg text-sm resize-none"

function slugify(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const CATALOG: { type: SectionType; label: string; desc: string; icon: React.ElementType; color: string }[] = [
  { type: 'hero',          label: 'Hero',         desc: 'Bannière pleine largeur + CTA',   icon: Layout,            color: 'text-blue-400' },
  { type: 'text',          label: 'Texte',         desc: 'Titre + paragraphe',              icon: Type,              color: 'text-white/60' },
  { type: 'image_text',    label: 'Image + Texte', desc: 'Deux colonnes image / contenu',   icon: ImageIcon,         color: 'text-violet-400' },
  { type: 'cta',           label: 'CTA',           desc: "Bande appel à l'action",          icon: Zap,               color: 'text-amber-400' },
  { type: 'cards',         label: 'Cartes',        desc: 'Grille avec icônes',              icon: Grid3X3,           color: 'text-emerald-400' },
  { type: 'stats',         label: 'Stats',         desc: 'Chiffres clés mis en valeur',     icon: BarChart2,         color: 'text-pink-400' },
  { type: 'image_gallery', label: 'Galerie',       desc: "Grille d'images cliquables",      icon: GalleryHorizontal, color: 'text-cyan-400' },
  { type: 'divider',       label: 'Séparateur',    desc: 'Espace ou ligne entre sections',  icon: Minus,             color: 'text-white/30' },
  { type: 'custom_html',   label: 'HTML Custom',   desc: 'Coller du HTML externe / GitHub', icon: Code2,             color: 'text-orange-400' },
  { type: 'trusted_logos', label: 'Logos partenaires', desc: 'Bandeau "Ils nous ont fait confiance"', icon: Building2, color: 'text-sky-400' },
]

const BG_PALETTE = [
  { label: 'Défaut',     value: '',                        preview: 'rgba(255,255,255,0.08)' },
  { label: 'Background', value: 'var(--color-background)', preview: '#ffffff' },
  { label: 'Surface',    value: 'var(--color-surface)',    preview: '#f8f9fc' },
  { label: 'Primary',    value: 'var(--color-primary)',    preview: '#0B1D51' },
  { label: 'Secondary',  value: 'var(--color-secondary)',  preview: '#f1f4fb' },
  { label: 'Hero BG',    value: 'var(--hero-bg)',          preview: '#0B1D51' },
  { label: 'Sombre',     value: '#0A0C10',                 preview: '#0A0C10' },
]

const HEIGHT_OPTS = [
  { label: 'Auto', value: '' },
  { label: 'Compact (280px)', value: '280px' },
  { label: 'Moyen (420px)', value: '420px' },
  { label: 'Grand (560px)', value: '560px' },
  { label: 'Très grand (700px)', value: '700px' },
  { label: 'Plein écran (100vh)', value: '100vh' },
]

const FIT_OPTS = [
  { label: 'Cover (remplir)', value: 'cover' },
  { label: 'Contain (tout voir)', value: 'contain' },
]

const POS_GRID = [
  ['top left', 'top center', 'top right'],
  ['center left', 'center', 'center right'],
  ['bottom left', 'bottom center', 'bottom right'],
]

// ── Image focal point picker ──────────────────────────────────────────
function ImageFocalPicker({ imageUrl, value, onChange }: { imageUrl: string; value: string; onChange: (v: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  function getPos(): [number, number] {
    if (!value || value === 'center') return [50, 50]
    const m = value.match(/(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/)
    if (m) return [parseFloat(m[1]), parseFloat(m[2])]
    const map: Record<string, [number, number]> = {
      'top left': [0, 0], 'top center': [50, 0], 'top right': [100, 0],
      'center left': [0, 50], 'center': [50, 50], 'center right': [100, 50],
      'bottom left': [0, 100], 'bottom center': [50, 100], 'bottom right': [100, 100],
    }
    return map[value] ?? [50, 50]
  }
  const [px, py] = getPos()

  function calcFromEvent(e: React.MouseEvent<HTMLDivElement>) {
    const rect = containerRef.current!.getBoundingClientRect()
    const x = Math.min(100, Math.max(0, Math.round(((e.clientX - rect.left) / rect.width) * 100)))
    const y = Math.min(100, Math.max(0, Math.round(((e.clientY - rect.top) / rect.height) * 100)))
    onChange(`${x}% ${y}%`)
  }

  return (
    <div className="space-y-2">
      <Label className="text-[10px] text-white/35 uppercase tracking-widest">Point focal (glisser)</Label>
      {/* Image drag area */}
      <div ref={containerRef}
        className="relative rounded-lg overflow-hidden cursor-crosshair border border-white/[0.08]"
        style={{ height: 90 }}
        onMouseDown={e => { setDragging(true); calcFromEvent(e) }}
        onMouseMove={e => { if (dragging) calcFromEvent(e) }}
        onMouseUp={() => setDragging(false)}
        onMouseLeave={() => setDragging(false)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" className="w-full h-full" style={{ objectFit: 'cover', objectPosition: value || 'center', userSelect: 'none', pointerEvents: 'none' }} />
        {/* Crosshair dot */}
        <div className="absolute w-4 h-4 rounded-full border-2 border-white shadow-lg pointer-events-none"
          style={{ left: `${px}%`, top: `${py}%`, transform: 'translate(-50%, -50%)', background: 'rgba(99,102,241,0.7)' }} />
        {/* Crosshair lines */}
        <div className="absolute pointer-events-none" style={{ left: `${px}%`, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.25)', transform: 'translateX(-50%)' }} />
        <div className="absolute pointer-events-none" style={{ top: `${py}%`, left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.25)', transform: 'translateY(-50%)' }} />
      </div>
      {/* Quick presets 3x3 */}
      <div className="grid grid-cols-3 gap-0.5">
        {POS_GRID.map((row, ri) => row.map((pos, ci) => (
          <button key={pos} onClick={() => onChange(pos)}
            title={pos}
            className={`h-5 rounded text-[9px] transition-colors ${value === pos ? 'bg-indigo-500/40 border border-indigo-400/50' : 'bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06]'}`}>
            <div className="w-1.5 h-1.5 rounded-full bg-white/50 mx-auto" style={{ opacity: value === pos ? 1 : 0.3 }} />
          </button>
        )))}
      </div>
      <p className="text-[10px] text-white/25 font-mono">{value || 'center'}</p>
    </div>
  )
}

// ── Field helpers ─────────────────────────────────────────────────────
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] text-white/35 uppercase tracking-widest">{label}</Label>
      {children}
    </div>
  )
}

function Sel({ value, options, onChange }: { value: string; options: { label: string; value: string }[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full bg-white/[0.06] border border-white/[0.1] text-white/70 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-white/30">
      {options.map(o => <option key={o.value} value={o.value} className="bg-[#16182a]">{o.label}</option>)}
    </select>
  )
}

function BgColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <F label="Couleur de fond">
      <div className="flex flex-wrap gap-1.5 items-center">
        {BG_PALETTE.map(p => (
          <button key={p.value} title={p.label} onClick={() => onChange(p.value)}
            className={`h-7 w-7 rounded-md border-2 transition-all flex items-center justify-center ${value === p.value ? 'border-white/60 scale-110' : 'border-white/[0.1] hover:border-white/30'}`}
            style={{ background: p.preview }}>
            {!p.value && <span className="text-[9px] text-white/40 font-medium">↩</span>}
          </button>
        ))}
        <input type="color" value={value.startsWith('#') ? value : '#0B1D51'}
          onChange={e => onChange(e.target.value)}
          className="h-7 w-7 rounded-md border border-white/[0.1] bg-transparent cursor-pointer p-0.5 hover:border-white/30"
          title="Couleur personnalisée" />
      </div>
    </F>
  )
}

function HeightPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <F label="Hauteur de section">
      <Sel value={value} options={HEIGHT_OPTS} onChange={onChange} />
    </F>
  )
}

// ── HTML field extraction helpers ─────────────────────────────────────
// Use tagOccurrence (position of tag in HTML) not value-based — stable even when text is cleared

const BTN_COLORS: Record<string, { cls: string; preview: string }> = {
  indigo: { cls: 'bg-indigo-600 text-white hover:bg-indigo-700',       preview: '#4f46e5' },
  navy:   { cls: 'bg-blue-900 text-white hover:bg-blue-800',           preview: '#1e3a5f' },
  gray:   { cls: 'bg-gray-800 text-white hover:bg-gray-900',           preview: '#1f2937' },
  white:  { cls: 'bg-white text-gray-900 border border-gray-300 hover:bg-gray-50', preview: '#ffffff' },
  gold:   { cls: 'bg-amber-500 text-white hover:bg-amber-600',         preview: '#f59e0b' },
  red:    { cls: 'bg-red-600 text-white hover:bg-red-700',             preview: '#dc2626' },
}
const BTN_SIZES: Record<string, string> = {
  sm: 'px-4 py-1.5 text-xs', md: 'px-6 py-2.5 text-sm', lg: 'px-8 py-3.5 text-base',
}

type HtmlField =
  | { kind: 'text'; tag: string; value: string; tagOccurrence: number }
  | { kind: 'img';  src: string; alt: string; imgOccurrence: number }
  | { kind: 'btn';  href: string; label: string; tagOccurrence: number; color: string; size: string }

function extractHtmlFields(html: string): HtmlField[] {
  const fields: HtmlField[] = []
  const tagCounts = new Map<string, number>()

  // Text nodes — tracked by Nth occurrence of the TAG (not the value)
  const textRe = /<(h[1-6]|p|li|span|dt|dd|th|td)\b[^>]*>([^<]{1,})<\/\1>/gi
  let m: RegExpExecArray | null
  while ((m = textRe.exec(html)) !== null) {
    const tag = m[1].toLowerCase()
    const value = m[2].trim()
    if (!value) continue
    const occ = tagCounts.get(tag) ?? 0
    tagCounts.set(tag, occ + 1)
    fields.push({ kind: 'text', tag, value, tagOccurrence: occ })
  }

  // <img> — tracked by appearance order
  let imgOcc = 0
  const imgRe = /<img\b[^>]*>/gi
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0]
    const srcM = tag.match(/src=["']([^"']+)["']/i)
    const altM = tag.match(/alt=["']([^"']*)["']/i)
    if (!srcM) continue
    fields.push({ kind: 'img', src: srcM[1], alt: altM?.[1] ?? '', imgOccurrence: imgOcc++ })
  }

  // <a> buttons — ALL anchors (including href="#"), tracked by appearance order
  let aOcc = 0
  const aRe = /<a\b([^>]*)>([^<]+)<\/a>/gi
  while ((m = aRe.exec(html)) !== null) {
    const attrs = m[1], label = m[2].trim()
    if (!label) continue
    const hrefM = attrs.match(/href=["']([^"']*)["']/i)
    fields.push({ kind: 'btn', href: hrefM?.[1] ?? '#', label, tagOccurrence: aOcc++, color: 'indigo', size: 'md' })
  }

  return fields
}

// Replace the content of the Nth occurrence of a tag (stable when content is empty)
function updateTagContent(html: string, tag: string, tagOccurrence: number, newContent: string): string {
  let count = 0
  const re = new RegExp(`(<${tag}\\b[^>]*>)[^<]*(<\\/${tag}>)`, 'gi')
  return html.replace(re, (match, open, close) => count++ === tagOccurrence ? `${open}${newContent}${close}` : match)
}

function deleteTagByOccurrence(html: string, tag: string, tagOccurrence: number): string {
  let count = 0
  const re = new RegExp(`<${tag}\\b[^>]*>[^<]*<\\/${tag}>`, 'gi')
  return html.replace(re, match => count++ === tagOccurrence ? '' : match)
}

function deleteNthImg(html: string, n: number): string {
  let count = 0
  return html.replace(/<img\b[^>]*>/gi, match => count++ === n ? '' : match)
}

// Position-based img attribute update — robust against special URL characters
function updateNthImgAttr(html: string, n: number, attr: string, newVal: string): string {
  let count = 0
  return html.replace(/<img\b([^>]*)>/gi, (match, attrs) => {
    if (count++ !== n) return match
    const escaped = newVal.replace(/"/g, '&quot;')
    if (new RegExp(`${attr}=["'][^"']*["']`, 'i').test(attrs)) {
      return `<img${attrs.replace(new RegExp(`${attr}=["'][^"']*["']`, 'i'), `${attr}="${escaped}"`)}>`
    }
    return `<img ${attr}="${escaped}"${attrs}>`
  })
}

// Rebuild an <a> tag by its occurrence index (label, href, style)
function rebuildBtn(html: string, tagOccurrence: number, label: string, href: string, color: string, size: string): string {
  const cls = `inline-block ${BTN_SIZES[size] ?? BTN_SIZES.md} ${BTN_COLORS[color]?.cls ?? BTN_COLORS.indigo.cls} rounded-full font-semibold transition-colors`
  const newTag = `<a href="${href}" class="${cls}">${label}</a>`
  let count = 0
  const re = /<a\b[^>]*>[^<]*<\/a>/gi
  return html.replace(re, match => count++ === tagOccurrence ? newTag : match)
}

const TAG_LABEL: Record<string, string> = {
  h1: 'Titre H1', h2: 'Titre H2', h3: 'Titre H3', h4: 'Titre H4', h5: 'Titre H5', h6: 'Titre H6',
  p: 'Paragraphe', li: 'Item liste', span: 'Texte', dt: 'Terme', dd: 'Définition', th: 'En-tête', td: 'Cellule',
}

// ── Inject element helper ─────────────────────────────────────────────
function injectElement(html: string, snippet: string): string {
  if (html.includes('</body>')) return html.replace('</body>', snippet + '\n</body>')
  // wrap the body extraction
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  if (m) return html.replace(m[0], m[0].replace('</body>', snippet + '\n</body>'))
  return html + '\n' + snippet
}

// ── Section editor ─────────────────────────────────────────────────────
function SectionEditor({ section, onChange, onPickTemplate }: { section: PageSection; onChange: (s: PageSection) => void; onPickTemplate?: () => void }) {
  const [customHtmlTab, setCustomHtmlTab] = useState<'texts' | 'code'>('texts')

  // Stable fields — not re-extracted on every keystroke
  const [stableFields, setStableFields] = useState<HtmlField[]>(() =>
    section.type === 'custom_html' ? extractHtmlFields((section as { html: string }).html) : []
  )
  const prevTabRef = useRef(customHtmlTab)
  const prevTypeRef = useRef(section.type)

  // Re-extract when type changes to custom_html
  useEffect(() => {
    if (section.type === 'custom_html' && prevTypeRef.current !== 'custom_html') {
      setStableFields(extractHtmlFields((section as { html: string }).html))
    }
    prevTypeRef.current = section.type
  }, [section.type, section])

  // Re-extract when switching FROM code tab back to texts tab
  useEffect(() => {
    if (section.type === 'custom_html' && prevTabRef.current === 'code' && customHtmlTab === 'texts') {
      setStableFields(extractHtmlFields((section as { html: string }).html))
    }
    prevTabRef.current = customHtmlTab
  }, [customHtmlTab, section])

  function set(key: string, val: unknown) { onChange({ ...section, [key]: val } as PageSection) }
  function fi(label: string, key: string, val: string, ph = '') {
    return <F label={label}><Input value={val} onChange={e => set(key, e.target.value)} className={inp} placeholder={ph} /></F>
  }
  function ta2(label: string, key: string, val: string, ph = '') {
    return <F label={label}><Textarea value={val} onChange={e => set(key, e.target.value)} className={ta} rows={3} placeholder={ph} /></F>
  }
  function sel(label: string, key: string, val: string, opts: { label: string; value: string }[]) {
    return <F label={label}><Sel value={val} options={opts} onChange={v => set(key, v)} /></F>
  }

  const bgPicker = <BgColorPicker value={section.bgColor} onChange={v => set('bgColor', v)} />
  const heightPicker = <HeightPicker value={section.sectionHeight} onChange={v => set('sectionHeight', v)} />
  const alignOpts = [{ label: 'Centré', value: 'center' }, { label: 'Gauche', value: 'left' }]

  // Image controls for sections with images
  function ImageControls({ urlKey, altKey, fitKey, posKey, url, alt, fit, pos }: {
    urlKey: string; altKey: string; fitKey: string; posKey: string
    url: string; alt: string; fit: string; pos: string
  }) {
    return (
      <div className="space-y-3">
        <ImageUpload label="Image" value={url} onChange={v => set(urlKey, v)} />
        {url && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {fi('Texte alt', altKey, alt)}
              <F label="Remplissage"><Sel value={fit} options={FIT_OPTS} onChange={v => set(fitKey, v)} /></F>
            </div>
            <ImageFocalPicker imageUrl={url} value={pos} onChange={v => set(posKey, v)} />
          </>
        )}
      </div>
    )
  }

  if (section.type === 'hero') return (
    <div className="space-y-3">
      {/* Template picker trigger */}
      <F label="Style visuel">
        <button
          onClick={() => onPickTemplate?.()}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] transition-colors text-left group"
        >
          {/* Current variant thumbnail */}
          <div className="h-10 w-16 rounded-md shrink-0 overflow-hidden border border-white/[0.1]" style={{
            background: HERO_TEMPLATES.find(t => t.id === (section.variant ?? 'default'))?.thumbBg ?? '#0B1D51',
          }}>
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-8 h-0.5 rounded-full bg-white/40" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white/70 truncate">
              {HERO_TEMPLATES.find(t => t.id === (section.variant ?? 'default'))?.name ?? 'Classique'}
            </p>
            <p className="text-[10px] text-white/30 truncate">
              {HERO_TEMPLATES.find(t => t.id === (section.variant ?? 'default'))?.desc}
            </p>
          </div>
          <span className="text-[10px] text-white/25 group-hover:text-white/50 shrink-0">Changer →</span>
        </button>
      </F>
      {fi('Titre principal', 'title', section.title, 'Titre...')}
      {ta2('Sous-titre', 'subtitle', section.subtitle, 'Description...')}
      <ImageControls urlKey="imageUrl" altKey="imageAlt" fitKey="imageObjectFit" posKey="imageObjectPosition"
        url={section.imageUrl} alt={section.imageAlt} fit={section.imageObjectFit} pos={section.imageObjectPosition} />
      <div className="grid grid-cols-2 gap-2">
        {fi('CTA 1 — Label', 'ctaLabel', section.ctaLabel)}
        {fi('CTA 1 — Lien', 'ctaHref', section.ctaHref)}
        {fi('CTA 2 — Label', 'ctaSecondaryLabel', section.ctaSecondaryLabel)}
        {fi('CTA 2 — Lien', 'ctaSecondaryHref', section.ctaSecondaryHref)}
      </div>
      {sel('Alignement', 'align', section.align, alignOpts)}
      {bgPicker}
      {heightPicker}
    </div>
  )

  if (section.type === 'text') return (
    <div className="space-y-3">
      {fi('Titre', 'title', section.title)}
      {ta2('Contenu', 'content', section.content, 'Votre texte...')}
      <div className="grid grid-cols-2 gap-2">
        {sel('Alignement', 'align', section.align, alignOpts)}
        {sel('Largeur max', 'maxWidth', section.maxWidth, [
          { label: 'Étroite (560px)', value: 'narrow' },
          { label: 'Normale (720px)', value: 'normal' },
          { label: 'Pleine largeur', value: 'wide' },
        ])}
      </div>
      {bgPicker}
      {heightPicker}
    </div>
  )

  if (section.type === 'image_text') return (
    <div className="space-y-3">
      {fi('Titre', 'title', section.title)}
      {ta2('Contenu', 'content', section.content)}
      <ImageControls urlKey="imageUrl" altKey="imageAlt" fitKey="imageObjectFit" posKey="imageObjectPosition"
        url={section.imageUrl} alt={section.imageAlt} fit={section.imageObjectFit} pos={section.imageObjectPosition} />
      <div className="grid grid-cols-2 gap-2">
        {fi('CTA — Label', 'ctaLabel', section.ctaLabel)}
        {fi('CTA — Lien', 'ctaHref', section.ctaHref)}
        {sel('Position image', 'imagePosition', section.imagePosition, [
          { label: 'Droite', value: 'right' }, { label: 'Gauche', value: 'left' },
        ])}
      </div>
      {bgPicker}
      {heightPicker}
    </div>
  )

  if (section.type === 'cta') return (
    <div className="space-y-3">
      {fi('Titre', 'title', section.title)}
      {fi('Sous-titre', 'subtitle', section.subtitle)}
      <div className="grid grid-cols-2 gap-2">
        {fi('Bouton 1 — Label', 'buttonLabel', section.buttonLabel)}
        {fi('Bouton 1 — Lien', 'buttonHref', section.buttonHref)}
        {fi('Bouton 2 — Label', 'buttonSecondaryLabel', section.buttonSecondaryLabel)}
        {fi('Bouton 2 — Lien', 'buttonSecondaryHref', section.buttonSecondaryHref)}
      </div>
      {sel('Style', 'style', section.style, [
        { label: 'Couleur primaire', value: 'primary' },
        { label: 'Sombre', value: 'dark' },
        { label: 'Clair', value: 'light' },
      ])}
      {bgPicker}
      {heightPicker}
    </div>
  )

  if (section.type === 'cards') return (
    <div className="space-y-3">
      {fi('Titre de section', 'title', section.title)}
      {fi('Sous-titre', 'subtitle', section.subtitle)}
      {sel('Colonnes', 'columns', String(section.columns), [
        { label: '2 colonnes', value: '2' },
        { label: '3 colonnes', value: '3' },
        { label: '4 colonnes', value: '4' },
      ])}
      {bgPicker}
      {heightPicker}
      <div className="border-t border-white/[0.07] pt-3 space-y-2">
        <Label className="text-[10px] text-white/35 uppercase tracking-widest">Cartes</Label>
        {section.cards.map((card, i) => (
          <div key={i} className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.08] space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-white/40">Carte {i + 1}</span>
              <button onClick={() => set('cards', section.cards.filter((_, j) => j !== i))}
                className="text-white/20 hover:text-red-400 transition-colors"><Trash2 className="h-3 w-3" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input value={card.icon} onChange={e => set('cards', section.cards.map((c, j) => j === i ? { ...c, icon: e.target.value } : c))}
                className={inp} placeholder="🎯 Emoji" />
              <Input value={card.title} onChange={e => set('cards', section.cards.map((c, j) => j === i ? { ...c, title: e.target.value } : c))}
                className={inp} placeholder="Titre" />
              <div className="col-span-2">
                <Input value={card.body} onChange={e => set('cards', section.cards.map((c, j) => j === i ? { ...c, body: e.target.value } : c))}
                  className={inp} placeholder="Description..." />
              </div>
              <div className="col-span-2">
                <Input value={card.href} onChange={e => set('cards', section.cards.map((c, j) => j === i ? { ...c, href: e.target.value } : c))}
                  className={inp} placeholder="Lien (optionnel)" />
              </div>
            </div>
          </div>
        ))}
        <button onClick={() => set('cards', [...section.cards, { icon: '✨', title: 'Nouvelle carte', body: '', href: '#' }])}
          className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors py-1">
          <Plus className="h-3 w-3" /> Ajouter une carte
        </button>
      </div>
    </div>
  )

  if (section.type === 'stats') return (
    <div className="space-y-3">
      {fi('Titre', 'title', section.title)}
      {sel('Style', 'style', section.style, [
        { label: 'Fond sombre', value: 'dark' },
        { label: 'Fond clair', value: 'light' },
      ])}
      {bgPicker}
      {heightPicker}
      <div className="border-t border-white/[0.07] pt-3 space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] text-white/35 uppercase tracking-widest">Statistiques</Label>
          <button onClick={() => set('items', [...section.items, { value: '', label: '', description: '' }])}
            className="flex items-center gap-1 text-[10px] text-white/30 hover:text-white/60 transition-colors">
            <Plus className="h-3 w-3" /> Ajouter
          </button>
        </div>
        {section.items.map((item, i) => (
          <div key={i} className="flex gap-2 items-center">
            <div className="grid grid-cols-3 gap-2 flex-1">
              <Input value={item.value} onChange={e => set('items', section.items.map((it, j) => j === i ? { ...it, value: e.target.value } : it))}
                className={inp} placeholder="2 400+" />
              <Input value={item.label} onChange={e => set('items', section.items.map((it, j) => j === i ? { ...it, label: e.target.value } : it))}
                className={inp} placeholder="Label" />
              <Input value={item.description} onChange={e => set('items', section.items.map((it, j) => j === i ? { ...it, description: e.target.value } : it))}
                className={inp} placeholder="Détail" />
            </div>
            <button onClick={() => set('items', section.items.filter((_, j) => j !== i))}
              className="text-white/20 hover:text-red-400 transition-colors shrink-0"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
    </div>
  )

  if (section.type === 'image_gallery') return (
    <div className="space-y-3">
      {fi('Titre', 'title', section.title)}
      {fi('Sous-titre', 'subtitle', section.subtitle)}
      <div className="grid grid-cols-2 gap-2">
        {sel('Colonnes', 'columns', String(section.columns), [
          { label: '2 colonnes', value: '2' }, { label: '3 colonnes', value: '3' }, { label: '4 colonnes', value: '4' },
        ])}
        {sel('Disposition', 'layout', section.layout, [
          { label: 'Grille uniforme', value: 'grid' }, { label: 'Masonry', value: 'masonry' },
        ])}
      </div>
      {bgPicker}
      {heightPicker}
      <div className="border-t border-white/[0.07] pt-3 space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] text-white/35 uppercase tracking-widest">Images ({section.items.length})</Label>
          <button onClick={() => set('items', [...section.items, { url: '', alt: '', caption: '', href: '', objectPosition: 'center' }])}
            className="flex items-center gap-1 text-[10px] text-white/30 hover:text-white/60 transition-colors">
            <Plus className="h-3 w-3" /> Ajouter
          </button>
        </div>
        {section.items.map((item, i) => (
          <div key={i} className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.08] space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-white/40">Image {i + 1}</span>
              <button onClick={() => set('items', section.items.filter((_, j) => j !== i))}
                className="text-white/20 hover:text-red-400 transition-colors"><Trash2 className="h-3 w-3" /></button>
            </div>
            <ImageUpload label="Image" value={item.url}
              onChange={url => set('items', section.items.map((it, j) => j === i ? { ...it, url } : it))} />
            {item.url && (
              <ImageFocalPicker imageUrl={item.url} value={item.objectPosition || 'center'}
                onChange={objectPosition => set('items', section.items.map((it, j) => j === i ? { ...it, objectPosition } : it))} />
            )}
            <div className="grid grid-cols-2 gap-2">
              <Input value={item.alt} onChange={e => set('items', section.items.map((it, j) => j === i ? { ...it, alt: e.target.value } : it))}
                className={inp} placeholder="Texte alt" />
              <Input value={item.caption} onChange={e => set('items', section.items.map((it, j) => j === i ? { ...it, caption: e.target.value } : it))}
                className={inp} placeholder="Légende" />
              <div className="col-span-2">
                <Input value={item.href} onChange={e => set('items', section.items.map((it, j) => j === i ? { ...it, href: e.target.value } : it))}
                  className={inp} placeholder="Lien (optionnel)" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  if (section.type === 'divider') return (
    <div className="space-y-3">
      {sel('Style', 'style', section.style, [
        { label: 'Espace vide', value: 'space' }, { label: 'Ligne horizontale', value: 'line' },
      ])}
      {bgPicker}
      {heightPicker}
    </div>
  )

  if (section.type === 'trusted_logos') return (
    <div className="space-y-3">
      {fi('Titre', 'title', section.title, 'Ils nous ont fait confiance')}
      <div className="grid grid-cols-2 gap-2">
        {sel('Taille du titre', 'titleSize', section.titleSize || 'sm', [
          { label: 'Petit (discret)', value: 'sm' }, { label: 'Moyen', value: 'md' }, { label: 'Grand (titre)', value: 'lg' },
        ])}
        <F label="Style">
          <Sel value={section.titleBold ? 'true' : 'false'} onChange={v => set('titleBold', v === 'true')}
            options={[{ label: 'Normal', value: 'false' }, { label: 'Gras', value: 'true' }]} />
        </F>
      </div>
      <p className="text-[10px] text-white/25">
        Les logos eux-mêmes se gèrent dans Admin → Page d&apos;accueil → Logos partenaires — ce bloc affiche simplement cette même liste ici.
      </p>
      {bgPicker}
    </div>
  )

  if (section.type === 'custom_html') {
    const cs = section  // narrowed to CustomHtmlSection — TypeScript loses narrowing in closures
    const fields = stableFields
    const total = fields.length

    // ── field-level update functions (use tagOccurrence — stable even on empty value) ──
    function updateText(idx: number, f: Extract<HtmlField, { kind: 'text' }>, newVal: string) {
      set('html', updateTagContent(cs.html, f.tag, f.tagOccurrence, newVal))
      setStableFields(prev => prev.map((x, i) => i === idx ? { ...x, value: newVal } as HtmlField : x))
    }
    function deleteText(idx: number, f: Extract<HtmlField, { kind: 'text' }>) {
      set('html', deleteTagByOccurrence(cs.html, f.tag, f.tagOccurrence))
      setStableFields(prev => prev.filter((_, i) => i !== idx))
    }
    function updateImgSrc(idx: number, f: Extract<HtmlField, { kind: 'img' }>, newSrc: string) {
      set('html', updateNthImgAttr(cs.html, f.imgOccurrence, 'src', newSrc))
      setStableFields(prev => prev.map((x, i) => i === idx ? { ...x, src: newSrc } as HtmlField : x))
    }
    function updateImgAlt(idx: number, f: Extract<HtmlField, { kind: 'img' }>, newAlt: string) {
      set('html', updateNthImgAttr(cs.html, f.imgOccurrence, 'alt', newAlt))
      setStableFields(prev => prev.map((x, i) => i === idx ? { ...x, alt: newAlt } as HtmlField : x))
    }
    function deleteImg(idx: number, f: Extract<HtmlField, { kind: 'img' }>) {
      set('html', deleteNthImg(cs.html, f.imgOccurrence))
      setStableFields(prev => prev.filter((_, i) => i !== idx))
    }
    function updateBtn(idx: number, f: Extract<HtmlField, { kind: 'btn' }>, patch: Partial<typeof f>) {
      const next = { ...f, ...patch }
      set('html', rebuildBtn(cs.html, f.tagOccurrence, next.label, next.href, next.color, next.size))
      setStableFields(prev => prev.map((x, i) => i === idx ? next as HtmlField : x))
    }
    function deleteBtn(idx: number, f: Extract<HtmlField, { kind: 'btn' }>) {
      set('html', deleteTagByOccurrence(cs.html, 'a', f.tagOccurrence))
      setStableFields(prev => prev.filter((_, i) => i !== idx))
    }

    const tabCls = (active: boolean) =>
      `flex-1 py-1.5 text-xs font-semibold transition-colors ${active ? 'bg-white/[0.1] text-white' : 'text-white/35 hover:text-white/60'}`

    return (
      <div className="space-y-3">
        {fi('Libellé', 'label', section.label, 'ex: Team HyperUI')}

        {/* Tab switcher */}
        <div className="flex rounded-lg overflow-hidden border border-white/[0.1]">
          <button onClick={() => setCustomHtmlTab('texts')} className={tabCls(customHtmlTab === 'texts')}>
            ✏️ Contenu ({total})
          </button>
          <button onClick={() => setCustomHtmlTab('code')} className={tabCls(customHtmlTab === 'code')}>
            {'</>'} Code
          </button>
        </div>

        {customHtmlTab === 'texts' && (
          <div className="space-y-4">
            {total === 0 && (
              <div className="py-6 text-center space-y-1">
                <p className="text-xs text-white/30">Aucun champ détecté.</p>
                <p className="text-[10px] text-white/20">Basculez sur &ldquo;Code&rdquo; pour modifier le HTML.</p>
              </div>
            )}

            {/* ── Champs en ordre document (pas groupés par type) ── */}
            <div className="space-y-2">
              {fields.map((f, idx) => {
                if (f.kind === 'text') {
                  const preview = f.value.length > 22 ? f.value.slice(0, 22) + '…' : f.value
                  const isLong = f.value.length > 60
                  return (
                    <div key={idx} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] text-white/35 uppercase tracking-widest">
                          {TAG_LABEL[f.tag] ?? f.tag.toUpperCase()} — &ldquo;{preview}&rdquo;
                        </Label>
                        <button onClick={() => deleteText(idx, f)} title="Supprimer"
                          className="p-0.5 rounded text-white/20 hover:text-red-400 transition-colors"><Trash2 className="h-3 w-3" /></button>
                      </div>
                      {isLong
                        ? <Textarea value={f.value} rows={2} className={ta}
                            onChange={e => updateText(idx, f, e.target.value)} />
                        : <Input value={f.value} className={inp}
                            onChange={e => updateText(idx, f, e.target.value)} />}
                    </div>
                  )
                }
                if (f.kind === 'img') {
                  return (
                    <div key={idx} className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.07] space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] text-white/40 font-medium">Image</p>
                        <button onClick={() => deleteImg(idx, f)} title="Supprimer"
                          className="p-0.5 rounded text-white/20 hover:text-red-400 transition-colors"><Trash2 className="h-3 w-3" /></button>
                      </div>
                      <ImageUpload label="Source" value={f.src} onChange={newSrc => updateImgSrc(idx, f, newSrc)} />
                      <F label="Texte alt">
                        <Input value={f.alt} className={inp} placeholder="Description…"
                          onChange={e => updateImgAlt(idx, f, e.target.value)} />
                      </F>
                    </div>
                  )
                }
                if (f.kind === 'btn') {
                  return (
                    <div key={idx} className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.07] space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] text-white/40 font-medium">Bouton — &ldquo;{f.label.slice(0, 18)}&rdquo;</p>
                        <button onClick={() => deleteBtn(idx, f)} title="Supprimer"
                          className="p-0.5 rounded text-white/20 hover:text-red-400 transition-colors"><Trash2 className="h-3 w-3" /></button>
                      </div>
                      <F label="Label">
                        <Input value={f.label} className={inp} placeholder="Cliquez ici"
                          onChange={e => updateBtn(idx, f, { label: e.target.value })} />
                      </F>
                      <F label="Lien">
                        <Input value={f.href} className={inp} placeholder="https://..."
                          onChange={e => updateBtn(idx, f, { href: e.target.value })} />
                      </F>
                      <F label="Couleur">
                        <div className="flex gap-1.5 flex-wrap">
                          {Object.entries(BTN_COLORS).map(([key, { preview: p }]) => (
                            <button key={key} title={key}
                              onClick={() => updateBtn(idx, f, { color: key })}
                              className={`w-5 h-5 rounded-full border-2 transition-all ${f.color === key ? 'border-white scale-110' : 'border-transparent opacity-60 hover:opacity-100'}`}
                              style={{ background: p }} />
                          ))}
                        </div>
                      </F>
                      <F label="Taille">
                        <div className="flex gap-1">
                          {(['sm', 'md', 'lg'] as const).map(s => (
                            <button key={s}
                              onClick={() => updateBtn(idx, f, { size: s })}
                              className={`px-3 py-1 rounded text-[10px] font-semibold transition-all ${f.size === s ? 'bg-white/[0.15] text-white' : 'bg-white/[0.04] text-white/40 hover:text-white/70'}`}>
                              {s.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </F>
                    </div>
                  )
                }
                return null
              })}
            </div>

            {/* ── Ajouter un élément ── */}
            <div className="border-t border-white/[0.07] pt-3 space-y-2">
              <p className="text-[10px] text-white/30 uppercase tracking-widest font-semibold">Ajouter</p>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  ['Titre H2', '<h2 class="text-2xl font-bold text-gray-900 mt-6">Nouveau titre</h2>',
                    { kind: 'text', tag: 'h2', value: 'Nouveau titre', tagOccurrence: 0 } as HtmlField],
                  ['Titre H3', '<h3 class="text-xl font-semibold text-gray-800 mt-4">Sous-titre</h3>',
                    { kind: 'text', tag: 'h3', value: 'Sous-titre', tagOccurrence: 0 } as HtmlField],
                  ['Paragraphe', '<p class="text-gray-600 mt-3 leading-relaxed">Nouveau texte.</p>',
                    { kind: 'text', tag: 'p', value: 'Nouveau texte.', tagOccurrence: 0 } as HtmlField],
                  ['Bouton', '<a href="#" class="inline-block mt-4 px-6 py-2.5 bg-indigo-600 text-white rounded-full text-sm font-semibold hover:bg-indigo-700 transition-colors">Cliquez ici</a>',
                    { kind: 'btn', href: '#', label: 'Cliquez ici', tagOccurrence: 0, color: 'indigo', size: 'md' } as HtmlField],
                  ['Image', '<img src="https://placehold.co/800x400/e2e8f0/64748b?text=Image" alt="Image" class="w-full rounded-xl mt-4">',
                    { kind: 'img', src: 'https://placehold.co/800x400/e2e8f0/64748b?text=Image', alt: 'Image', imgOccurrence: 0 } as HtmlField],
                  ['Séparateur', '<hr class="my-8 border-gray-200">', null],
                ] as [string, string, HtmlField | null][]).map(([label, snippet, field]) => (
                  <button key={label}
                    onClick={() => {
                      const newHtml = injectElement(cs.html, snippet)
                      set('html', newHtml)
                      if (field) setStableFields(prev => {
                        // assign correct tagOccurrence/imgOccurrence based on current count
                        if (field.kind === 'text') {
                          const count = prev.filter(x => x.kind === 'text' && x.tag === field.tag).length
                          return [...prev, { ...field, tagOccurrence: count }]
                        }
                        if (field.kind === 'img') {
                          const count = prev.filter(x => x.kind === 'img').length
                          return [...prev, { ...field, imgOccurrence: count }]
                        }
                        if (field.kind === 'btn') {
                          const count = prev.filter(x => x.kind === 'btn').length
                          return [...prev, { ...field, tagOccurrence: count }]
                        }
                        return [...prev, field]
                      })
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.07] hover:border-white/20 text-xs text-white/50 hover:text-white/80 transition-all">
                    <Plus className="h-3 w-3 shrink-0" />{label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {customHtmlTab === 'code' && (
          <F label="Code HTML">
            <Textarea
              value={cs.html}
              onChange={e => set('html', e.target.value)}
              className={ta + ' font-mono text-[11px]'}
              rows={16}
              placeholder="<!-- Collez votre HTML ici -->"
            />
          </F>
        )}

        {bgPicker}
        {heightPicker}
      </div>
    )
  }

  return null
}

// ── Inline editable text element ────────────────────────────────────────
// key={value} forces remount when edited from editor panel, preventing stale DOM
function InlineText({ value, onChange, as: Tag = 'span', style, className }: {
  value: string; onChange: (v: string) => void; as?: string; style?: React.CSSProperties; className?: string
}) {
  return (
    <span
      key={value}
      contentEditable
      suppressContentEditableWarning
      onBlur={e => onChange(e.currentTarget.textContent || '')}
      style={{ ...style, outline: 'none', cursor: 'text', minWidth: 20, display: Tag === 'span' ? 'inline' : 'block' }}
      className={className}
      dangerouslySetInnerHTML={{ __html: value }}
      role="textbox"
      aria-multiline={Tag !== 'span'}
    />
  )
}

// ── Inline editable section preview ────────────────────────────────────
function SectionInlineRenderer({ section, onChange }: { section: PageSection; onChange: (s: PageSection) => void }) {
  function set(key: string, val: string) { onChange({ ...section, [key]: val } as PageSection) }

  const sectionStyle: React.CSSProperties = {
    minHeight: section.sectionHeight || undefined,
    position: 'relative',
  }
  const editHint: React.CSSProperties = { outline: '1px dashed rgba(99,102,241,0.35)', outlineOffset: 2 }

  if (section.type === 'hero') {
    const hasBg = !!section.imageUrl
    return (
      <section style={{ background: section.bgColor || (hasBg ? undefined : 'var(--hero-bg)'), ...sectionStyle, display: 'flex', alignItems: 'center', overflow: 'hidden', minHeight: section.sectionHeight || 320 }}>
        {hasBg && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={section.imageUrl} alt={section.imageAlt} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: section.imageObjectFit || 'cover', objectPosition: section.imageObjectPosition || 'center' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} />
          </>
        )}
        <div style={{ position: 'relative', width: '100%', padding: '4rem 2rem', textAlign: section.align }}>
          <InlineText as="h1" value={section.title} onChange={v => set('title', v)} style={{ ...editHint, display: 'block', fontFamily: 'var(--font-heading)', fontSize: 'clamp(1.8rem,4vw,3rem)', fontWeight: 'var(--font-weight-heading)', color: 'var(--hero-text)', marginBottom: '1rem', lineHeight: 1.15 }} />
          <InlineText as="p" value={section.subtitle} onChange={v => set('subtitle', v)} style={{ ...editHint, display: 'block', color: 'var(--hero-text)', opacity: 0.8, fontSize: '1.1rem', maxWidth: 560, margin: section.align === 'center' ? '0 auto 1.5rem' : '0 0 1.5rem', lineHeight: 'var(--line-height)', fontFamily: 'var(--font-body)' }} />
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: section.align === 'center' ? 'center' : 'flex-start', flexWrap: 'wrap' }}>
            {section.ctaLabel && <span style={{ display: 'inline-flex', padding: '0.75rem 1.5rem', borderRadius: 'var(--border-radius)', background: 'var(--color-primary)', color: 'var(--color-primary-fg)', fontWeight: 600, fontSize: '0.875rem' }}>{section.ctaLabel}</span>}
            {section.ctaSecondaryLabel && <span style={{ display: 'inline-flex', padding: '0.75rem 1.5rem', borderRadius: 'var(--border-radius)', border: '1px solid rgba(255,255,255,0.4)', color: 'var(--hero-text)', fontSize: '0.875rem' }}>{section.ctaSecondaryLabel}</span>}
          </div>
        </div>
      </section>
    )
  }

  if (section.type === 'text') {
    const maxW = { narrow: 560, normal: 720, wide: '100%' }
    return (
      <section style={{ padding: '3rem 2rem', background: section.bgColor || 'var(--color-background)', ...sectionStyle, display: 'flex', alignItems: 'center' }}>
        <div style={{ maxWidth: maxW[section.maxWidth], margin: '0 auto', textAlign: section.align, width: '100%' }}>
          <InlineText as="h2" value={section.title} onChange={v => set('title', v)} style={{ ...editHint, display: 'block', fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-heading)', color: 'var(--color-text)', marginBottom: '1rem', fontSize: '1.75rem' }} />
          <InlineText as="p" value={section.content} onChange={v => set('content', v)} style={{ ...editHint, display: 'block', color: 'var(--color-text-muted)', lineHeight: 'var(--line-height)', fontFamily: 'var(--font-body)', whiteSpace: 'pre-wrap' }} />
        </div>
      </section>
    )
  }

  // For other section types in inline mode, fall through to normal renderer
  return <SectionClientRenderer section={section} />
}

// ── Main component ────────────────────────────────────────────────────
type Device = 'desktop' | 'tablet' | 'mobile'

interface Meta { title: string; slug: string; metaDescription: string; metaKeywords: string; isPublished: boolean }
interface Props { pageId: string; initialSections: PageSection[]; initialMeta: Meta; initialCssVars?: string }

export function PageEditor({ pageId, initialSections, initialMeta, initialCssVars = '' }: Props) {
  const [sections, setSections] = useState<PageSection[]>(initialSections)
  const [meta, setMeta] = useState<Meta>(initialMeta)
  const [slugEdited, setSlugEdited] = useState(true)
  const [selected, setSelected] = useState<number | null>(null)
  const [showCatalog, setShowCatalog] = useState(false)
  const [device, setDevice] = useState<Device>('desktop')
  const [showMeta, setShowMeta] = useState(false)
  const [inlineEdit, setInlineEdit] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [saveStatus, setSaveStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [dragOver, setDragOver] = useState<number | null>(null)
  const dragIndex = useRef<number | null>(null)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  // Page template picker (full page)
  const [showPageTemplates, setShowPageTemplates] = useState(false)
  const [pageTemplateTab, setPageTemplateTab] = useState<'internal' | 'github'>('internal')
  // GitHub library state
  const [ghCategory, setGhCategory] = useState('Tous')
  const [ghSource, setGhSource] = useState('Toutes sources')
  const [ghFetching, setGhFetching] = useState<string | null>(null)
  const [ghError, setGhError] = useState<string | null>(null)

  // Inject site CSS vars into the page editor DOM so the preview renders correctly
  useEffect(() => {
    if (!initialCssVars) return
    let style = document.getElementById('mbc-page-editor-vars') as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = 'mbc-page-editor-vars'
      document.head.appendChild(style)
    }
    style.textContent = `:root { ${initialCssVars} }`
    return () => { style?.remove() }
  }, [initialCssVars])

  const LABEL: Record<SectionType, string> = {
    hero: 'Hero', text: 'Texte', image_text: 'Image + Texte',
    cta: 'CTA', cards: 'Cartes', stats: 'Stats', image_gallery: 'Galerie', divider: 'Séparateur',
    custom_html: 'HTML Custom', trusted_logos: 'Logos partenaires',
  }
  const ICON: Record<SectionType, React.ElementType> = {
    hero: Layout, text: Type, image_text: ImageIcon, cta: Zap,
    cards: Grid3X3, stats: BarChart2, image_gallery: GalleryHorizontal, divider: Minus,
    custom_html: Code2, trusted_logos: Building2,
  }
  const DEVICE_WIDTHS: Record<Device, string> = { desktop: '100%', tablet: '768px', mobile: '390px' }

  function handleTitleChange(v: string) {
    setMeta(m => ({ ...m, title: v, slug: slugEdited ? m.slug : slugify(v) }))
  }

  function add(type: SectionType) {
    const s = { ...SECTION_DEFAULTS[type] } as PageSection
    setSections(p => [...p, s])
    setSelected(sections.length)
    setShowCatalog(false)
  }

  function update(i: number, s: PageSection) { setSections(p => p.map((x, j) => j === i ? s : x)) }
  function move(i: number, dir: -1 | 1) {
    setSections(p => { const a = [...p]; [a[i], a[i + dir]] = [a[i + dir], a[i]]; return a })
    setSelected(i + dir)
  }
  function remove(i: number) { setSections(p => p.filter((_, j) => j !== i)); setSelected(null) }

  function save() {
    setSaveStatus('idle')
    startTransition(async () => {
      const r = await savePage(pageId, sections, meta)
      if ('error' in r) { setSaveStatus('error'); setErrorMsg(r.error) }
      else { setSaveStatus('ok'); setTimeout(() => setSaveStatus('idle'), 4000) }
    })
  }

  const selectedSection = selected !== null ? sections[selected] : null

  return (
    <div className="flex flex-col h-screen bg-[#0A0C10] text-white overflow-hidden">

      {/* TOP BAR */}
      <header className="shrink-0 h-12 border-b border-white/[0.07] flex items-center px-4 gap-3">
        <Link href="/admin/pages" className="p-1.5 rounded-lg hover:bg-white/[0.06] text-white/40 hover:text-white/80 transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="w-px h-4 bg-white/[0.1]" />
        {/* Templates button */}
        <button
          onClick={() => setShowPageTemplates(true)}
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-white/60 hover:text-white/90 transition-colors"
        >
          <Wand2 className="h-3.5 w-3.5" />
          Templates
        </button>
        <div className="w-px h-4 bg-white/[0.1]" />
        <input
          value={meta.title}
          onChange={e => handleTitleChange(e.target.value)}
          className="bg-transparent text-sm font-medium text-white/80 focus:outline-none focus:text-white border-b border-transparent focus:border-white/20 min-w-0 flex-1 max-w-[200px] pb-0.5"
          placeholder="Titre de la page..."
        />
        <span className="text-white/20 text-xs font-mono hidden sm:inline truncate max-w-[120px]">/{meta.slug}</span>
        <div className="flex-1" />

        {/* Device toggle */}
        <div className="hidden md:flex items-center gap-0.5 p-1 rounded-lg bg-white/[0.04] border border-white/[0.07]">
          {([['desktop', Monitor], ['tablet', Tablet], ['mobile', Smartphone]] as [Device, React.ElementType][]).map(([d, Icon]) => (
            <button key={d} onClick={() => setDevice(d)}
              className={`p-1.5 rounded-md transition-colors ${device === d ? 'bg-white/[0.12] text-white' : 'text-white/30 hover:text-white/60'}`}>
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>

        {/* Inline edit toggle */}
        <button onClick={() => setInlineEdit(!inlineEdit)}
          title="Éditer directement dans le preview"
          className={`p-1.5 rounded-lg border transition-colors ${inlineEdit ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400' : 'border-white/[0.07] text-white/30 hover:text-white/60'}`}>
          <PenLine className="h-4 w-4" />
        </button>

        {/* Published toggle */}
        <button onClick={() => setMeta(m => ({ ...m, isPublished: !m.isPublished }))}
          className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
            meta.isPublished ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-white/[0.04] text-white/40 border-white/[0.1] hover:border-white/20'
          }`}>
          {meta.isPublished ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
          {meta.isPublished ? 'Publié' : 'Brouillon'}
        </button>

        <button onClick={() => setShowMeta(!showMeta)}
          className={`p-1.5 rounded-lg border transition-colors ${showMeta ? 'bg-white/[0.08] border-white/20 text-white/70' : 'border-white/[0.07] text-white/30 hover:text-white/60'}`}>
          <Settings2 className="h-4 w-4" />
        </button>

        <Button onClick={save} disabled={isPending} size="sm"
          className={`gap-1.5 font-semibold text-sm px-4 h-8 ${
            saveStatus === 'ok' ? 'bg-emerald-500 hover:bg-emerald-400 text-white' :
            saveStatus === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
            'bg-white text-black hover:bg-white/90'
          }`}>
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
           saveStatus === 'ok' ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
          {isPending ? 'Sauvegarde...' : saveStatus === 'ok' ? 'Sauvegardé !' : 'Sauvegarder'}
        </Button>
      </header>

      {/* META DROPDOWN */}
      {showMeta && (
        <div className="shrink-0 border-b border-white/[0.07] bg-[#0f1018] px-6 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl">
            <F label="Slug (URL)">
              <div className="flex items-center">
                <span className="px-2 h-9 flex items-center bg-white/[0.03] border border-r-0 border-white/[0.1] rounded-l-lg text-white/25 text-xs">/</span>
                <Input value={meta.slug}
                  onChange={e => { setSlugEdited(true); setMeta(m => ({ ...m, slug: e.target.value })) }}
                  className={inp + ' rounded-l-none'} placeholder="mon-slug" />
              </div>
            </F>
            <div className="sm:col-span-2">
              <F label="Meta description SEO">
                <Input value={meta.metaDescription} onChange={e => setMeta(m => ({ ...m, metaDescription: e.target.value }))}
                  className={inp} placeholder="Description pour les moteurs de recherche..." />
              </F>
            </div>
            <div className="sm:col-span-3">
              <F label="Mots-clés SEO (séparés par des virgules)">
                <Input value={meta.metaKeywords} onChange={e => setMeta(m => ({ ...m, metaKeywords: e.target.value }))}
                  className={inp} placeholder="ex : conseil en recrutement, portage salarial, freelance IT" />
              </F>
            </div>
          </div>
        </div>
      )}

      {saveStatus === 'error' && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />{errorMsg}
        </div>
      )}

      {/* 3-PANEL */}
      <div className="flex-1 flex overflow-hidden">

        {/* Panel 1 — list */}
        <aside className="w-60 shrink-0 border-r border-white/[0.07] flex flex-col overflow-hidden">
          <div className="px-3 py-2.5 border-b border-white/[0.07] flex items-center justify-between shrink-0">
            <span className="text-xs font-semibold text-white/40 uppercase tracking-widest">Sections</span>
            <button onClick={() => setShowCatalog(!showCatalog)}
              className={`p-1.5 rounded-lg transition-colors ${showCatalog ? 'bg-white text-black' : 'bg-white/[0.06] text-white/60 hover:bg-white/[0.1]'}`}>
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {showCatalog && (
            <div className="border-b border-white/[0.07] p-2 space-y-0.5 bg-[#0f1018] max-h-72 overflow-y-auto">
              {CATALOG.map(item => (
                <button key={item.type} onClick={() => add(item.type)}
                  className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white/[0.06] transition-colors text-left">
                  <item.icon className={`h-4 w-4 mt-0.5 shrink-0 ${item.color}`} />
                  <div>
                    <p className="text-xs font-medium text-white/70">{item.label}</p>
                    <p className="text-[10px] text-white/30 leading-tight">{item.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
            {sections.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <Layout className="h-8 w-8 text-white/[0.08] mb-2" />
                <p className="text-xs text-white/25">Cliquez + pour ajouter</p>
              </div>
            )}
            {sections.map((s, i) => {
              const Icon = ICON[s.type]
              const isSelected = selected === i
              const isDragTarget = dragOver === i
              return (
                <div key={i}
                  draggable
                  onDragStart={e => { dragIndex.current = i; e.dataTransfer.effectAllowed = 'move' }}
                  onDragOver={e => { e.preventDefault(); setDragOver(i) }}
                  onDragEnd={() => { setDragOver(null); dragIndex.current = null }}
                  onDrop={e => {
                    e.preventDefault()
                    const from = dragIndex.current
                    if (from === null || from === i) { setDragOver(null); return }
                    setSections(p => {
                      const a = [...p]
                      const [item] = a.splice(from, 1)
                      a.splice(i, 0, item)
                      return a
                    })
                    setSelected(i)
                    setDragOver(null)
                  }}
                  className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all ${
                    isDragTarget ? 'border border-indigo-500/50 bg-indigo-500/10' :
                    isSelected ? 'bg-white/[0.1] border border-white/[0.15]' :
                    'hover:bg-white/[0.04] border border-transparent'
                  }`}
                  onClick={() => setSelected(isSelected ? null : i)}>
                  {/* Drag handle */}
                  <div className="cursor-grab active:cursor-grabbing text-white/20 hover:text-white/50 shrink-0" title="Glisser pour déplacer">
                    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
                      <circle cx="2" cy="2" r="1.2"/><circle cx="8" cy="2" r="1.2"/>
                      <circle cx="2" cy="7" r="1.2"/><circle cx="8" cy="7" r="1.2"/>
                      <circle cx="2" cy="12" r="1.2"/><circle cx="8" cy="12" r="1.2"/>
                    </svg>
                  </div>
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-white/80' : 'text-white/30'}`} />
                  <span className={`text-xs flex-1 truncate font-medium ${isSelected ? 'text-white/80' : 'text-white/50'}`}>
                    {LABEL[s.type]}
                    {'title' in s && (s as { title?: string }).title
                      ? <span className="ml-1 font-normal text-white/25">— {((s as { title?: string }).title ?? '').slice(0, 14)}</span>
                      : null}
                  </span>
                  {'bgColor' in s && (s as { bgColor?: string }).bgColor && <Palette className="h-2.5 w-2.5 text-white/20 shrink-0" />}
                  <div className="hidden group-hover:flex items-center gap-0.5">
                    <button onClick={e => { e.stopPropagation(); remove(i) }}
                      className="p-0.5 rounded text-white/20 hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
                  </div>
                </div>
              )
            })}
          </div>
        </aside>

        {/* Panel 2 — editor */}
        <aside className="w-[340px] shrink-0 border-r border-white/[0.07] flex flex-col overflow-hidden">
          {selectedSection ? (
            <>
              <div className="px-4 py-3 border-b border-white/[0.07] flex items-center gap-2 shrink-0">
                {(() => { const Icon = ICON[selectedSection.type]; return <Icon className="h-4 w-4 text-white/40" /> })()}
                <span className="text-sm font-semibold text-white/70">{LABEL[selectedSection.type]}</span>
                <span className="ml-auto text-[10px] text-white/25">Section {(selected ?? 0) + 1}/{sections.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <SectionEditor
                  section={selectedSection}
                  onChange={s => update(selected!, s)}
                  onPickTemplate={selectedSection.type === 'hero' ? () => setShowTemplatePicker(true) : undefined}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
              <Settings2 className="h-10 w-10 text-white/[0.07] mb-3" />
              <p className="text-xs text-white/25 font-medium">Sélectionnez une section</p>
              <p className="text-[11px] text-white/15 mt-1">pour éditer son contenu</p>
            </div>
          )}
        </aside>

        {/* Panel 3 — preview */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#080a0f]">
          <div className="shrink-0 px-4 py-2 border-b border-white/[0.07] flex items-center gap-3">
            <Eye className="h-3.5 w-3.5 text-white/30" />
            <span className="text-xs text-white/40 font-medium">Aperçu en temps réel</span>
            {inlineEdit && (
              <span className="text-[10px] text-indigo-400 font-medium flex items-center gap-1">
                <PenLine className="h-3 w-3" /> Cliquez sur les textes pour modifier
              </span>
            )}
            <div className="flex-1" />
            {meta.isPublished && (
              <a href={`/${meta.slug}`} target="_blank"
                className="inline-flex items-center gap-1.5 text-[10px] text-white/30 hover:text-white/60 transition-colors">
                <Globe className="h-3 w-3" /> Voir publiée
              </a>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div style={{
              ...parseCssVars(initialCssVars),
              width: DEVICE_WIDTHS[device], maxWidth: DEVICE_WIDTHS[device],
              transition: 'width 0.3s ease',
              margin: '0 auto',
              background: 'var(--color-background)',
              boxShadow: device !== 'desktop' ? '0 0 0 1px rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.4)' : 'none',
              borderRadius: device !== 'desktop' ? '12px' : 0,
              overflow: 'hidden',
            }}>
              {sections.length === 0 ? (
                <div style={{
                  minHeight: 400, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  padding: '2rem', textAlign: 'center', opacity: 0.3,
                  color: 'var(--color-text-muted)', fontFamily: 'var(--font-body)',
                }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📄</div>
                  <p style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Page vide</p>
                  <p style={{ fontSize: '0.875rem' }}>Ajoutez des sections depuis le panneau gauche</p>
                </div>
              ) : (
                sections.map((s, i) => (
                  <div key={i}
                    onClick={() => { if (!inlineEdit) setSelected(i) }}
                    style={{
                      outline: selected === i ? '2px solid rgba(99,102,241,0.6)' : '2px solid transparent',
                      outlineOffset: '-2px', cursor: inlineEdit && selected === i ? 'default' : 'pointer',
                      transition: 'outline 0.15s', position: 'relative',
                    }}>
                    {selected === i && (
                      <div style={{
                        position: 'absolute', top: 0, left: 0, zIndex: 10,
                        background: 'rgba(99,102,241,0.9)', color: 'white',
                        fontSize: '10px', fontWeight: 600, padding: '2px 8px',
                        borderBottomRightRadius: '6px', letterSpacing: '0.05em',
                        textTransform: 'uppercase', pointerEvents: 'none', fontFamily: 'sans-serif',
                      }}>{LABEL[s.type]}</div>
                    )}
                    {inlineEdit && selected === i ? (
                      <SectionInlineRenderer section={s} onChange={ns => update(i, ns)} />
                    ) : (
                      <SectionClientRenderer section={s} />
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

      </div>

      {/* ── PAGE TEMPLATES + GITHUB MODAL ──────────────────────── */}
      {showPageTemplates && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)' }}
          onClick={() => setShowPageTemplates(false)}>
          <div className="relative bg-[#0c0e16] border border-white/[0.1] rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="px-6 py-4 border-b border-white/[0.07] flex items-center gap-4 shrink-0">
              <Wand2 className="h-5 w-5 text-indigo-400" />
              <div className="flex-1">
                <h2 className="text-base font-semibold text-white">Bibliothèque de templates</h2>
                <p className="text-xs text-white/40 mt-0.5">Appliquer un template remplace toutes les sections existantes</p>
              </div>
              <button onClick={() => setShowPageTemplates(false)}
                className="p-2 rounded-lg hover:bg-white/[0.06] text-white/40 hover:text-white/80 transition-colors text-lg leading-none">✕</button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-white/[0.07] shrink-0">
              {(['internal', 'github'] as const).map(tab => (
                <button key={tab} onClick={() => setPageTemplateTab(tab)}
                  className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 ${
                    pageTemplateTab === tab
                      ? 'border-indigo-500 text-white'
                      : 'border-transparent text-white/40 hover:text-white/70'
                  }`}>
                  {tab === 'internal' ? '✨ Nos Templates Pro (8)' : '🔗 Bibliothèque GitHub'}
                </button>
              ))}
            </div>

            {/* ── TAB 1: Internal templates ── */}
            {pageTemplateTab === 'internal' && (
              <div className="flex-1 overflow-y-auto p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
                {PAGE_TEMPLATES.map(tpl => (
                  <button key={tpl.id}
                    onClick={() => {
                      if (!confirm(`Appliquer "${tpl.name}" ? Les sections actuelles seront remplacées.`)) return
                      setSections(tpl.sections)
                      setSelected(null)
                      setShowPageTemplates(false)
                    }}
                    className="group relative rounded-xl overflow-hidden border border-white/[0.08] hover:border-white/25 transition-all text-left">
                    {/* Color thumbnail */}
                    <div className="h-24 relative flex items-end p-3"
                      style={{ background: `linear-gradient(135deg, ${tpl.style}, ${tpl.accent}22)` }}>
                      {/* Mock section lines */}
                      <div className="space-y-1 w-full">
                        <div className="h-1.5 rounded-full w-3/4" style={{ background: tpl.dark ? 'rgba(255,255,255,0.5)' : 'rgba(11,29,81,0.5)' }} />
                        <div className="h-1 rounded-full w-1/2" style={{ background: tpl.dark ? 'rgba(255,255,255,0.25)' : 'rgba(11,29,81,0.25)' }} />
                        <div className="h-4 rounded w-16 mt-1" style={{ background: tpl.accent }} />
                      </div>
                      {/* Section count badge */}
                      <div className="absolute top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: tpl.dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)', color: tpl.dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.5)' }}>
                        {tpl.sections.length} sections
                      </div>
                    </div>
                    <div className="px-3 py-2.5 bg-[#0f1118]">
                      <p className="text-xs font-bold text-white/80 group-hover:text-white">{tpl.name}</p>
                      <p className="text-[10px] text-white/30 leading-tight mt-0.5">{tpl.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* ── TAB 2: GitHub library ── */}
            {pageTemplateTab === 'github' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Filters */}
                <div className="shrink-0 px-5 py-3 border-b border-white/[0.07] flex flex-wrap gap-3 items-center">
                  <select value={ghSource} onChange={e => setGhSource(e.target.value)}
                    className="text-xs bg-white/[0.06] border border-white/[0.1] text-white/70 rounded-lg px-3 py-1.5 focus:outline-none focus:border-white/30">
                    {GITHUB_SOURCES.map(s => <option key={s} value={s} className="bg-[#0c0e16]">{s}</option>)}
                  </select>
                  <div className="flex flex-wrap gap-1.5">
                    {GITHUB_CATEGORIES.map(cat => (
                      <button key={cat} onClick={() => setGhCategory(cat)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                          ghCategory === cat
                            ? 'bg-indigo-500 text-white'
                            : 'bg-white/[0.05] text-white/40 hover:bg-white/[0.1] hover:text-white/70'
                        }`}>
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Components grid */}
                <div className="flex-1 overflow-y-auto p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
                  {getGithubComponents(ghCategory, ghSource).map(comp => (
                    <div key={comp.id} className="rounded-xl overflow-hidden border border-white/[0.08] hover:border-white/20 transition-all flex flex-col">
                      {/* Preview block */}
                      <div className="h-20 flex flex-col items-center justify-center gap-1.5 px-3"
                        style={{ background: comp.previewBg }}>
                        <Code2 className="h-5 w-5 opacity-30" style={{ color: comp.previewBg === '#ffffff' || comp.previewBg === '#fafafa' || comp.previewBg === '#f8fafc' || comp.previewBg === '#f9fafb' || comp.previewBg === '#f3f4f6' ? '#0B1D51' : 'white' }} />
                        <span className="text-[10px] font-semibold opacity-50" style={{ color: comp.previewBg === '#ffffff' || comp.previewBg === '#fafafa' || comp.previewBg === '#f8fafc' || comp.previewBg === '#f9fafb' || comp.previewBg === '#f3f4f6' ? '#0B1D51' : 'white' }}>
                          {comp.source}
                        </span>
                      </div>
                      <div className="px-3 py-2 bg-[#0f1118] flex-1 flex flex-col gap-2">
                        <div>
                          <p className="text-xs font-semibold text-white/80">{comp.name}</p>
                          <p className="text-[10px] text-white/30">{comp.category}</p>
                        </div>
                        <button
                          disabled={ghFetching === comp.id}
                          onClick={async () => {
                            setGhFetching(comp.id)
                            setGhError(null)
                            const res = await fetchGithubComponentHtml(comp.rawUrl)
                            setGhFetching(null)
                            if ('error' in res) { setGhError(res.error); return }
                            const newSection = {
                              ...SECTION_DEFAULTS.custom_html,
                              label: `${comp.source} — ${comp.name}`,
                              html: res.html,
                            }
                            setSections(p => [...p, newSection])
                            setSelected(sections.length)
                            setShowPageTemplates(false)
                          }}
                          className="mt-auto flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[11px] font-semibold transition-colors bg-white/[0.06] hover:bg-indigo-500/20 text-white/50 hover:text-indigo-400 border border-white/[0.08] hover:border-indigo-500/30 disabled:opacity-40 disabled:cursor-not-allowed">
                          {ghFetching === comp.id
                            ? <><Loader2 className="h-3 w-3 animate-spin" /> Chargement...</>
                            : <><Download className="h-3 w-3" /> Importer</>}
                        </button>
                      </div>
                    </div>
                  ))}
                  {getGithubComponents(ghCategory, ghSource).length === 0 && (
                    <div className="col-span-full text-center py-12 text-white/30 text-sm">Aucun composant pour cette combinaison.</div>
                  )}
                </div>
                {ghError && (
                  <div className="shrink-0 flex items-center gap-2 px-5 py-3 bg-red-500/10 border-t border-red-500/20 text-red-400 text-xs">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {ghError}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── HERO VARIANT PICKER MODAL ───────────────────────────────── */}
      {showTemplatePicker && selected !== null && sections[selected]?.type === 'hero' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
          onClick={() => setShowTemplatePicker(false)}
        >
          <div
            className="relative bg-[#0f1118] border border-white/[0.08] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-white/[0.07] flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-base font-semibold text-white">Choisir un template hero</h2>
                <p className="text-xs text-white/40 mt-0.5">Sélectionne un style — le contenu reste intact</p>
              </div>
              <button onClick={() => setShowTemplatePicker(false)} className="p-2 rounded-lg hover:bg-white/[0.06] text-white/40 hover:text-white/80 transition-colors text-lg leading-none">✕</button>
            </div>

            {/* Grid */}
            <div className="flex-1 overflow-y-auto p-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {HERO_TEMPLATES.map(tpl => {
                const currentVariant = (sections[selected] as { variant?: HeroVariant }).variant ?? 'default'
                const isActive = currentVariant === tpl.id
                return (
                  <button
                    key={tpl.id}
                    onClick={() => {
                      update(selected, { ...sections[selected], variant: tpl.id } as PageSection)
                      setShowTemplatePicker(false)
                    }}
                    className={`group relative rounded-xl overflow-hidden border-2 transition-all text-left ${
                      isActive ? 'border-indigo-500 shadow-lg shadow-indigo-500/20' : 'border-white/[0.07] hover:border-white/25'
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="h-28 relative" style={{ background: tpl.thumbBg }}>
                      {/* Animated dots for particles */}
                      {tpl.id === 'particles' && (
                        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(184,134,11,0.5) 1px, transparent 1px)', backgroundSize: '12px 12px', opacity: 0.7 }} />
                      )}
                      {/* Grid lines for retro-grid */}
                      {tpl.id === 'retro-grid' && (
                        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(99,102,241,0.3) 1px,transparent 1px),linear-gradient(90deg,rgba(99,102,241,0.3) 1px,transparent 1px)', backgroundSize: '16px 16px', opacity: 0.8 }} />
                      )}
                      {/* Dot mesh for gradient-mesh */}
                      {tpl.id === 'gradient-mesh' && (
                        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(184,134,11,0.25) 1.5px, transparent 1.5px)', backgroundSize: '10px 10px' }} />
                      )}
                      {/* Glass card preview */}
                      {tpl.id === 'glass' && (
                        <div style={{ position: 'absolute', inset: '12px 16px', background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8 }} />
                      )}
                      {/* Grid overlay for minimal */}
                      {tpl.id === 'minimal' && (
                        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(11,29,81,0.08) 1px,transparent 1px),linear-gradient(90deg,rgba(11,29,81,0.08) 1px,transparent 1px)', backgroundSize: '20px 20px' }} />
                      )}
                      {/* Spotlight glow */}
                      {tpl.id === 'spotlight' && (
                        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 70% 60% at 50% 0%, rgba(99,102,241,0.4) 0%, transparent 65%)' }} />
                      )}
                      {/* Aurora blobs */}
                      {tpl.id === 'aurora' && (
                        <>
                          <div style={{ position: 'absolute', width: '55%', height: '55%', top: '-10%', left: '-10%', borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(88,28,135,0.7) 0%, transparent 70%)' }} />
                          <div style={{ position: 'absolute', width: '45%', height: '45%', bottom: '-10%', right: '-5%', borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(184,134,11,0.5) 0%, transparent 70%)' }} />
                        </>
                      )}
                      {/* Horizon line for retro-grid */}
                      {tpl.id === 'retro-grid' && (
                        <div style={{ position: 'absolute', top: '55%', left: 0, right: 0, height: '1px', background: 'linear-gradient(90deg, transparent, rgba(184,134,11,0.9), rgba(99,102,241,0.7), rgba(184,134,11,0.9), transparent)', boxShadow: '0 0 8px rgba(184,134,11,0.5)' }} />
                      )}
                      {/* Beams preview */}
                      {tpl.id === 'beams' && [0.2, 0.42, 0.65, 0.82].map((l, i) => (
                        <div key={i} style={{ position: 'absolute', top: 0, left: `${l * 100}%`, width: 1, height: '80%', background: 'linear-gradient(to bottom, rgba(99,102,241,0.6), transparent)', transform: 'rotate(10deg)', transformOrigin: 'top' }} />
                      ))}
                      {/* Dark noise preview */}
                      {tpl.id === 'dark-noise' && (
                        <div style={{ position: 'absolute', top: 0, left: '15%', right: '15%', height: '1px', background: 'linear-gradient(90deg, transparent, rgba(184,134,11,0.7), transparent)' }} />
                      )}
                      {/* Active check */}
                      {isActive && (
                        <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center text-white text-[10px] font-bold">✓</div>
                      )}
                      {/* Mock content lines */}
                      <div style={{
                        position: 'absolute', bottom: 12, left: 14, right: 14,
                        display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center',
                      }}>
                        <div style={{ height: 4, width: '70%', borderRadius: 4, background: tpl.darkThumb ? 'rgba(255,255,255,0.5)' : 'rgba(11,29,81,0.5)' }} />
                        <div style={{ height: 3, width: '50%', borderRadius: 4, background: tpl.darkThumb ? 'rgba(255,255,255,0.25)' : 'rgba(11,29,81,0.25)' }} />
                        <div style={{ height: 6, width: 40, borderRadius: 4, background: tpl.thumbAccent, marginTop: 2 }} />
                      </div>
                    </div>
                    {/* Label */}
                    <div className="px-3 py-2 bg-[#0f1118]">
                      <p className={`text-xs font-semibold ${isActive ? 'text-indigo-400' : 'text-white/70'}`}>{tpl.name}</p>
                      <p className="text-[10px] text-white/30 leading-tight mt-0.5">{tpl.desc}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
