'use client'

import { useState, useTransition, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Loader2, Check, Palette, Layout, Type, Sliders,
  ChevronDown, RotateCcw, Eye, AlertCircle, ExternalLink,
} from 'lucide-react'
import { updateTemplate, updateCustomColors } from './actions'
import type { Template, TemplateVars } from '@/lib/templates'
import { GOOGLE_FONTS, templateVarsToCss } from '@/lib/templates'

// ── Groupes de couleurs ──────────────────────────────────────────
const COLOR_GROUPS: { title: string; fields: { key: keyof TemplateVars; label: string }[] }[] = [
  {
    title: 'Marque',
    fields: [
      { key: 'colorPrimary', label: 'Couleur primaire' },
      { key: 'colorPrimaryFg', label: 'Texte sur primaire' },
      { key: 'colorSecondary', label: 'Couleur secondaire' },
      { key: 'colorAccent', label: 'Accent' },
    ],
  },
  {
    title: 'Interface',
    fields: [
      { key: 'colorBackground', label: 'Fond de page' },
      { key: 'colorSurface', label: 'Surface (cartes)' },
      { key: 'colorBorder', label: 'Bordures' },
      { key: 'colorText', label: 'Texte principal' },
      { key: 'colorTextMuted', label: 'Texte secondaire' },
    ],
  },
  {
    title: 'Navigation & Hero',
    fields: [
      { key: 'navbarBg', label: 'Fond navbar' },
      { key: 'navbarText', label: 'Texte navbar' },
      { key: 'heroBg', label: 'Fond hero' },
      { key: 'heroText', label: 'Texte hero' },
    ],
  },
]

const FONT_WEIGHT_OPTIONS = [
  { label: 'Thin (100)', value: '100' },
  { label: 'Light (300)', value: '300' },
  { label: 'Regular (400)', value: '400' },
  { label: 'Medium (500)', value: '500' },
  { label: 'SemiBold (600)', value: '600' },
  { label: 'Bold (700)', value: '700' },
  { label: 'ExtraBold (800)', value: '800' },
  { label: 'Black (900)', value: '900' },
]

const FONT_SIZE_PRESETS: { label: string; key: keyof TemplateVars; placeholder: string }[] = [
  { label: 'Titre H1', key: 'fontSizeH1', placeholder: 'clamp(2.4rem, 5vw, 4rem)' },
  { label: 'Titre H2', key: 'fontSizeH2', placeholder: '2rem' },
  { label: 'Titre H3', key: 'fontSizeH3', placeholder: '1.25rem' },
  { label: 'Corps de texte', key: 'fontSizeBase', placeholder: '16px' },
  { label: 'Petit texte', key: 'fontSizeSmall', placeholder: '0.875rem' },
]

const LETTER_SPACING_OPTIONS = [
  { label: 'Serré (-0.05em)', value: '-0.05em' },
  { label: 'Tight (-0.025em)', value: '-0.025em' },
  { label: 'Normal (0em)', value: '0em' },
  { label: 'Large (0.025em)', value: '0.025em' },
  { label: 'Wide (0.05em)', value: '0.05em' },
  { label: 'Espacé (0.1em)', value: '0.1em' },
]

const LINE_HEIGHT_OPTIONS = [
  { label: 'Compact (1.3)', value: '1.3' },
  { label: 'Normal (1.5)', value: '1.5' },
  { label: 'Confortable (1.65)', value: '1.65' },
  { label: 'Spacieux (1.8)', value: '1.8' },
  { label: 'Large (2)', value: '2' },
]

const RADIUS_PRESETS = [
  { label: 'Carré', small: '0px', large: '0px' },
  { label: 'Léger', small: '4px', large: '8px' },
  { label: 'Normal', small: '8px', large: '16px' },
  { label: 'Arrondi', small: '12px', large: '24px' },
  { label: 'Pill', small: '9999px', large: '9999px' },
]

