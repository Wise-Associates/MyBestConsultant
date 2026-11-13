'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PERIOD_PRESETS, type PeriodPreset, type StatsPeriod } from '@/lib/ao/stats-filters'
import { BRAND, control } from '@/app/admin/candidats/labels'

// Filtres de /admin/candidats/statistiques (demande du 2026-11-13) : période (raccourcis glissants ou dates) et sites
// sources (« Tout sélectionner »). Formulaire GET : chaque choix dans l'adresse, lu par `statsFiltersFromParams`
// (src/lib/ao/stats-filters.ts) ; toute la page suit. Tous les sites cochés : aucun `site` envoyé (= tous).

export interface SiteOption {
  id: string
  label: string
  /** Offres AO reçues de ce site sur la période ; null : offres illisibles. */
  count: number | null
}

const card = { background: 'var(--admin-panel)', border: '1px solid var(--admin-line)' } as const
const muted = { color: 'var(--admin-fg-muted)' } as const
const heading = 'text-xs font-semibold'
const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316]'

interface Props {
  period: StatsPeriod
  preset: PeriodPreset | null
  groups: { label: string; sites: SiteOption[] }[]
  /** Sites retenus par la page (tous si aucun n'est demandé). */
  selected: string[]
}

export function StatsFilters({ period, preset, groups, selected }: Props) {
  const pathname = usePathname()
  const allIds = groups.flatMap(g => g.sites.map(s => s.id))
  const [checked, setChecked] = useState(() => new Set(selected))
  const [submitting, setSubmitting] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const presetRef = useRef<HTMLInputElement>(null)
  const allRef = useRef<HTMLInputElement>(null)
  const allChecked = checked.size === allIds.length
  const none = checked.size === 0

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = !allChecked && !none
  }, [allChecked, none])

  // Page revenue par « Précédent » (cache du navigateur) : le formulaire n'est plus en cours d'envoi.
  useEffect(() => {
    const reset = () => setSubmitting(false)
    window.addEventListener('pageshow', reset)
    return () => window.removeEventListener('pageshow', reset)
  }, [])

  const toggle = (id: string) => setChecked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  // Un raccourci s'applique tout de suite, avec les sites cochés ; des dates saisies attendent « Appliquer ».
  const applyPreset = (value: PeriodPreset) => {
    if (!presetRef.current || !formRef.current) return
    presetRef.current.value = value
    formRef.current.requestSubmit()
  }
  const datesEdited = () => {
    if (presetRef.current) presetRef.current.value = ''
  }
  // Sans filtre dans l'adresse, le lien mène à la même page et ne remonte pas le formulaire : il est remis ici à l'état
  // de l'adresse (dates, raccourci, cases). Avec des filtres, la page sans filtre le remplace ensuite.
  const reset = () => {
    formRef.current?.reset()
    setChecked(new Set(selected))
  }

  return (
    <form ref={formRef} method="get" onSubmit={() => setSubmitting(true)} aria-label="Filtres des statistiques"
      className="rounded-2xl p-4 sm:p-5 space-y-5" style={card}>
      <input ref={presetRef} type="hidden" name="periode" defaultValue={preset ?? ''} />

      <div className="space-y-2">
        <p className={heading} style={{ color: 'var(--admin-fg)' }} id="stats-period">Période</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3" role="group" aria-labelledby="stats-period">
          <div className="inline-flex items-stretch h-[38px] rounded-[10px] border border-admin-line-strong overflow-hidden">
            {PERIOD_PRESETS.map((p, i) => {
              const active = preset === p.value
              return (
                <button key={p.value} type="button" aria-pressed={active} disabled={none} onClick={() => applyPreset(p.value)}
                  className={`px-3.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focusRing} focus-visible:ring-inset ${i ? 'border-l border-admin-line' : ''} ${active ? 'bg-admin-fg text-white' : 'bg-admin-panel text-admin-fg enabled:hover:bg-admin-hover'}`}>
                  {p.label}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[13px]" style={muted}>
            <label htmlFor="stats-from">Du</label>
            <input id="stats-from" type="date" name="du" defaultValue={period.from} onChange={datesEdited} style={{ ...control, colorScheme: 'light' }} />
            <label htmlFor="stats-to">au</label>
            <input id="stats-to" type="date" name="au" defaultValue={period.to} onChange={datesEdited} style={{ ...control, colorScheme: 'light' }} />
          </div>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="flex flex-wrap items-center gap-x-4 gap-y-1 w-full">
          <span className={heading} style={{ color: 'var(--admin-fg)' }}>Sites sources</span>
          <label className="inline-flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: 'var(--admin-fg)' }}>
            <input ref={allRef} type="checkbox" checked={allChecked} className="h-4 w-4 cursor-pointer" style={{ accentColor: BRAND }}
              onChange={() => setChecked(allChecked ? new Set() : new Set(allIds))} />
            Tout sélectionner
            <span style={muted}>({checked.size} sur {allIds.length})</span>
          </label>
        </legend>
        <div className="space-y-3">
          {groups.map(group => (
            <div key={group.label} className="sm:flex sm:items-start sm:gap-4">
              <p className="text-xs sm:w-32 sm:shrink-0 sm:pt-2.5 mb-1.5 sm:mb-0" style={muted}>{group.label}</p>
              <ul className="flex flex-wrap gap-2">
                {group.sites.map(site => {
                  const on = checked.has(site.id)
                  return (
                    <li key={site.id}>
                      <label className="inline-flex items-center gap-2 min-h-9 px-3 py-1.5 rounded-[10px] text-[13px] cursor-pointer transition-colors"
                        style={{ border: `1px solid ${on ? 'var(--admin-line-strong)' : 'var(--admin-line)'}`, background: on ? 'var(--admin-panel-raised)' : 'var(--admin-panel)', color: on ? 'var(--admin-fg)' : 'var(--admin-fg-muted)' }}>
                        <input type="checkbox" name={allChecked ? undefined : 'site'} value={site.id} checked={on} onChange={() => toggle(site.id)}
                          className="h-4 w-4 cursor-pointer" style={{ accentColor: BRAND }} />
                        <span>{site.label}</span>
                        {site.count !== null && (
                          <span className="text-xs tabular-nums" style={muted}>{site.count}<span className="sr-only"> offre{site.count > 1 ? 's' : ''} sur la période</span></span>
                        )}
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-end gap-3 pt-1" style={{ borderTop: '1px solid var(--admin-line)' }}>
        {none && <p role="alert" className="text-[13px] mr-auto pt-3" style={{ color: '#b91c1c' }}>Sélectionnez au moins un site source.</p>}
        <Link href={pathname} onClick={reset} className={`mt-3 text-[13px] underline ${focusRing}`} style={muted}>Réinitialiser</Link>
        <button type="submit" disabled={none || submitting} aria-busy={submitting}
          className={`mt-3 inline-flex items-center h-10 px-4 rounded-[10px] bg-[#F97316] text-[13px] font-semibold text-admin-fg transition-colors enabled:hover:bg-[#FB923C] disabled:cursor-not-allowed disabled:opacity-50 ${focusRing} focus-visible:ring-offset-2`}>
          {submitting ? 'Chargement…' : 'Appliquer'}
        </button>
      </div>
    </form>
  )
}
