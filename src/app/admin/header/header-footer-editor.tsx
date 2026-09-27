'use client'

import { useState, useTransition, useRef } from 'react'
import {
  Check, Loader2, AlertCircle, Plus, Trash2, GripVertical,
  ChevronDown, ExternalLink, Palette, Type, MousePointer,
  Columns3, Layout, Upload, Globe, FileText, X,
} from 'lucide-react'
import { saveHeaderConfig, saveFooterConfig, uploadLogo } from './actions'
import type { HeaderConfig, FooterConfig, CtaButton, FooterColumn, PageVisibility } from '@/types/layout'
import { DEFAULT_HEADER, DEFAULT_FOOTER } from '@/types/layout'

function uid() { return Math.random().toString(36).slice(2, 9) }

// ── Color palette (from CSS vars fallback palette) ────────────────
const PALETTE_COLORS = [
  // Brand
  { label: 'Navy', value: '#0B1D51' },
  { label: 'Gold', value: '#B8860B' },
  // Blues
  { label: 'Blue 600', value: '#2563EB' },
  { label: 'Blue 900', value: '#1E3A8A' },
  { label: 'Blue 50', value: '#EFF6FF' },
  // Neutrals
  { label: 'Blanc', value: '#FFFFFF' },
  { label: 'Gris 50', value: '#F8FAFC' },
  { label: 'Gris 100', value: '#F1F5F9' },
  { label: 'Gris 800', value: '#1E293B' },
  { label: 'Noir', value: '#0A0C10' },
  // Accents
  { label: 'Violet', value: '#7C3AED' },
  { label: 'Vert', value: '#16A34A' },
  { label: 'Orange', value: '#EA580C' },
  { label: 'Rouge', value: '#DC2626' },
]

const CSS_VAR_COLORS = [
  { label: 'Fond navbar (template)', value: 'var(--navbar-bg)' },
  { label: 'Texte navbar (template)', value: 'var(--navbar-text)' },
  { label: 'Couleur primaire (template)', value: 'var(--color-primary)' },
  { label: 'Fond page (template)', value: 'var(--color-background)' },
  { label: 'Surface (template)', value: 'var(--color-surface)' },
  { label: 'Hero bg (template)', value: 'var(--hero-bg)' },
]

