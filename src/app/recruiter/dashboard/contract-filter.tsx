'use client'

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { BriefcaseBusiness, ChevronDown } from 'lucide-react'
import { JOB_CONTRACTS, normalizeContracts, type JobContract } from '@/lib/recruiter-job-filters'

// Filtre « Type de contrat » de « Mes offres » (demande du 2026-11-06 : choix multiple). Appliqué dans le navigateur, à
// chaque case cochée (la liste est déjà lue en entier) ; même bouton que le filtre « Recruteurs », pour que les deux
// aient la même largeur dans le rail.

const LABELS: Record<JobContract, string> = { cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission' }
const muted: CSSProperties = { color: 'var(--color-text-muted)' }
const option = 'flex items-center gap-2.5 min-h-10 px-2.5 rounded-[10px] text-[13px] cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-text)_5%,transparent)]'

export function ContractFilter({ value, onChange }: { value: JobContract[]; onChange: (next: JobContract[]) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const label = value.length === 0 ? 'Tous les contrats' : value.length <= 2 ? value.map(c => LABELS[c]).join(', ') : `${value.length} contrats`

  // Clic ou tabulation hors du panneau : le referme (les choix sont déjà appliqués).
  useEffect(() => {
    if (!open) return
    const onOutside = (e: Event) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('focusin', onOutside)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('focusin', onOutside)
    }
  }, [open])

  const toggle = (c: JobContract) => onChange(normalizeContracts(value.includes(c) ? value.filter(x => x !== c) : [...value, c]))

  return (
    <div ref={rootRef} className="relative"
      onKeyDown={e => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
          triggerRef.current?.focus()
        }
      }}>
      <button ref={triggerRef} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen(o => !o)}
        className="w-full sm:w-auto min-[90rem]:w-full h-11 sm:h-10 px-3 rounded-xl inline-flex items-center gap-2 text-[13px] font-medium cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-text)"
        style={{
          background: value.length ? 'color-mix(in srgb, var(--color-primary) 6%, var(--color-surface))' : 'var(--color-surface)',
          border: `1px solid ${value.length ? 'var(--color-primary)' : 'var(--color-border)'}`,
          color: 'var(--color-text)',
        }}>
        <BriefcaseBusiness aria-hidden className="h-4 w-4 shrink-0" style={muted} />
        <span className="sr-only">Type de contrat : </span>
        <span className="truncate max-w-56 min-[90rem]:max-w-none text-left flex-1">{label}</span>
        <ChevronDown aria-hidden className="h-4 w-4 shrink-0" style={muted} />
      </button>

      {open && (
        <div id={panelId} role="dialog" aria-label="Filtrer par type de contrat"
          className="absolute left-0 right-0 sm:right-auto top-full mt-1 z-20 sm:w-56 min-[90rem]:right-0 min-[90rem]:w-auto p-1.5 rounded-[14px] flex flex-col"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 16px 40px rgba(28,28,30,0.12)' }}>
          <fieldset className="flex flex-col">
            <legend className="px-2.5 pt-1.5 pb-1 text-xs font-semibold" style={muted}>Type de contrat</legend>
            {JOB_CONTRACTS.map((c, i) => (
              <label key={c} className={option} style={{ color: 'var(--color-text)' }}>
                <input type="checkbox" checked={value.includes(c)} onChange={() => toggle(c)} autoFocus={i === 0}
                  className="h-4 w-4 shrink-0 accent-(--color-primary)" />
                <span>{LABELS[c]}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex px-1 pt-2 mt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
            <button type="button" onClick={() => onChange([])} disabled={value.length === 0}
              className="h-9 px-2.5 rounded-[10px] text-[13px] font-semibold cursor-pointer bg-transparent border-0 hover:underline underline-offset-2 disabled:opacity-50 disabled:cursor-default disabled:no-underline focus-visible:outline-2 focus-visible:outline-(--color-text)"
              style={{ color: 'var(--color-text)' }}>
              Tous les contrats
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