const SHADOW_PRESETS = [
  { label: 'Aucun', card: 'none', button: 'none' },
  { label: 'Hairline', card: '0 0 0 1px rgba(0,0,0,0.08)', button: 'none' },
  { label: 'Subtil', card: '0 1px 4px rgba(0,0,0,0.08)', button: 'none' },
  { label: 'Doux', card: '0 4px 16px rgba(0,0,0,0.1)', button: '0 2px 8px rgba(0,0,0,0.15)' },
  { label: 'Marqué', card: '0 8px 32px rgba(0,0,0,0.15)', button: '0 4px 14px rgba(0,0,0,0.25)' },
]

interface Props {
  templates: Template[]
  currentTemplateId: string
  customColors: Partial<TemplateVars>
}

type Tab = 'templates' | 'colors' | 'typography' | 'style'

function SelectField({ label, value, options, onChange }: {
  label: string; value: string
  options: { label: string; value: string }[]; onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-white/50 uppercase tracking-wider">{label}</Label>
      <div className="relative">
        <select value={value} onChange={e => onChange(e.target.value)}
          className="w-full appearance-none bg-white/[0.05] border border-white/[0.1] text-white/80 text-sm rounded-lg px-3 py-2.5 pr-8 focus:outline-none focus:border-white/30 transition-colors">
          {options.map(o => (
            <option key={o.value} value={o.value} className="bg-[#1a1a2e] text-white">{o.label}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 pointer-events-none" />
      </div>
    </div>
  )
}

export function DesignManager({ templates, currentTemplateId, customColors }: Props) {
  const [tab, setTab] = useState<Tab>('templates')
  const [selectedId, setSelectedId] = useState(currentTemplateId)
  const [vars, setVars] = useState<Partial<TemplateVars>>(customColors)
  const [isPending, startTransition] = useTransition()
  const [saveStatus, setSaveStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const selectedTemplate = templates.find(t => t.id === selectedId) ?? templates[0]
  const merged: TemplateVars = { ...selectedTemplate.vars, ...vars }

  // ── Live CSS preview : injecte les vars dans le DOM immédiatement ──
  useEffect(() => {
    const cssVars = templateVarsToCss(merged)
    let style = document.getElementById('mbc-live-preview') as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = 'mbc-live-preview'
      document.head.appendChild(style)
    }
    style.textContent = `:root { ${cssVars} }`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vars, selectedId])

  function setVar<K extends keyof TemplateVars>(key: K, value: string) {
    setVars(prev => ({ ...prev, [key]: value }))
  }

  function applyTemplate(id: string) {
    setSelectedId(id)
    setVars({})
  }

  async function save() {
    setSaveStatus('idle')
    setErrorMsg('')
    startTransition(async () => {
      const r1 = await updateTemplate(selectedId)
      if ('error' in r1) { setSaveStatus('error'); setErrorMsg(r1.error); return }
      const r2 = await updateCustomColors(vars as Record<string, string>)
      if ('error' in r2) { setSaveStatus('error'); setErrorMsg(r2.error); return }
      setSaveStatus('ok')
      setTimeout(() => setSaveStatus('idle'), 4000)
    })
  }

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'templates', label: 'Templates', icon: Layout },
    { id: 'colors', label: 'Couleurs', icon: Palette },
    { id: 'typography', label: 'Typographie', icon: Type },
    { id: 'style', label: 'Style', icon: Sliders },
  ]

  return (
    <div className="min-h-full bg-[#0A0C10] text-white">

      {/* ── PAGE HEADER ─────────────────────────────────────── */}
      <div className="border-b border-white/[0.07] px-8 py-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Design & Apparence</h1>
          <p className="text-sm text-white/40 mt-1">
            Couleurs, typographie et style. Les changements s&apos;appliquent en <span className="text-white/60 font-medium">temps réel</span> — sauvegardez pour les rendre permanents sur le site public.
          </p>
        </div>
        <a href="/" target="_blank"
          className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-xs text-white/50 hover:text-white transition-all">
          <ExternalLink className="h-3.5 w-3.5" />
          Voir le site
        </a>
      </div>

      {/* ── ERROR BANNER ────────────────────────────────────── */}
      {saveStatus === 'error' && (
        <div className="mx-8 mt-4 flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>Erreur : {errorMsg}</span>
        </div>
      )}

      <div className="flex flex-col lg:flex-row">

        {/* ── LEFT PANEL ──────────────────────────────────────── */}
        <div className="flex-1 px-8 py-6">

          {/* Tab bar */}
          <div className="flex gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.07] mb-8 w-fit">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === t.id ? 'bg-white text-black shadow-sm' : 'text-white/50 hover:text-white/80'
                }`}>
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            ))}
          </div>

          {/* ── TEMPLATES ──────────────────────────────────────── */}
          {tab === 'templates' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {templates.map(tpl => {
                  const isActive = tpl.id === selectedId
                  return (
                    <button key={tpl.id} onClick={() => applyTemplate(tpl.id)}
                      className={`text-left rounded-xl overflow-hidden border transition-all hover:scale-[1.02] ${
                        isActive ? 'border-white/40 ring-2 ring-white/20' : 'border-white/[0.07] hover:border-white/20'
                      }`}>
                      <div className="h-32 relative" style={{ background: tpl.vars.heroBg }}>
                        <div className="absolute top-0 inset-x-0 h-7 flex items-center px-3 gap-2" style={{ background: tpl.vars.navbarBg }}>
                          <div className="w-3 h-3 rounded-sm" style={{ background: tpl.vars.colorPrimary }} />
                          <div className="h-1.5 w-12 rounded-full opacity-50" style={{ background: tpl.vars.navbarText }} />
                          <div className="ml-auto h-5 w-12 rounded-md" style={{ background: tpl.vars.colorPrimary }} />
                        </div>
                        <div className="absolute inset-x-3 bottom-3 space-y-1.5">
                          <div className="h-3 w-2/3 rounded-full opacity-90" style={{ background: tpl.vars.heroText }} />
                          <div className="h-2 w-1/2 rounded-full opacity-50" style={{ background: tpl.vars.heroText }} />
                          <div className="flex gap-1.5 mt-2">
                            <div className="h-5 w-16 rounded-md" style={{ background: tpl.vars.colorPrimary }} />
                            <div className="h-5 w-12 rounded-md border opacity-60" style={{ borderColor: tpl.vars.heroText }} />
                          </div>
                        </div>
                        {isActive && (
                          <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white flex items-center justify-center">
                            <Check className="h-3.5 w-3.5 text-black" />
                          </div>
                        )}
                        <div className="absolute top-10 right-3 flex flex-col gap-1">
                          {[tpl.vars.colorPrimary, tpl.vars.colorAccent, tpl.vars.colorText].map((c, i) => (
                            <div key={i} className="w-3 h-3 rounded-full border border-white/20" style={{ background: c }} />
                          ))}
                        </div>
                      </div>
                      <div className="px-4 py-3" style={{ background: tpl.vars.colorSurface }}>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-sm" style={{ color: tpl.vars.colorText }}>{tpl.preview} {tpl.name}</p>
                            <p className="text-xs mt-0.5" style={{ color: tpl.vars.colorTextMuted }}>{tpl.description}</p>
                          </div>
                          {isActive && <span className="text-xs px-2 py-0.5 rounded-full bg-black text-white font-medium">Actif</span>}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-white/25 pt-2">
                Chaque template est un point de départ — personnalisez ensuite les couleurs, la typographie et le style dans les onglets suivants.
              </p>
            </div>
          )}

          {/* ── COULEURS ───────────────────────────────────────── */}
          {tab === 'colors' && (
            <div className="space-y-8">
              {COLOR_GROUPS.map(group => (
                <div key={group.title}>
                  <h3 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">{group.title}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {group.fields.map(f => (
                      <div key={f.key} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.07] hover:border-white/[0.12] transition-colors">
                        <div className="relative shrink-0">
                          <input type="color" value={(merged[f.key] as string) ?? '#000000'}
                            onChange={e => setVar(f.key, e.target.value)}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer rounded-lg" />
                          <div className="w-10 h-10 rounded-lg border border-white/10 shadow-inner cursor-pointer"
                            style={{ background: (merged[f.key] as string) ?? '#000000' }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white/70">{f.label}</p>
                          <p className="text-xs font-mono text-white/30 truncate">{(merged[f.key] as string) ?? ''}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <button onClick={() => setVars(prev => {
                const next = { ...prev }
                COLOR_GROUPS.flatMap(g => g.fields).forEach(f => delete next[f.key as keyof TemplateVars])
                return next
              })} className="flex items-center gap-2 text-xs text-white/30 hover:text-white/60 transition-colors">
                <RotateCcw className="h-3.5 w-3.5" />
                Réinitialiser aux couleurs du template
              </button>
            </div>
          )}

          {/* ── TYPOGRAPHIE ────────────────────────────────────── */}
          {tab === 'typography' && (
            <div className="space-y-10">
              {/* Familles */}
              <div>
                <h3 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">Familles de polices</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {(['fontHeading', 'fontBody'] as const).map(key => (
                    <div key={key} className="space-y-2">
                      <Label className="text-xs text-white/50 uppercase tracking-wider">
                        {key === 'fontHeading' ? 'Police titres (H1, H2, H3)' : 'Police corps de texte'}
                      </Label>
                      <div className="relative">
                        <select value={merged[key]} onChange={e => setVar(key, e.target.value)}
                          className="w-full appearance-none bg-white/[0.05] border border-white/[0.1] text-white/80 text-sm rounded-lg px-3 py-2.5 pr-8 focus:outline-none focus:border-white/30">
                          {GOOGLE_FONTS.map(f => (
                            <option key={f.value} value={f.value} className="bg-[#1a1a2e] text-white">{f.label}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 pointer-events-none" />
                      </div>
                      {/* Live preview du texte avec la police sélectionnée */}
                      <p className="text-lg text-white/50 mt-1 truncate"
                        style={{ fontFamily: merged[key], fontWeight: key === 'fontHeading' ? Number(merged.fontWeightHeading) : 400 }}>
                        {GOOGLE_FONTS.find(f => f.value === merged[key])?.label ?? 'Custom'} — Aa Bb Cc 1 2 3
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tailles */}
              <div>
                <h3 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">Tailles de texte</h3>
                <div className="space-y-2">
                  {FONT_SIZE_PRESETS.map(f => (
                    <div key={f.key} className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.07]">
                      <span className="text-xs text-white/40 w-36 shrink-0">{f.label}</span>
                      <input type="text" value={(merged[f.key] as string) ?? ''} onChange={e => setVar(f.key, e.target.value)}
                        placeholder={f.placeholder}
                        className="flex-1 bg-transparent border-b border-white/[0.1] text-sm text-white/70 focus:outline-none focus:border-white/40 font-mono py-0.5" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Poids, hauteur de ligne, espacement */}
              <div>
                <h3 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">Poids & espacement</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <SelectField label="Poids titres" value={merged.fontWeightHeading} options={FONT_WEIGHT_OPTIONS} onChange={v => setVar('fontWeightHeading', v)} />
                  <SelectField label="Poids corps" value={merged.fontWeightBody} options={FONT_WEIGHT_OPTIONS} onChange={v => setVar('fontWeightBody', v)} />
                  <SelectField label="Hauteur de ligne" value={merged.lineHeight} options={LINE_HEIGHT_OPTIONS} onChange={v => setVar('lineHeight', v)} />
                  <SelectField label="Letter-spacing titres" value={merged.letterSpacingHeading} options={LETTER_SPACING_OPTIONS} onChange={v => setVar('letterSpacingHeading', v)} />
                  <SelectField label="Letter-spacing corps" value={merged.letterSpacingBody} options={LETTER_SPACING_OPTIONS} onChange={v => setVar('letterSpacingBody', v)} />
                </div>
              </div>

              {/* Aperçu live */}
              <div className="p-6 rounded-xl border border-white/[0.07] bg-white/[0.02] space-y-4">
                <p className="text-xs text-white/30 uppercase tracking-widest">Aperçu live</p>
                <div style={{ fontFamily: merged.fontHeading, fontSize: '2.2rem', fontWeight: merged.fontWeightHeading, letterSpacing: merged.letterSpacingHeading, color: 'rgba(255,255,255,0.85)', lineHeight: 1.15 }}>
                  Trouvez votre prochaine mission
                </div>
                <div style={{ fontFamily: merged.fontBody, fontSize: merged.fontSizeBase, fontWeight: merged.fontWeightBody, letterSpacing: merged.letterSpacingBody, lineHeight: merged.lineHeight, color: 'rgba(255,255,255,0.4)' }}>
                  MyBestConsultant connecte les meilleurs consultants aux entreprises qui ont besoin de leur expertise stratégique et opérationnelle.
                </div>
              </div>
            </div>
          )}

          {/* ── STYLE ──────────────────────────────────────────── */}
          {tab === 'style' && (
            <div className="space-y-10">
              {/* Arrondi */}
              <div>
                <h3 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">Arrondi des coins</h3>
                <div className="grid grid-cols-5 gap-3 mb-3">
                  {RADIUS_PRESETS.map(r => {
                    const isActive = merged.borderRadius === r.small
                    return (
                      <button key={r.label} onClick={() => { setVar('borderRadius', r.small); setVar('borderRadiusLg', r.large) }}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${isActive ? 'border-white/40 bg-white/[0.08]' : 'border-white/[0.07] bg-white/[0.03] hover:border-white/20'}`}>
                        <div className="w-10 h-10 border-2 border-white/40 bg-white/10" style={{ borderRadius: r.small === '9999px' ? '9999px' : r.small }} />
                        <span className="text-xs text-white/50">{r.label}</span>
                        {isActive && <Check className="h-3 w-3 text-white" />}
                      </button>
                    )
                  })}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(['borderRadius', 'borderRadiusLg'] as const).map((k, i) => (
                    <div key={k} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.07]">
                      <span className="text-xs text-white/40 w-32 shrink-0">{i === 0 ? 'Petit (btn, input)' : 'Grand (cartes, modal)'}</span>
                      <input type="text" value={merged[k]} onChange={e => setVar(k, e.target.value)}
                        className="flex-1 bg-transparent border-b border-white/[0.1] text-sm text-white/70 font-mono focus:outline-none focus:border-white/40" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Ombres */}
              <div>
                <h3 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">Ombres portées</h3>
                <div className="grid grid-cols-5 gap-3 mb-3">
                  {SHADOW_PRESETS.map(s => {
                    const isActive = merged.shadowCard === s.card
                    return (
                      <button key={s.label} onClick={() => { setVar('shadowCard', s.card); setVar('shadowButton', s.button) }}
                        className={`flex flex-col items-center gap-3 p-4 rounded-xl border transition-all ${isActive ? 'border-white/40 bg-white/[0.08]' : 'border-white/[0.07] bg-white/[0.03] hover:border-white/20'}`}>
                        <div className="w-12 h-12 rounded-lg bg-white/20" style={{ boxShadow: s.card !== 'none' ? '0 4px 12px rgba(255,255,255,0.15)' : 'none' }} />
                        <span className="text-xs text-white/50">{s.label}</span>
                        {isActive && <Check className="h-3 w-3 text-white" />}
                      </button>
                    )
                  })}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(['shadowCard', 'shadowButton'] as const).map((k, i) => (
                    <div key={k} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.07]">
                      <span className="text-xs text-white/40 w-24 shrink-0">{i === 0 ? 'Ombre carte' : 'Ombre bouton'}</span>
                      <input type="text" value={merged[k]} onChange={e => setVar(k, e.target.value)}
                        className="flex-1 bg-transparent border-b border-white/[0.1] text-xs text-white/70 font-mono focus:outline-none focus:border-white/40" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* ── RIGHT PANEL ─────────────────────────────────────── */}
        <div className="w-full lg:w-72 shrink-0 border-t lg:border-t-0 lg:border-l border-white/[0.07] flex flex-col sticky top-0 h-fit">

          {/* Bouton Save */}
          <div className="p-5 border-b border-white/[0.07]">
            <Button onClick={save} disabled={isPending}
              className={`w-full gap-2 font-semibold transition-colors ${
                saveStatus === 'ok' ? 'bg-emerald-500 hover:bg-emerald-400 text-white' :
                saveStatus === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                'bg-white text-black hover:bg-white/90'
              }`}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> :
               saveStatus === 'ok' ? <Check className="h-4 w-4" /> :
               saveStatus === 'error' ? <AlertCircle className="h-4 w-4" /> : null}
              {isPending ? 'Sauvegarde...' :
               saveStatus === 'ok' ? 'Sauvegarde OK !' :
               saveStatus === 'error' ? 'Erreur — voir ci-dessus' :
               'Appliquer sur le site'}
            </Button>
            {saveStatus === 'ok' && (
              <p className="text-xs text-emerald-400/70 text-center mt-2">
                Rechargez le site public pour voir les changements
              </p>
            )}
            <p className="text-xs text-white/20 text-center mt-2">
              Les aperçus ci-contre changent en <em>temps réel</em>
            </p>
          </div>

          {/* État actuel */}
          <div className="p-5 space-y-5">
            <div>
              <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Template actif</p>
              <p className="text-sm font-medium text-white/70">{selectedTemplate.preview} {selectedTemplate.name}</p>
              {Object.keys(vars).length > 0 && (
                <p className="text-xs text-white/30 mt-0.5">{Object.keys(vars).length} personnalisation(s)</p>
              )}
            </div>

            {/* Swatches couleurs */}
            <div>
              <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Couleurs actives</p>
              <div className="space-y-2">
                {[
                  { label: 'Primaire', key: 'colorPrimary' },
                  { label: 'Fond', key: 'colorBackground' },
                  { label: 'Texte', key: 'colorText' },
                  { label: 'Hero', key: 'heroBg' },
                ].map(({ label, key }) => (
                  <div key={key} className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded border border-white/10 shrink-0" style={{ background: merged[key as keyof TemplateVars] as string }} />
                    <span className="text-xs text-white/40 flex-1">{label}</span>
                    <span className="text-xs font-mono text-white/20">{merged[key as keyof TemplateVars] as string}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Typo */}
            <div className="border-t border-white/[0.07] pt-4 space-y-2">
              <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-2">Typographie</p>
              <div style={{ fontFamily: merged.fontHeading, fontWeight: Number(merged.fontWeightHeading), color: 'rgba(255,255,255,0.6)', fontSize: '1rem' }}>
                Titre — {GOOGLE_FONTS.find(f => f.value === merged.fontHeading)?.label ?? 'Custom'}
              </div>
              <div style={{ fontFamily: merged.fontBody, color: 'rgba(255,255,255,0.35)', fontSize: '0.875rem' }}>
                Corps — {GOOGLE_FONTS.find(f => f.value === merged.fontBody)?.label ?? 'Custom'}
              </div>
            </div>

            {/* Lien */}
            <div className="border-t border-white/[0.07] pt-4">
              <a href="/" target="_blank" className="flex items-center gap-2 text-xs text-white/30 hover:text-white/60 transition-colors">
                <Eye className="h-3.5 w-3.5" />
                Ouvrir le site public
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