// ── Color Picker with palette ─────────────────────────────────────
function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const isVar = value.startsWith('var(')

  // Resolve display color for preview
  const displayColor = isVar ? undefined : value

  return (
    <div className="relative">
      <div className="flex items-center gap-3 py-3 border-b border-white/[0.05] last:border-0">
        <p className="text-sm text-white/70 flex-1">{label}</p>
        <button onClick={() => setOpen(v => !v)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/15 transition-colors hover:border-white/30"
          style={{ background: 'rgba(255,255,255,0.05)' }}>
          {/* Color swatch */}
          <span className="w-5 h-5 rounded border border-white/20 shrink-0 flex items-center justify-center text-[8px] text-white/40"
            style={{ background: displayColor ?? 'linear-gradient(135deg, #0B1D51 50%, #B8860B 50%)' }}>
            {isVar ? '~' : ''}
          </span>
          <span className="text-xs font-mono text-white/50 max-w-[140px] truncate">{value}</span>
          <ChevronDown className="h-3 w-3 text-white/30 shrink-0" />
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-2xl overflow-hidden shadow-2xl"
          style={{ background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.12)' }}>
          <div className="p-4 space-y-4">
            {/* CSS Vars */}
            <div>
              <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-2">Couleurs du template</p>
              <div className="grid grid-cols-3 gap-1.5">
                {CSS_VAR_COLORS.map(c => (
                  <button key={c.value} onClick={() => { onChange(c.value); setOpen(false) }}
                    className="flex flex-col items-center gap-1 p-2 rounded-lg text-center transition-all hover:bg-white/10"
                    style={{ background: value === c.value ? 'rgba(255,255,255,0.12)' : 'transparent' }}>
                    <span className="w-7 h-7 rounded-full border-2 border-dashed border-white/20 flex items-center justify-center text-[9px] text-white/50">~</span>
                    <span className="text-[9px] text-white/40 leading-tight">{c.label.replace(' (template)', '')}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Palette */}
            <div>
              <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-2">Palette</p>
              <div className="grid grid-cols-7 gap-1.5">
                {PALETTE_COLORS.map(c => (
                  <button key={c.value}
                    title={c.label}
                    onClick={() => { onChange(c.value); setOpen(false) }}
                    className="group relative w-8 h-8 rounded-lg transition-transform hover:scale-110"
                    style={{
                      background: c.value,
                      outline: value === c.value ? '2px solid white' : 'none',
                      outlineOffset: '2px',
                    }}>
                    {value === c.value && (
                      <Check className="absolute inset-0 m-auto h-3.5 w-3.5 text-white drop-shadow" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom hex */}
            <div>
              <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-2">Couleur personnalisée</p>
              <div className="flex items-center gap-2">
                <div className="relative shrink-0">
                  <input type="color" value={isVar ? '#0B1D51' : value}
                    onChange={e => onChange(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                  <div className="w-9 h-9 rounded-lg border border-white/15 cursor-pointer"
                    style={{ background: isVar ? '#0B1D51' : value }} />
                </div>
                <input value={value} onChange={e => onChange(e.target.value)}
                  placeholder="#0B1D51 ou rgba(...)"
                  className="flex-1 bg-white/[0.05] border border-white/[0.1] text-white/70 text-xs font-mono rounded-lg px-2.5 py-2 focus:outline-none focus:border-white/30" />
              </div>
            </div>
          </div>
          <button onClick={() => setOpen(false)}
            className="w-full py-2 text-xs text-white/30 hover:text-white/60 transition-colors border-t border-white/[0.07]">
            Fermer
          </button>
        </div>
      )}
    </div>
  )
}

// ── Toggle ────────────────────────────────────────────────────────
function Toggle({ label, sub, value, onChange }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/[0.05] last:border-0">
      <div>
        <p className="text-sm text-white/70">{label}</p>
        {sub && <p className="text-[11px] text-white/30 mt-0.5">{sub}</p>}
      </div>
      <button onClick={() => onChange(!value)}
        className="relative flex items-center shrink-0 px-0.5 rounded-full transition-colors"
        style={{ width: '40px', height: '22px', background: value ? '#2563eb' : 'rgba(255,255,255,0.12)' }}>
        <span className="w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
          style={{ transform: value ? 'translateX(18px)' : 'translateX(0)' }} />
      </button>
    </div>
  )
}

function SelectRow<T extends string>({ label, value, options, onChange }: {
  label: string; value: T
  options: { label: string; value: T }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/[0.05] last:border-0 gap-4">
      <p className="text-sm text-white/70 shrink-0">{label}</p>
      <div className="relative">
        <select value={value} onChange={e => onChange(e.target.value as T)}
          className="appearance-none bg-white/[0.05] border border-white/[0.1] text-white/70 text-sm rounded-lg px-3 py-2 pr-8 focus:outline-none focus:border-white/30">
          {options.map(o => (
            <option key={o.value} value={o.value} className="bg-[#1a1a2e] text-white">{o.label}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/30 pointer-events-none" />
      </div>
    </div>
  )
}

function NumberRow({ label, value, min, max, unit, onChange }: {
  label: string; value: number; min: number; max: number; unit?: string; onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/[0.05] last:border-0 gap-4">
      <p className="text-sm text-white/70 shrink-0">{label}</p>
      <div className="flex items-center gap-3">
        <input type="range" min={min} max={max} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-28 accent-blue-500" />
        <span className="text-sm text-white/50 w-12 text-right font-mono tabular-nums">{value}{unit}</span>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold text-white/35 uppercase tracking-widest mb-3">{title}</h3>
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.07] px-4">
        {children}
      </div>
    </div>
  )
}

// ── Page visibility picker ────────────────────────────────────────
function PagesPicker({ value, onChange, availablePages }: {
  value: PageVisibility
  onChange: (v: PageVisibility) => void
  availablePages: { slug: string; title: string }[]
}) {
  const isAll = value === 'all'
  const selected = isAll ? [] : (value as string[])

  function toggle(slug: string) {
    const next = selected.includes(slug)
      ? selected.filter(s => s !== slug)
      : [...selected, slug]
    onChange(next.length === 0 ? 'all' : next)
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button onClick={() => onChange('all')}
          className="flex-1 flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-all"
          style={{
            background: isAll ? 'rgba(37,99,235,0.15)' : 'rgba(255,255,255,0.03)',
            border: isAll ? '1px solid rgba(37,99,235,0.5)' : '1px solid rgba(255,255,255,0.08)',
            color: isAll ? '#60a5fa' : 'rgba(255,255,255,0.5)',
          }}>
          <Globe className="h-4 w-4" />
          Tout le site
        </button>
        <button onClick={() => onChange(selected.length > 0 ? selected : [])}
          className="flex-1 flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-all"
          style={{
            background: !isAll ? 'rgba(37,99,235,0.15)' : 'rgba(255,255,255,0.03)',
            border: !isAll ? '1px solid rgba(37,99,235,0.5)' : '1px solid rgba(255,255,255,0.08)',
            color: !isAll ? '#60a5fa' : 'rgba(255,255,255,0.5)',
          }}>
          <FileText className="h-4 w-4" />
          Pages spécifiques
        </button>
      </div>

      {!isAll && (
        <div className="rounded-xl border border-white/[0.08] overflow-hidden">
          {/* Fixed pages */}
          {[
            { slug: '/', title: 'Page d\'accueil' },
            { slug: '/jobs', title: 'Offres d\'emploi' },
            { slug: '/login', title: 'Connexion' },
            { slug: '/register', title: 'Inscription' },
            { slug: '/candidate/dashboard', title: 'Espace candidat' },
            { slug: '/recruiter/dashboard', title: 'Espace recruteur' },
          ].concat(availablePages.map(p => ({ slug: `/${p.slug}`, title: p.title }))).map((page, i) => (
            <label key={page.slug}
              className="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-white/[0.04]"
              style={{ borderTop: i > 0 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
              <div className="relative w-4 h-4 shrink-0">
                <input type="checkbox" checked={selected.includes(page.slug)}
                  onChange={() => toggle(page.slug)}
                  className="absolute inset-0 opacity-0 cursor-pointer" />
                <div className="w-4 h-4 rounded border flex items-center justify-center transition-all"
                  style={{
                    background: selected.includes(page.slug) ? '#2563eb' : 'transparent',
                    borderColor: selected.includes(page.slug) ? '#2563eb' : 'rgba(255,255,255,0.2)',
                  }}>
                  {selected.includes(page.slug) && <Check className="h-2.5 w-2.5 text-white" />}
                </div>
              </div>
              <span className="text-sm text-white/60">{page.title}</span>
              <span className="text-xs text-white/25 ml-auto font-mono">{page.slug}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── CTA Button editor ─────────────────────────────────────────────
function CtaEditor({ buttons, onChange }: { buttons: CtaButton[]; onChange: (b: CtaButton[]) => void }) {
  function add() {
    onChange([...buttons, {
      id: uid(), label: 'Nouveau bouton', href: '/',
      style: 'filled', bgColor: '#2563EB', textColor: '#ffffff',
      rounded: 'full', size: 'md', showFor: 'all',
    }])
  }
  function update(id: string, patch: Partial<CtaButton>) {
    onChange(buttons.map(b => b.id === id ? { ...b, ...patch } : b))
  }
  function remove(id: string) { onChange(buttons.filter(b => b.id !== id)) }

  const inp = 'w-full bg-white/[0.05] border border-white/[0.1] text-white/70 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-white/30'

  return (
    <div className="space-y-3">
      {buttons.map(btn => (
        <div key={btn.id} className="rounded-xl border border-white/[0.1] bg-white/[0.03] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.07]">
            <GripVertical className="h-4 w-4 text-white/20 shrink-0" />
            <input value={btn.label} onChange={e => update(btn.id, { label: e.target.value })}
              className="flex-1 bg-transparent text-sm font-medium text-white/80 focus:outline-none" />
            <div className="px-3 py-1 text-xs font-semibold shrink-0"
              style={{
                background: btn.style === 'filled' ? btn.bgColor : 'transparent',
                color: btn.style === 'filled' ? btn.textColor : btn.bgColor,
                border: btn.style === 'outline' ? `1.5px solid ${btn.bgColor}` : 'none',
                borderRadius: { none: '0', sm: '4px', md: '8px', lg: '12px', full: '9999px' }[btn.rounded],
              }}>
              {btn.label}
            </div>
            <button onClick={() => remove(btn.id)} className="text-white/25 hover:text-red-400 transition-colors">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="px-4 py-4 grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] text-white/35 mb-1.5">Lien</p>
              <input value={btn.href} onChange={e => update(btn.id, { href: e.target.value })} className={inp} />
            </div>
            <div>
              <p className="text-[11px] text-white/35 mb-1.5">Visibilité</p>
              <select value={btn.showFor} onChange={e => update(btn.id, { showFor: e.target.value as CtaButton['showFor'] })} className={inp}>
                <option value="all" className="bg-[#1a1a2e]">Tous</option>
                <option value="guest" className="bg-[#1a1a2e]">Visiteurs uniquement</option>
                <option value="logged" className="bg-[#1a1a2e]">Connectés uniquement</option>
              </select>
            </div>
            <div>
              <p className="text-[11px] text-white/35 mb-1.5">Style</p>
              <div className="flex rounded-lg overflow-hidden border border-white/[0.1]">
                {(['filled', 'outline', 'ghost'] as const).map(s => (
                  <button key={s} onClick={() => update(btn.id, { style: s })}
                    className="flex-1 py-2 text-xs capitalize transition-all"
                    style={{
                      background: btn.style === s ? 'rgba(255,255,255,0.12)' : 'transparent',
                      color: btn.style === s ? 'white' : 'rgba(255,255,255,0.35)',
                    }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] text-white/35 mb-1.5">Arrondi</p>
              <div className="flex rounded-lg overflow-hidden border border-white/[0.1]">
                {(['sm', 'md', 'lg', 'full'] as const).map(r => (
                  <button key={r} onClick={() => update(btn.id, { rounded: r })}
                    className="flex-1 py-2 text-xs transition-all"
                    style={{
                      background: btn.rounded === r ? 'rgba(255,255,255,0.12)' : 'transparent',
                      color: btn.rounded === r ? 'white' : 'rgba(255,255,255,0.35)',
                    }}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="col-span-2 grid grid-cols-2 gap-3">
              {[
                { label: 'Couleur fond', key: 'bgColor' as const },
                { label: 'Couleur texte', key: 'textColor' as const },
              ].map(f => (
                <div key={f.key} className="flex items-center gap-2">
                  <div className="relative shrink-0">
                    <input type="color" value={btn[f.key].startsWith('#') ? btn[f.key] : '#000000'}
                      onChange={e => update(btn.id, { [f.key]: e.target.value })}
                      className="absolute inset-0 opacity-0 cursor-pointer" />
                    <div className="w-8 h-8 rounded-lg border border-white/15 cursor-pointer"
                      style={{ background: btn[f.key] }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-white/30 mb-0.5">{f.label}</p>
                    <input value={btn[f.key]} onChange={e => update(btn.id, { [f.key]: e.target.value })}
                      className="w-full bg-transparent text-[11px] font-mono text-white/40 focus:outline-none border-b border-white/10" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
      <button onClick={add}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-white/20 text-sm text-white/40 hover:text-white/70 hover:border-white/40 transition-all">
        <Plus className="h-4 w-4" /> Ajouter un bouton
      </button>
    </div>
  )
}

// ── Footer columns editor ─────────────────────────────────────────
function FooterColumnsEditor({ columns, onChange }: { columns: FooterColumn[]; onChange: (c: FooterColumn[]) => void }) {
  function addCol() {
    onChange([...columns, { id: uid(), title: 'Nouvelle section', links: [] }])
  }
  function updateCol(id: string, patch: Partial<FooterColumn>) {
    onChange(columns.map(c => c.id === id ? { ...c, ...patch } : c))
  }
  function removeCol(id: string) { onChange(columns.filter(c => c.id !== id)) }
  function addLink(colId: string) {
    const col = columns.find(c => c.id === colId)!
    updateCol(colId, { links: [...col.links, { label: 'Nouveau lien', href: '/' }] })
  }
  function updateLink(colId: string, idx: number, patch: { label?: string; href?: string }) {
    const col = columns.find(c => c.id === colId)!
    updateCol(colId, { links: col.links.map((l, i) => i === idx ? { ...l, ...patch } : l) })
  }
  function removeLink(colId: string, idx: number) {
    const col = columns.find(c => c.id === colId)!
    updateCol(colId, { links: col.links.filter((_, i) => i !== idx) })
  }

  const inp = 'flex-1 bg-white/[0.05] border border-white/[0.1] text-white/70 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-white/30'

  return (
    <div className="space-y-3">
      {columns.map(col => (
        <div key={col.id} className="rounded-xl border border-white/[0.1] bg-white/[0.03]">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.07]">
            <GripVertical className="h-4 w-4 text-white/20" />
            <input value={col.title} onChange={e => updateCol(col.id, { title: e.target.value })}
              className="flex-1 bg-transparent text-sm font-semibold text-white/80 focus:outline-none" />
            <button onClick={() => removeCol(col.id)} className="text-white/20 hover:text-red-400 transition-colors">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="px-4 py-3 space-y-2">
            {col.links.map((link, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input value={link.label} onChange={e => updateLink(col.id, idx, { label: e.target.value })}
                  placeholder="Libellé" className={inp} />
                <input value={link.href} onChange={e => updateLink(col.id, idx, { href: e.target.value })}
                  placeholder="/page" className="w-32 bg-white/[0.05] border border-white/[0.1] text-white/70 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-white/30 font-mono" />
                <button onClick={() => removeLink(col.id, idx)} className="text-white/20 hover:text-red-400 transition-colors shrink-0">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button onClick={() => addLink(col.id)}
              className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors pt-1">
              <Plus className="h-3.5 w-3.5" /> Ajouter un lien
            </button>
          </div>
        </div>
      ))}
      <button onClick={addCol}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-white/20 text-sm text-white/40 hover:text-white/70 hover:border-white/40 transition-all">
        <Plus className="h-4 w-4" /> Ajouter une colonne
      </button>
    </div>
  )
}

// ── Logo uploader ─────────────────────────────────────────────────
function LogoUploader({ currentLogoUrl, siteName, onUploaded }: { currentLogoUrl?: string; siteName: string; onUploaded?: (url: string) => void }) {
  const [uploading, setUploading] = useState(false)
  const [url, setUrl] = useState(currentLogoUrl ?? '')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await uploadLogo(form)
      if ('error' in res) setError(res.error)
      else { setUrl(res.url); onUploaded?.(res.url) }
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Current logo */}
      <div className="flex items-center gap-4 p-4 rounded-xl bg-white/[0.03] border border-white/[0.07]">
        <div className="w-24 h-12 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: '#0B1D51', border: '1px solid rgba(255,255,255,0.1)' }}>
          {url
            ? <img src={url} alt="logo" className="max-h-10 max-w-20 object-contain" />
            : <span className="text-xs text-white/30 font-bold">{siteName.slice(0, 3)}</span>
          }
        </div>
        <div className="flex-1 min-w-0">
          {url
            ? <p className="text-xs text-white/50 font-mono truncate">{url.split('/').pop()}</p>
            : <p className="text-sm text-white/40">Aucun logo uploadé</p>
          }
          <p className="text-[11px] text-white/25 mt-0.5">PNG ou SVG recommandé, fond transparent</p>
        </div>
        {url && (
          <button onClick={() => setUrl('')} className="text-white/20 hover:text-red-400 transition-colors shrink-0">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Upload zone */}
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-full flex items-center justify-center gap-3 py-4 rounded-xl border-2 border-dashed transition-all"
        style={{ borderColor: 'rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.02)' }}
        onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'rgba(37,99,235,0.6)' }}
        onDragLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)' }}
        onDrop={async e => {
          e.preventDefault()
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'
          const file = e.dataTransfer.files[0]
          if (file) handleFile(file)
        }}>
        {uploading
          ? <><Loader2 className="h-4 w-4 text-white/50 animate-spin" /><span className="text-sm text-white/40">Upload en cours…</span></>
          : <><Upload className="h-4 w-4 text-white/30" /><span className="text-sm text-white/40">Glisser un fichier ou cliquer pour choisir</span></>
        }
      </button>
      <input ref={inputRef} type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp"
        className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />

      {error && <p className="text-xs text-red-400 px-1">{error}</p>}
    </div>
  )
}

// ── Navbar live preview ───────────────────────────────────────────
function NavbarPreview({ h, siteName, logoUrl }: { h: HeaderConfig; siteName: string; logoUrl?: string }) {
  const bg = h.bgColor.startsWith('var(') ? '#0B1D51' : h.bgColor
  const text = h.textColor.startsWith('var(') ? '#ffffff' : h.textColor
  const accent = h.accentLineColor.startsWith('var(') ? '#B8860B' : h.accentLineColor
  const navGap = h.navSpacing === 'tight' ? '0' : h.navSpacing === 'wide' ? '16px' : '6px'
  const roundedMap: Record<string, string> = { none: '0', sm: '4px', md: '8px', lg: '12px', full: '9999px' }

  return (
    <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
      {/* Browser chrome */}
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: '#1a1d2e', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/70" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
          <div className="w-3 h-3 rounded-full bg-green-500/70" />
        </div>
        <div className="flex-1 mx-3 px-3 py-1 rounded-md text-[11px] text-white/30 font-mono" style={{ background: 'rgba(255,255,255,0.05)' }}>
          mybestconsultant.fr
        </div>
      </div>

      {/* Accent line */}
      {h.showAccentLine && (
        <div className="h-[3px]" style={{ background: `linear-gradient(90deg, transparent 5%, ${accent} 40%, ${accent} 60%, transparent 95%)` }} />
      )}

      {/* Navbar */}
      <div className="flex items-center px-8 gap-6"
        style={{
          height: `${h.height}px`,
          background: bg,
          borderBottom: h.showBorder ? '1px solid rgba(128,128,128,0.15)' : 'none',
          boxShadow: h.showShadow ? '0 4px 24px rgba(0,0,0,0.25)' : 'none',
          backdropFilter: h.backdropBlur ? 'blur(12px)' : 'none',
        }}>
        {logoUrl
          ? <img src={logoUrl} alt={siteName} style={{ height: `${Math.min(h.logoHeight, h.height - 20)}px` }} className="w-auto object-contain shrink-0" />
          : <span className="font-bold tracking-wide shrink-0" style={{ color: text, fontSize: `${Math.round(h.height * 0.24)}px` }}>{siteName}</span>
        }
        <div className="flex items-center flex-1" style={{ gap: navGap, justifyContent: h.navAlign === 'center' ? 'center' : h.navAlign === 'right' ? 'flex-end' : 'flex-start' }}>
          {['Offres', 'Mon espace', 'À propos', 'Blog'].map((label, i) => (
            <div key={label} className="relative px-3 py-2 rounded-lg"
              style={{
                color: text,
                opacity: i === 0 ? 1 : i === 1 ? 0.6 : 0.38,
                fontSize: h.navFontSize,
                fontWeight: i === 0 && h.navActiveStyle === 'bold' ? 700 : parseInt(h.navFontWeight),
                background: i === 0 && h.navActiveStyle === 'pill' ? 'rgba(128,128,128,0.18)' : 'transparent',
              }}>
              {label}
              {i === 0 && h.navActiveStyle === 'underline' && (
                <span className="absolute bottom-1 left-3 right-3 h-[2px] rounded-full" style={{ background: accent }} />
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-sm" style={{ color: text, opacity: 0.5, fontSize: h.navFontSize }}>Connexion</span>
          {h.ctaButtons.filter(b => b.showFor !== 'logged').slice(0, 2).map(btn => (
            <div key={btn.id} className="font-semibold whitespace-nowrap"
              style={{
                background: btn.style === 'filled' ? btn.bgColor : 'transparent',
                color: btn.style === 'filled' ? btn.textColor : btn.bgColor,
                border: btn.style === 'outline' ? `1.5px solid ${btn.bgColor}` : 'none',
                borderRadius: roundedMap[btn.rounded] ?? '8px',
                padding: btn.size === 'sm' ? '5px 12px' : btn.size === 'lg' ? '10px 22px' : '7px 16px',
                fontSize: btn.size === 'sm' ? '11px' : btn.size === 'lg' ? '15px' : '13px',
              }}>
              {btn.label}
            </div>
          ))}
        </div>
      </div>

      {/* Page content stub */}
      <div style={{ background: '#f8fafc' }}>
        {/* Hero */}
        <div className="px-8 py-10 space-y-3" style={{ background: 'linear-gradient(135deg, #0B1D51 0%, #1a3080 100%)' }}>
          <div className="h-5 w-2/3 rounded-full bg-white/20" />
          <div className="h-3 w-1/2 rounded-full bg-white/10" />
          <div className="flex gap-3 mt-4">
            <div className="h-8 w-28 rounded-lg" style={{ background: accent }} />
            <div className="h-8 w-24 rounded-lg border border-white/30" />
          </div>
        </div>
        {/* Cards row */}
        <div className="px-8 py-6 grid grid-cols-3 gap-4" style={{ background: '#f8fafc' }}>
          {[1,2,3].map(i => (
            <div key={i} className="rounded-xl p-4 space-y-2" style={{ background: 'white', border: '1px solid #e2e8f0' }}>
              <div className="h-3 w-3/4 rounded-full bg-slate-200" />
              <div className="h-2.5 w-1/2 rounded-full bg-slate-100" />
              <div className="h-2 w-2/3 rounded-full bg-slate-100" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Footer preview ────────────────────────────────────────────────
function FooterPreview({ f, siteName }: { f: FooterConfig; siteName: string }) {
  const bg = f.bgColor.startsWith('var(') ? '#0B1D51' : f.bgColor
  const text = f.textColor.startsWith('var(') ? '#ffffff' : f.textColor
  const muted = f.mutedColor.startsWith('rgba') || f.mutedColor.startsWith('#') ? f.mutedColor : 'rgba(255,255,255,0.45)'
  const colCount = Math.min(f.columns.length, 4)

  return (
    <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
      {/* Page content stub above footer */}
      <div className="px-8 py-5 grid grid-cols-3 gap-3" style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
        {[1,2,3].map(i => (
          <div key={i} className="rounded-lg p-3 space-y-1.5" style={{ background: 'white', border: '1px solid #e2e8f0' }}>
            <div className="h-2.5 w-3/4 rounded-full bg-slate-200" />
            <div className="h-2 w-1/2 rounded-full bg-slate-100" />
          </div>
        ))}
      </div>

      {/* Footer main */}
      <div className="px-8 pt-8 pb-6" style={{ background: bg }}>
        <div className={`grid gap-8 mb-8`}
          style={{ gridTemplateColumns: `200px ${Array(colCount).fill('1fr').join(' ')}` }}>
          {/* Brand col */}
          <div className="space-y-3">
            {f.showLogo && (
              <p className="font-bold text-base" style={{ color: text }}>{siteName}</p>
            )}
            {f.showTagline && (
              <p className="text-xs leading-relaxed" style={{ color: muted }}>
                La plateforme AI des consultants IT
              </p>
            )}
            {f.showSocial && f.socialLinks.length > 0 && (
              <div className="flex gap-2 pt-1">
                {f.socialLinks.map(s => (
                  <span key={s.platform} className="w-7 h-7 rounded-full border flex items-center justify-center text-[9px] font-bold"
                    style={{ borderColor: 'rgba(255,255,255,0.2)', color: muted }}>
                    {s.platform === 'linkedin' ? 'in' : s.platform === 'twitter' ? 'X' : s.platform.slice(0,2)}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Link columns */}
          {f.columns.slice(0, 4).map(col => (
            <div key={col.id}>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: muted }}>{col.title}</p>
              <ul className="space-y-2">
                {col.links.map(l => (
                  <li key={l.href} className="text-xs" style={{ color: text, opacity: 0.65 }}>{l.label}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between pt-5 text-[10px]"
          style={{ borderTop: '1px solid rgba(255,255,255,0.08)', color: muted }}>
          <span>{f.bottomText}</span>
          <div className="flex items-center gap-4">
            <span>Mentions légales</span>
            <span>RGPD</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main editor ───────────────────────────────────────────────────
type Tab = 'header-style' | 'header-logo' | 'header-nav' | 'header-buttons' | 'header-pages'
         | 'footer-style' | 'footer-links' | 'footer-pages'

interface Props {
  initialHeader: HeaderConfig
  initialFooter: FooterConfig
  siteName: string
  logoUrl?: string
  availablePages: { slug: string; title: string }[]
}

export function HeaderFooterEditor({ initialHeader, initialFooter, siteName, logoUrl, availablePages }: Props) {
  const [tab, setTab] = useState<Tab>('header-style')
  const [header, setHeader] = useState<HeaderConfig>(initialHeader)
  const [footer, setFooter] = useState<FooterConfig>(initialFooter)
  const [currentLogoUrl, setCurrentLogoUrl] = useState(logoUrl ?? '')
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState('')

  const isHeader = tab.startsWith('header')

  function setH<K extends keyof HeaderConfig>(key: K, value: HeaderConfig[K]) {
    setHeader(prev => ({ ...prev, [key]: value }))
  }
  function setF<K extends keyof FooterConfig>(key: K, value: FooterConfig[K]) {
    setFooter(prev => ({ ...prev, [key]: value }))
  }

  function save() {
    setStatus('idle')
    startTransition(async () => {
      const res = isHeader ? await saveHeaderConfig(header) : await saveFooterConfig(footer)
      if (res.error) { setStatus('error'); setErrMsg(res.error) }
      else { setStatus('ok'); setTimeout(() => setStatus('idle'), 3000) }
    })
  }

  const HEADER_TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'header-style',   label: 'Apparence', icon: Palette },
    { id: 'header-logo',    label: 'Logo',       icon: Upload },
    { id: 'header-nav',     label: 'Navigation', icon: Type },
    { id: 'header-buttons', label: 'Boutons',    icon: MousePointer },
    { id: 'header-pages',   label: 'Visibilité', icon: Globe },
  ]

  const FOOTER_TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'footer-style', label: 'Apparence', icon: Palette },
    { id: 'footer-links', label: 'Colonnes',  icon: Columns3 },
    { id: 'footer-pages', label: 'Visibilité', icon: Globe },
  ]

  const tabs = isHeader ? HEADER_TABS : FOOTER_TABS

  return (
    <div className="min-h-full bg-[#0A0C10] text-white">

      {/* Header */}
      <div className="border-b border-white/[0.07] px-8 py-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Header & Footer</h1>
          <p className="text-sm text-white/35 mt-0.5">
            Personnalisez l&apos;en-tête et le pied de page — les changements s&apos;appliquent sur tout le site
          </p>
        </div>
        <a href="/" target="_blank"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.08] text-xs text-white/40 hover:text-white transition-colors">
          <ExternalLink className="h-3.5 w-3.5" /> Voir le site
        </a>
      </div>

      {status === 'error' && (
        <div className="mx-8 mt-4 flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />{errMsg}
        </div>
      )}

      <div className="flex flex-col xl:flex-row min-h-[calc(100vh-80px)]">

        {/* ── Left ── */}
        <div className="flex-1 px-8 py-6 space-y-5">

          {/* Section switcher */}
          <div className="flex gap-1.5 p-1.5 rounded-2xl bg-white/[0.04] border border-white/[0.06] w-fit">
            {['header', 'footer'].map(s => (
              <button key={s} onClick={() => setTab(s === 'header' ? 'header-style' : 'footer-style')}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all capitalize"
                style={{
                  background: (s === 'header' ? isHeader : !isHeader) ? 'white' : 'transparent',
                  color: (s === 'header' ? isHeader : !isHeader) ? 'black' : 'rgba(255,255,255,0.4)',
                }}>
                {s === 'header' ? <Layout className="h-4 w-4" /> : <Columns3 className="h-4 w-4" />}
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {/* Sub-tabs */}
          <div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06] w-fit">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-all"
                style={{
                  background: tab === t.id ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: tab === t.id ? 'white' : 'rgba(255,255,255,0.38)',
                }}>
                <t.icon className="h-3.5 w-3.5" />{t.label}
              </button>
            ))}
          </div>

          {/* ── HEADER APPARENCE ── */}
          {tab === 'header-style' && (
            <div className="space-y-5 max-w-2xl">
              <Section title="Couleurs">
                <ColorPicker label="Fond du header" value={header.bgColor} onChange={v => setH('bgColor', v)} />
                <ColorPicker label="Couleur du texte & liens" value={header.textColor} onChange={v => setH('textColor', v)} />
                <ColorPicker label="Couleur ligne d'accent" value={header.accentLineColor} onChange={v => setH('accentLineColor', v)} />
              </Section>
              <Section title="Dimensions">
                <NumberRow label="Hauteur" value={header.height} min={48} max={120} unit="px" onChange={v => setH('height', v)} />
              </Section>
              <Section title="Comportement">
                <Toggle label="Fixé en haut (sticky)" sub="Reste visible pendant le scroll" value={header.sticky} onChange={v => setH('sticky', v)} />
                <Toggle label="Flou d'arrière-plan" sub="Effet verre dépoli" value={header.backdropBlur} onChange={v => setH('backdropBlur', v)} />
              </Section>
              <Section title="Décorations">
                <Toggle label="Ligne d'accent en haut" value={header.showAccentLine} onChange={v => setH('showAccentLine', v)} />
                <Toggle label="Bordure inférieure" value={header.showBorder} onChange={v => setH('showBorder', v)} />
                <Toggle label="Ombre portée" value={header.showShadow} onChange={v => setH('showShadow', v)} />
              </Section>
            </div>
          )}

          {/* ── LOGO ── */}
          {tab === 'header-logo' && (
            <div className="max-w-xl space-y-5">
              <Section title="Logo du site">
                <div className="py-3">
                  <LogoUploader currentLogoUrl={currentLogoUrl} siteName={siteName} onUploaded={setCurrentLogoUrl} />
                </div>
              </Section>
              <Section title="Taille d'affichage">
                <NumberRow label="Hauteur du logo" value={header.logoHeight} min={20} max={80} unit="px" onChange={v => setH('logoHeight', v)} />
              </Section>
            </div>
          )}

          {/* ── NAVIGATION ── */}
          {tab === 'header-nav' && (
            <div className="space-y-5 max-w-xl">
              <Section title="Police des liens">
                <SelectRow label="Taille" value={header.navFontSize as string}
                  options={['12px','13px','14px','15px','16px','18px'].map(v => ({ label: v, value: v }))}
                  onChange={v => setH('navFontSize', v)} />
                <SelectRow label="Graisse" value={header.navFontWeight as string}
                  options={[
                    { label: 'Light (300)', value: '300' },
                    { label: 'Normal (400)', value: '400' },
                    { label: 'Medium (500)', value: '500' },
                    { label: 'SemiBold (600)', value: '600' },
                    { label: 'Bold (700)', value: '700' },
                  ]}
                  onChange={v => setH('navFontWeight', v)} />
                <SelectRow label="Espacement" value={header.navSpacing}
                  options={[
                    { label: 'Serré', value: 'tight' },
                    { label: 'Normal', value: 'normal' },
                    { label: 'Large', value: 'wide' },
                  ]}
                  onChange={v => setH('navSpacing', v)} />
                <SelectRow label="Alignement menu" value={header.navAlign ?? 'left'}
                  options={[
                    { label: 'Gauche', value: 'left' },
                    { label: 'Centré', value: 'center' },
                    { label: 'Droite', value: 'right' },
                  ]}
                  onChange={v => setH('navAlign', v as 'left' | 'center' | 'right')} />
              </Section>
              <Section title="Lien actif">
                <SelectRow label="Style actif" value={header.navActiveStyle}
                  options={[
                    { label: 'Souligné', value: 'underline' },
                    { label: 'Pilule', value: 'pill' },
                    { label: 'Gras', value: 'bold' },
                    { label: 'Aucun', value: 'none' },
                  ]}
                  onChange={v => setH('navActiveStyle', v)} />
              </Section>
              <Section title="Effet au survol">
                <SelectRow label="Hover effect" value={header.hoverEffect}
                  options={[
                    { label: 'Surbrillance', value: 'highlight' },
                    { label: 'Souligné', value: 'underline' },
                    { label: 'Agrandissement', value: 'scale' },
                    { label: 'Gras', value: 'bold' },
                    { label: 'Aucun', value: 'none' },
                  ]}
                  onChange={v => setH('hoverEffect', v)} />
              </Section>
            </div>
          )}

          {/* ── BOUTONS ── */}
          {tab === 'header-buttons' && (
            <div className="max-w-xl">
              <p className="text-sm text-white/35 mb-4">
                Boutons dans la zone droite du header. Contrôlez le style et la visibilité selon l&apos;état de connexion.
              </p>
              <CtaEditor buttons={header.ctaButtons} onChange={v => setH('ctaButtons', v)} />
            </div>
          )}

          {/* ── HEADER PAGES ── */}
          {tab === 'header-pages' && (
            <div className="max-w-xl space-y-4">
              <Section title="Afficher le header sur">
                <div className="py-3">
                  <PagesPicker value={header.pages} onChange={v => setH('pages', v)} availablePages={availablePages} />
                </div>
              </Section>
            </div>
          )}

          {/* ── FOOTER APPARENCE ── */}
          {tab === 'footer-style' && (
            <div className="space-y-5 max-w-2xl">
              <Section title="Couleurs">
                <ColorPicker label="Fond du footer" value={footer.bgColor} onChange={v => setF('bgColor', v)} />
                <ColorPicker label="Texte principal" value={footer.textColor} onChange={v => setF('textColor', v)} />
                <ColorPicker label="Texte secondaire / muted" value={footer.mutedColor} onChange={v => setF('mutedColor', v)} />
              </Section>
              <Section title="Espacement">
                <SelectRow label="Padding vertical" value={footer.paddingY}
                  options={[
                    { label: 'Compact (40px)', value: 'sm' },
                    { label: 'Normal (64px)', value: 'md' },
                    { label: 'Spacieux (80px)', value: 'lg' },
                  ]}
                  onChange={v => setF('paddingY', v)} />
              </Section>
              <Section title="Éléments">
                <Toggle label="Afficher le logo" value={footer.showLogo} onChange={v => setF('showLogo', v)} />
                <Toggle label="Afficher le tagline" value={footer.showTagline} onChange={v => setF('showTagline', v)} />
                <Toggle label="Réseaux sociaux" value={footer.showSocial} onChange={v => setF('showSocial', v)} />
              </Section>
              <Section title="Texte de bas de page">
                <div className="py-3">
                  <input value={footer.bottomText} onChange={e => setF('bottomText', e.target.value)}
                    className="w-full bg-white/[0.05] border border-white/[0.1] text-white/70 text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-white/30" />
                </div>
              </Section>
            </div>
          )}

          {/* ── FOOTER COLONNES ── */}
          {tab === 'footer-links' && (
            <div className="max-w-2xl">
              <p className="text-sm text-white/35 mb-4">Organisez les liens du footer en colonnes thématiques.</p>
              <FooterColumnsEditor columns={footer.columns} onChange={v => setF('columns', v)} />
            </div>
          )}

          {/* ── FOOTER PAGES ── */}
          {tab === 'footer-pages' && (
            <div className="max-w-xl space-y-4">
              <Section title="Afficher le footer sur">
                <div className="py-3">
                  <PagesPicker value={footer.pages} onChange={v => setF('pages', v)} availablePages={availablePages} />
                </div>
              </Section>
            </div>
          )}
        </div>

        {/* ── Right panel ── */}
        <div className="w-full xl:w-[580px] shrink-0 border-t xl:border-t-0 xl:border-l border-white/[0.07] flex flex-col sticky top-0 h-screen overflow-y-auto">

          {/* Save button */}
          <div className="p-5 border-b border-white/[0.07]">
            <button onClick={save} disabled={isPending}
              className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all"
              style={{
                background: status === 'ok' ? '#10b981' : status === 'error' ? 'rgba(239,68,68,0.2)' : 'white',
                color: status === 'error' ? '#f87171' : 'black',
              }}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" />
                : status === 'ok' ? <Check className="h-4 w-4" />
                : status === 'error' ? <AlertCircle className="h-4 w-4" />
                : null}
              {isPending ? 'Sauvegarde…'
                : status === 'ok' ? 'Appliqué sur le site !'
                : status === 'error' ? 'Erreur'
                : `Appliquer le ${isHeader ? 'header' : 'footer'}`}
            </button>
            {status === 'ok' && (
              <p className="text-xs text-emerald-400/70 text-center mt-2 animate-pulse">
                ✓ Visible sur le site maintenant
              </p>
            )}
          </div>

          {/* Previews */}
          <div className="p-6 space-y-8">
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-semibold text-white/30 uppercase tracking-widest">Aperçu Header</p>
                <span className="text-[10px] px-2 py-0.5 rounded-full text-blue-400/70" style={{ background: 'rgba(37,99,235,0.12)' }}>
                  {header.pages === 'all' ? 'Tout le site' : `${(header.pages as string[]).length} page(s)`}
                </span>
              </div>
              <NavbarPreview h={header} siteName={siteName} logoUrl={currentLogoUrl} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-semibold text-white/30 uppercase tracking-widest">Aperçu Footer</p>
                <span className="text-[10px] px-2 py-0.5 rounded-full text-purple-400/70" style={{ background: 'rgba(139,92,246,0.12)' }}>
                  {footer.pages === 'all' ? 'Tout le site' : `${(footer.pages as string[]).length} page(s)`}
                </span>
              </div>
              <FooterPreview f={footer} siteName={siteName} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
