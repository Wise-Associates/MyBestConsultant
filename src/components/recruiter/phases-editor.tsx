'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronUp, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import type { FunnelStage, FunnelStageAutoAction } from '@/types'
import { PHASE_COLORS, STAGE_LIMITS, slugify } from '@/lib/funnel-config'

// Éditeur des phases d'un pipeline (créer, renommer, colorer, ordonner, supprimer, choisir les statuts de chaque phase).
// Composant contrôlé : il ne sauvegarde rien, le parent reçoit la liste à jour et l'enregistre quand il veut.
// Utilisé par la page « Processus de recrutement » ET par la fenêtre « Processus » ouverte depuis une carte du pipeline.

export interface PhaseDraft { slug: string; label: string; color: string; autoAction: FunnelStageAutoAction | ''; statuses: string[] }

export const toPhaseDraft = (s: FunnelStage): PhaseDraft => ({ slug: s.slug, label: s.label, color: s.color, autoAction: s.autoAction ?? '', statuses: s.statuses ?? [] })

const ACTION_LABEL: Record<FunnelStageAutoAction, string> = { screening: 'Screening IA', interview: 'Entretien IA' }
const surface = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' }
const input = { background: 'var(--color-background, #fff)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }
const btnDark = { background: '#1c1c1e', color: 'white' }
const btnSoft = { background: 'rgba(232,163,61,0.14)', color: '#b8862f' }

/** Choix des statuts d'une phase : on active/désactive ceux de la bibliothèque, ou on en ajoute un. */
export function StatusPicker({ value, options, onChange }: { value: string[]; options: string[]; onChange: (v: string[]) => void }) {
  const [custom, setCustom] = useState('')
  const all = useMemo(() => [...new Set([...options, ...value])], [options, value])
  const toggle = (s: string) => onChange(value.includes(s) ? value.filter(v => v !== s) : [...value, s].slice(0, STAGE_LIMITS.statuses))
  const add = () => {
    const s = custom.replace(/\s+/g, ' ').trim().slice(0, STAGE_LIMITS.status)
    if (s && !value.some(v => v.toLowerCase() === s.toLowerCase())) onChange([...value, s].slice(0, STAGE_LIMITS.statuses))
    setCustom('')
  }
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {all.map(s => {
          const on = value.includes(s)
          return (
            <button key={s} type="button" onClick={() => toggle(s)} aria-pressed={on} className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full transition-colors"
              style={on ? { background: 'rgba(232,163,61,0.2)', color: '#8a6a1f', border: '1px solid rgba(232,163,61,0.6)' } : { background: 'transparent', color: 'var(--color-text-muted)', border: '1px dashed var(--color-border)' }}>
              {on && <Check className="h-3 w-3" />}{s}
            </button>
          )
        })}
      </div>
      <div className="flex gap-2 mt-2">
        <input value={custom} onChange={e => setCustom(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} maxLength={STAGE_LIMITS.status}
          placeholder="Autre statut…" className="flex-1 min-w-0 px-3 py-1.5 rounded-lg text-xs outline-none" style={input} />
        <button type="button" onClick={add} disabled={!custom.trim()} className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40" style={btnSoft}>Ajouter</button>
      </div>
    </div>
  )
}

export function PhasesEditor({ rows, onChange, statusLibrary, onError }: {
  rows: PhaseDraft[]; onChange: (rows: PhaseDraft[]) => void; statusLibrary: string[]; onError?: (msg: string) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [newPhase, setNewPhase] = useState<PhaseDraft>({ slug: '', label: '', color: PHASE_COLORS[2], autoAction: '', statuses: [] })
  const statusOptions = useMemo(() => [...new Set([...statusLibrary, ...rows.flatMap(r => r.statuses)])], [statusLibrary, rows])

  const patch = (slug: string, p: Partial<PhaseDraft>) => onChange(rows.map(x => (x.slug === slug ? { ...x, ...p } : x)))
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length || from === to) return
    const n = [...rows]; const [it] = n.splice(from, 1); n.splice(to, 0, it); onChange(n)
  }
  const addPhase = () => {
    const label = newPhase.label.trim()
    if (!label) return
    if (rows.length >= STAGE_LIMITS.stages) { onError?.(`Un pipeline compte ${STAGE_LIMITS.stages} phases au maximum.`); return }
    onChange([...rows, { ...newPhase, label, slug: slugify(label, rows.map(x => x.slug)) }])
    setNewPhase({ slug: '', label: '', color: PHASE_COLORS[(rows.length + 3) % PHASE_COLORS.length], autoAction: '', statuses: [] })
  }

  return (
    <div className="space-y-4">
      {/* Créer une phase */}
      <div className="rounded-3xl p-5" style={{ ...surface, boxShadow: '0 16px 40px -22px rgba(11,29,81,0.18)' }}>
        <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-muted)' }}>Nouvelle phase</p>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-4 items-start">
          <div>
            <label className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Nom de la phase *</label>
            <input value={newPhase.label} onChange={e => setNewPhase(p => ({ ...p, label: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPhase() } }} maxLength={STAGE_LIMITS.label}
              placeholder="ex. Entretien technique" className="w-full mt-1 px-3 py-2.5 rounded-xl text-sm outline-none" style={input} />
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {PHASE_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setNewPhase(p => ({ ...p, color: c }))} aria-label={`Couleur ${c}`} className="w-5 h-5 rounded-full"
                  style={{ background: c, outline: newPhase.color === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }} />
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Statuts possibles dans cette phase</label>
            <div className="mt-1"><StatusPicker value={newPhase.statuses} options={statusLibrary} onChange={v => setNewPhase(p => ({ ...p, statuses: v }))} /></div>
          </div>
          <button type="button" onClick={addPhase} disabled={!newPhase.label.trim()} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 lg:mt-5" style={btnDark}><Plus className="h-4 w-4" />Créer une phase</button>
        </div>
      </div>

      {/* Liste */}
      <div className="space-y-2.5">
        {rows.map((r, i) => {
          const open = editing === r.slug
          return (
            <div key={r.slug} draggable onDragStart={() => setDragFrom(i)} onDragOver={e => e.preventDefault()} onDrop={() => { if (dragFrom !== null) move(dragFrom, i); setDragFrom(null) }} onDragEnd={() => setDragFrom(null)}
              className="rounded-2xl" style={{ ...surface, boxShadow: '0 8px 24px -16px rgba(11,29,81,0.18)', opacity: dragFrom === i ? 0.5 : 1 }}>
              <div className="flex items-center gap-3 px-4 py-3">
                <GripVertical className="h-4 w-4 shrink-0 cursor-grab" style={{ color: 'var(--color-text-muted)' }} aria-hidden />
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: r.color }} />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>{r.label}{r.autoAction && <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full align-middle" style={{ background: 'rgba(139,92,246,0.12)', color: '#7c3aed' }}>{ACTION_LABEL[r.autoAction]}</span>}</p>
                  {r.statuses.length > 0 && <div className="flex flex-wrap gap-1 mt-1.5">{r.statuses.map(s => <span key={s} className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.05)', color: 'var(--color-text-muted)' }}>{s}</span>)}</div>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="Monter" className="p-1.5 rounded-lg disabled:opacity-30" style={{ color: 'var(--color-text-muted)' }}><ChevronUp className="h-4 w-4" /></button>
                  <button type="button" onClick={() => move(i, i + 1)} disabled={i === rows.length - 1} aria-label="Descendre" className="p-1.5 rounded-lg disabled:opacity-30" style={{ color: 'var(--color-text-muted)' }}><ChevronDown className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setEditing(open ? null : r.slug)} aria-label="Modifier" className="p-1.5 rounded-lg" style={{ color: '#6366f1' }}><Pencil className="h-4 w-4" /></button>
                  <button type="button" onClick={() => onChange(rows.filter(x => x.slug !== r.slug))} disabled={rows.length <= 1} aria-label="Supprimer la phase" className="p-1.5 rounded-lg disabled:opacity-30" style={{ color: '#dc2626' }}><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              {open && (
                <div className="px-4 pb-4 pt-1 grid md:grid-cols-2 gap-4" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <div className="space-y-3 pt-3">
                    <div>
                      <label className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Nom</label>
                      <input value={r.label} onChange={e => patch(r.slug, { label: e.target.value })} maxLength={STAGE_LIMITS.label} className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={input} />
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      {PHASE_COLORS.map(c => <button key={c} type="button" onClick={() => patch(r.slug, { color: c })} aria-label={`Couleur ${c}`} className="w-5 h-5 rounded-full" style={{ background: c, outline: r.color === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }} />)}
                    </div>
                    <div>
                      <label className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Action suggérée sur la carte</label>
                      <select value={r.autoAction} onChange={e => patch(r.slug, { autoAction: e.target.value as PhaseDraft['autoAction'] })} className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={input}>
                        <option value="">Aucune</option><option value="screening">Screening IA</option><option value="interview">Entretien IA</option>
                      </select>
                    </div>
                  </div>
                  <div className="pt-3">
                    <label className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Statuts possibles dans cette phase</label>
                    <div className="mt-1"><StatusPicker value={r.statuses} options={statusOptions} onChange={v => patch(r.slug, { statuses: v })} /></div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
