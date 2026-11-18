'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { ExternalLink, Loader2, Mail, MailX, Pause, Play, Trash2 } from 'lucide-react'
import { filtersSummary, withFilters } from '@/lib/cvtheque-search'
import type { SavedSearch } from '@/lib/saved-searches'
import { formatDateFr } from '@/lib/format-date'
import { deleteSavedSearchAction, setSavedSearchFlagsAction } from '../cvtheque/saved-search-actions'

// Recherches enregistrées du recruteur (ADR 0046), sur la page « Alertes » : nom, critères, candidats qui y répondent
// aujourd'hui, nouvelles correspondances, dates, état ; ouvrir (la CV Thèque avec ses filtres, pour la modifier aussi),
// activer ou désactiver, couper les e-mails, supprimer. Chiffres calculés par la page, sur le serveur.

export interface SavedSearchRow {
  search: SavedSearch
  /** null : chiffres illisibles (journalisé par la page). */
  matching: number | null
  newMatches: number | null
}

const surface = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' } as const
const muted = { color: 'var(--color-text-muted)' } as const
const action = 'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40'

/** Adresse de la CV Thèque avec la recherche et ses filtres. */
const openHref = (s: SavedSearch) => `/recruiter/cvtheque?${withFilters(new URLSearchParams({ recherche: s.id }), s.filters).toString()}`

export function SavedSearchesList({ rows }: { rows: SavedSearchRow[] }) {
  const [list, setList] = useState(rows)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function run(id: string, task: () => Promise<{ error?: string; search?: SavedSearch }>, onDone: (search?: SavedSearch) => void) {
    setError(null)
    setBusy(id)
    startTransition(async () => {
      const res = await task()
      setBusy(null)
      if (res.error) setError(res.error)
      else onDone(res.search)
    })
  }
  const replace = (search?: SavedSearch) => { if (search) setList(l => l.map(r => (r.search.id === search.id ? { ...r, search } : r))) }

  if (list.length === 0) {
    return (
      <p className="rounded-2xl p-5 text-sm" style={{ ...surface, ...muted }}>
        Aucune recherche enregistrée. Dans la CV Thèque, réglez vos filtres puis cliquez sur « Enregistrer la recherche » : chaque nouveau candidat
        qui y répond vous sera signalé ici, et par e-mail si vous le souhaitez.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="text-sm rounded-xl px-3 py-2" style={{ background: 'rgba(239,68,68,0.06)', color: '#b91c1c' }}>{error}</p>}
      <ul className="space-y-3">
        {list.map(({ search: s, matching, newMatches }) => {
          const criteria = filtersSummary(s.filters)
          const pending = busy === s.id
          return (
            <li key={s.id} className="rounded-2xl p-4 sm:p-5" style={{ ...surface, opacity: s.active ? 1 : 0.75 }}>
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={openHref(s)} className="font-semibold no-underline hover:underline" style={{ color: 'var(--color-text)' }}>{s.name}</Link>
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
                      style={s.active ? { background: 'rgba(16,185,129,0.12)', color: '#047857' } : { background: 'rgba(107,114,128,0.12)', color: '#4b5563' }}>
                      {s.active ? (s.emailAlerts ? 'Alertes par e-mail' : 'Active, sans e-mail') : 'Désactivée'}
                    </span>
                    {newMatches !== null && newMatches > 0 && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold" style={{ background: 'color-mix(in srgb, var(--color-brand-orange) 14%, transparent)', color: '#c2410c' }}>
                        {newMatches} nouveau{newMatches > 1 ? 'x' : ''}
                      </span>
                    )}
                  </div>
                  {s.description && <p className="text-sm mt-1" style={muted}>{s.description}</p>}
                  <p className="text-xs mt-1.5" style={muted}>{criteria.join(' · ')}</p>
                  <p className="text-xs mt-1.5" style={muted}>
                    <strong style={{ color: 'var(--color-text)' }}>{matching === null ? '—' : `${matching} candidat${matching > 1 ? 's' : ''}`}</strong> dans la base aujourd’hui
                    {' '}· créée le {formatDateFr(s.createdAt)}
                    {' '}· {s.lastMatchAt ? `dernière correspondance le ${formatDateFr(s.lastMatchAt)}` : 'aucune nouvelle correspondance'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {pending && <Loader2 className="h-4 w-4 animate-spin" style={muted} aria-label="Enregistrement…" />}
                  <Link href={openHref(s)} className={`${action} no-underline`} style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Ouvrir
                  </Link>
                  <button type="button" disabled={pending} className={action} style={{ ...surface, color: 'var(--color-text)' }}
                    onClick={() => run(s.id, () => setSavedSearchFlagsAction(s.id, { active: !s.active }), replace)}>
                    {s.active ? <><Pause className="h-3.5 w-3.5" aria-hidden /> Désactiver</> : <><Play className="h-3.5 w-3.5" aria-hidden /> Activer</>}
                  </button>
                  <button type="button" disabled={pending} className={action} style={{ ...surface, color: 'var(--color-text)' }}
                    onClick={() => run(s.id, () => setSavedSearchFlagsAction(s.id, { emailAlerts: !s.emailAlerts }), replace)}>
                    {s.emailAlerts ? <><MailX className="h-3.5 w-3.5" aria-hidden /> Couper les e-mails</> : <><Mail className="h-3.5 w-3.5" aria-hidden /> Recevoir les e-mails</>}
                  </button>
                  <button type="button" disabled={pending} className={action} style={{ ...surface, color: '#b91c1c' }} aria-label={`Supprimer la recherche « ${s.name} »`}
                    onClick={() => {
                      if (!window.confirm(`Supprimer la recherche « ${s.name} » ? Ses alertes restent dans l’historique.`)) return
                      run(s.id, () => deleteSavedSearchAction(s.id), () => setList(l => l.filter(r => r.search.id !== s.id)))
                    }}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">Supprimer</span>
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
