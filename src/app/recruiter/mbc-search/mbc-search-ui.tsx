'use client'

import { useState } from 'react'
import { AlertCircle, Plus, Star, X } from 'lucide-react'
import { CRITERIA_LIMITS, type MbcRevealed } from '@/lib/mbc-search/rules'

// Petits éléments partagés par les écrans de MBC Search (couleurs du thème du site seulement).

export const surface = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' } as const
export const orangeTint = (pct: number) => `color-mix(in srgb, var(--color-brand-orange) ${pct}%, transparent)`

/** État du profil complet d'une ligne : en cours, révélé, ou introuvable chez Apollo. */
export type Reveal = { state: 'loading' } | { state: 'done'; profile: MbcRevealed } | { state: 'missing' }

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-2xl p-4 text-sm"
      style={{ ...surface, borderColor: 'var(--color-brand-orange)', color: 'var(--color-text)' }}>
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'var(--color-brand-orange)' }} />
      {children}
    </p>
  )
}

const initials = (name: string) => name.split(/\s+/).filter(w => /^\p{L}/u.test(w)).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'

/** Photo du profil révélé, sinon ses initiales. */
export function Avatar({ name, photoUrl, size = 40 }: { name: string; photoUrl?: string; size?: number }) {
  if (photoUrl) {
    // Photo servie par Apollo depuis des hôtes variés : <img> simple, sans passer par l'optimiseur de Next.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photoUrl} alt="" referrerPolicy="no-referrer" className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />
  }
  return (
    <span aria-hidden className="rounded-full shrink-0 inline-flex items-center justify-center font-bold"
      style={{ width: size, height: size, fontSize: size * 0.34, background: orangeTint(14), color: 'var(--color-text)' }}>
      {initials(name)}
    </span>
  )
}

/**
 * Valeurs d'un critère en puces, avec un champ pour en ajouter (Entrée ou +). `starred` : puces marquables
 * (compétences obligatoires), un clic sur l'étoile bascule.
 */
export function ChipField({ id, label, hint, placeholder, values, onChange, starred, onStar }: {
  id: string; label: string; hint?: string; placeholder: string; values: string[]; onChange: (v: string[]) => void
  starred?: string[]; onStar?: (v: string) => void
}) {
  const [draft, setDraft] = useState('')
  const full = values.length >= CRITERIA_LIMITS.items
  const add = () => {
    const v = draft.trim().slice(0, CRITERIA_LIMITS.item)
    if (!v || full || values.some(x => x.toLowerCase() === v.toLowerCase())) return
    onChange([...values, v])
    setDraft('')
  }
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <label htmlFor={id} className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>{label}</label>
        {hint && <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{hint}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map(v => {
          const on = starred?.some(s => s.toLowerCase() === v.toLowerCase()) ?? false
          return (
            <span key={v} className="inline-flex items-center gap-0.5 pl-1 pr-1 py-0.5 rounded-full text-xs font-semibold"
              style={on ? { background: orangeTint(12), border: '1px solid var(--color-brand-orange)', color: 'var(--color-text)' }
                : { ...surface, color: 'var(--color-text)' }}>
              {onStar ? (
                <button type="button" onClick={() => onStar(v)} aria-pressed={on} aria-label={on ? `${v} : obligatoire (cliquer pour rendre facultative)` : `${v} : facultative (cliquer pour rendre obligatoire)`}
                  className="rounded-full p-1 hover:opacity-70" style={{ color: on ? 'var(--color-brand-orange)' : 'var(--color-text-muted)' }}>
                  <Star className="h-3 w-3" fill={on ? 'currentColor' : 'none'} />
                </button>
              ) : <span className="w-1.5" />}
              {v}
              <button type="button" onClick={() => onChange(values.filter(x => x !== v))} aria-label={`Retirer ${v}`}
                className="rounded-full p-1 hover:opacity-70 focus-visible:outline-2" style={{ color: 'var(--color-text-muted)' }}>
                <X className="h-3 w-3" />
              </button>
            </span>
          )
        })}
      </div>
      <div className="mt-1.5 flex items-center gap-1 rounded-lg px-2" style={surface}>
        <input id={id} value={draft} onChange={e => setDraft(e.target.value)} onBlur={add} disabled={full} maxLength={CRITERIA_LIMITS.item}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={full ? `${CRITERIA_LIMITS.items} au plus` : placeholder}
          className="flex-1 min-w-0 bg-transparent py-1.5 text-sm outline-none" style={{ color: 'var(--color-text)' }} />
        {draft.trim() && (
          <button type="button" onClick={add} aria-label={`Ajouter à ${label}`} className="rounded p-0.5" style={{ color: 'var(--color-text)' }}>
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}

/** Interrupteur libellé (filtres de la recherche). */
export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only peer" />
      <span aria-hidden className="relative w-8 h-[18px] rounded-full shrink-0 transition-colors peer-focus-visible:outline peer-focus-visible:outline-2"
        style={{ background: checked ? 'var(--color-brand-orange)' : 'var(--color-border)' }}>
        <span className="absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all" style={{ left: checked ? 16 : 2 }} />
      </span>
    </label>
  )
}
