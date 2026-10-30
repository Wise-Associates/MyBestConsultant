'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowLeft, Building2, Loader2, Mail, Phone, Plus, Radar, Search, Sparkles, X } from 'lucide-react'
import { analyseMbcBrief, searchMbcProfiles } from './actions'
import {
  CRITERIA_LIMITS, EMPTY_CRITERIA, MAX_PAGE, PAGE_SIZE, SENIORITIES, criteriaProblem,
  type MbcCriteria, type ScoredProfile, type Seniority,
} from '@/lib/mbc-search/rules'

type ListKey = 'titles' | 'locations' | 'skills'

const LISTS: { key: ListKey; label: string; placeholder: string }[] = [
  { key: 'titles', label: 'Intitulés de poste', placeholder: 'ex : Data Engineer' },
  { key: 'skills', label: 'Compétences clés', placeholder: 'ex : Spark' },
  { key: 'locations', label: 'Localisations', placeholder: 'ex : Lyon, France' },
]

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="text-sm font-bold mb-2 block" style={{ color: 'var(--color-text)' }}>{children}</label>
}

/** Liste de valeurs modifiables : une puce par valeur, un champ pour en ajouter (Entrée ou bouton). */
function ChipList({ id, label, placeholder, values, onChange }: {
  id: string; label: string; placeholder: string; values: string[]; onChange: (v: string[]) => void
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
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 mb-2" aria-label={label}>
          {values.map(v => (
            <li key={v} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-xs font-semibold"
              style={{ background: 'color-mix(in srgb, var(--color-brand-orange) 12%, transparent)', color: 'var(--color-text)' }}>
              {v}
              <button type="button" onClick={() => onChange(values.filter(x => x !== v))} aria-label={`Retirer ${v}`}
                className="rounded-full p-0.5 hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-1">
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input id={id} value={draft} onChange={e => setDraft(e.target.value)} disabled={full} maxLength={CRITERIA_LIMITS.item}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={full ? `${CRITERIA_LIMITS.items} au plus` : placeholder}
          className="flex-1 min-w-0 rounded-xl px-3 py-2 text-sm outline-none focus-visible:ring-2"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
        <button type="button" onClick={add} disabled={full || !draft.trim()} aria-label={`Ajouter à ${label}`}
          className="shrink-0 rounded-xl px-3 disabled:opacity-40"
          style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function ScoreBadge({ score }: { score: number }) {
  // Intensité de l'orange de marque proportionnelle au score : lisible d'un coup d'œil, sans nouvelle couleur.
  const tint = 8 + Math.round(score * 0.22)
  return (
    <div className="shrink-0 w-14 h-14 rounded-2xl flex flex-col items-center justify-center"
      style={{ background: `color-mix(in srgb, var(--color-brand-orange) ${tint}%, transparent)`, color: 'var(--color-text)' }}
      aria-label={`Score de correspondance : ${score} sur 100`}>
      <span className="text-lg font-bold leading-none">{score}</span>
      <span className="text-[10px] font-semibold opacity-70">/100</span>
    </div>
  )
}

function ProfileCard({ p }: { p: ScoredProfile }) {
  const name = [p.firstName, p.lastNameMasked].filter(Boolean).join(' ') || 'Profil sans nom'
  return (
    <li className="rounded-3xl p-5 sm:p-6" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-start gap-4">
        <ScoreBadge score={p.score} />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-base" style={{ color: 'var(--color-text)' }}>{name}</p>
          {p.title && <p className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>{p.title}</p>}
          <div className="flex items-center gap-4 flex-wrap text-xs mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
            {p.company && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{p.company}</span>}
            {p.hasEmail && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />E-mail connu</span>}
            {p.hasPhone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />Téléphone connu</span>}
          </div>
          {p.reasons.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs" style={{ color: 'var(--color-text)' }} aria-label="Pourquoi ce profil">
              {p.reasons.map(r => (
                <li key={r} className="flex items-start gap-1.5">
                  <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--color-brand-orange)' }} />
                  {r}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  )
}

export function MbcSearchClient({ configured }: { configured: boolean }) {
  const [brief, setBrief] = useState('')
  const [criteria, setCriteria] = useState<MbcCriteria>(EMPTY_CRITERIA)
  const [results, setResults] = useState<{ profiles: ScoredProfile[]; total: number; page: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [analysing, startAnalyse] = useTransition()
  const [searching, startSearch] = useTransition()
  const busy = analysing || searching

  const analyse = () => {
    setError(null)
    startAnalyse(async () => {
      const res = await analyseMbcBrief(brief)
      if (res.error) setError(res.error)
      else if (res.criteria) setCriteria(res.criteria)
    })
  }

  const search = (page: number) => {
    setError(null)
    startSearch(async () => {
      const res = await searchMbcProfiles(criteria, page)
      if (res.error) setError(res.error)
      else setResults({ profiles: res.profiles ?? [], total: res.total ?? 0, page })
    })
  }

  const toggleSeniority = (s: Seniority) => setCriteria(c => ({
    ...c, seniorities: c.seniorities.includes(s) ? c.seniorities.filter(x => x !== s) : [...c.seniorities, s],
  }))

  const missing = criteriaProblem(criteria)
  const lastPage = results ? Math.min(MAX_PAGE, Math.ceil(results.total / PAGE_SIZE)) : 0

  return (
    <div className="relative" style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <Link href="/recruiter/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80"
            style={{ color: 'rgba(255,255,255,0.6)' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Retour à l&apos;espace recruteur
          </Link>
          <div className="flex items-center gap-2 mb-1">
            <Radar className="h-5 w-5" style={{ color: 'var(--color-brand-orange)' }} />
            <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>MBC Search</h1>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem' }}>
            Décrivez le profil idéal : l&apos;IA en tire les critères, vous les ajustez, et nous cherchons parmi des millions de profils professionnels.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col lg:flex-row gap-8 items-start">
        <aside className="w-full lg:w-96 shrink-0 space-y-4">
          <div className="rounded-3xl p-5 sm:p-6 space-y-6" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div>
              <FieldLabel htmlFor="mbc-brief">1. Le profil recherché</FieldLabel>
              <textarea id="mbc-brief" value={brief} onChange={e => setBrief(e.target.value)} rows={6} maxLength={CRITERIA_LIMITS.brief}
                placeholder="Collez une fiche de poste ou décrivez le profil : « Data engineer senior à Lyon, Spark et Kafka, 5 ans d'expérience… »"
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-y focus-visible:ring-2"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
              <button type="button" onClick={analyse} disabled={busy || !configured || brief.trim().length < 20}
                className="mt-2 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
                style={{ border: '1px solid var(--color-brand-orange)', color: 'var(--color-text)' }}>
                {analysing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" style={{ color: 'var(--color-brand-orange)' }} />}
                {analysing ? 'Analyse du brief…' : 'Extraire les critères avec l\'IA'}
              </button>
            </div>

            <div className="space-y-5">
              <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>2. Les critères</p>
              {LISTS.map(l => (
                <ChipList key={l.key} id={`mbc-${l.key}`} label={l.label} placeholder={l.placeholder} values={criteria[l.key]}
                  onChange={v => setCriteria(c => ({ ...c, [l.key]: v }))} />
              ))}
              <fieldset>
                <legend className="text-sm font-bold mb-2" style={{ color: 'var(--color-text)' }}>Séniorité</legend>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(SENIORITIES) as Seniority[]).map(s => {
                    const on = criteria.seniorities.includes(s)
                    return (
                      <button key={s} type="button" onClick={() => toggleSeniority(s)} aria-pressed={on}
                        className="mbc-search-pill px-3 py-1.5 rounded-xl text-xs font-semibold"
                        style={on
                          ? { background: 'var(--navbar-bg)', color: 'var(--navbar-text)', border: '1px solid var(--color-brand-orange)' }
                          : { background: 'var(--color-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                        {SENIORITIES[s]}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            </div>

            <button type="button" onClick={() => search(1)} disabled={busy || !configured || Boolean(missing)}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold disabled:opacity-50"
              style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {searching ? 'Recherche…' : '3. Rechercher les profils'}
            </button>
            {missing && !busy && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{missing}</p>}
          </div>
        </aside>

        <section className="flex-1 min-w-0 w-full" aria-live="polite" aria-busy={searching}>
          {!configured && (
            <p role="alert" className="flex items-start gap-2 rounded-2xl p-4 text-sm mb-4"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-brand-orange)', color: 'var(--color-text)' }}>
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'var(--color-brand-orange)' }} />
              La recherche n&apos;est pas encore activée sur la plateforme (clé Apollo manquante). Contactez le support.
            </p>
          )}
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-2xl p-4 text-sm mb-4"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-brand-orange)', color: 'var(--color-text)' }}>
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'var(--color-brand-orange)' }} />
              {error}
            </p>
          )}

          {!results && (
            <div className="rounded-3xl p-8 text-center" style={{ border: '1px dashed var(--color-border)' }}>
              <Radar className="h-8 w-8 mx-auto mb-3" style={{ color: 'var(--color-text-muted)' }} />
              <p className="font-semibold" style={{ color: 'var(--color-text)' }}>Vos profils apparaîtront ici</p>
              <p className="text-sm mt-1 max-w-md mx-auto" style={{ color: 'var(--color-text-muted)' }}>
                Chaque profil reçoit un score sur 100 et les raisons de ce score : intitulé, compétences visibles, coordonnées disponibles et fraîcheur du profil.
              </p>
            </div>
          )}

          {results && (
            <>
              <div className="flex items-baseline justify-between gap-4 flex-wrap mb-4">
                <h2 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>
                  {results.total.toLocaleString('fr-FR')} profil{results.total > 1 ? 's' : ''} trouvé{results.total > 1 ? 's' : ''}
                </h2>
                {results.total > 0 && (
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    Page {results.page} sur {lastPage} · classés par score
                  </p>
                )}
              </div>
              {results.profiles.length === 0 ? (
                <p className="rounded-3xl p-8 text-center text-sm" style={{ border: '1px dashed var(--color-border)', color: 'var(--color-text-muted)' }}>
                  Aucun profil pour ces critères. Retirez une localisation ou une séniorité, ou élargissez les intitulés.
                </p>
              ) : (
                <ul className="space-y-3">
                  {results.profiles.map(p => <ProfileCard key={p.id} p={p} />)}
                </ul>
              )}
              {lastPage > 1 && (
                <nav className="flex items-center justify-center gap-3 mt-6" aria-label="Pages de résultats">
                  <button type="button" onClick={() => search(results.page - 1)} disabled={busy || results.page <= 1}
                    className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40"
                    style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' }}>
                    Précédente
                  </button>
                  <button type="button" onClick={() => search(results.page + 1)} disabled={busy || results.page >= lastPage}
                    className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40"
                    style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' }}>
                    Suivante
                  </button>
                </nav>
              )}
              <p className="text-xs mt-6 text-center" style={{ color: 'var(--color-text-muted)' }}>
                Source : Apollo.io. Les noms de famille sont masqués et les coordonnées ne sont pas affichées : elles ne sont révélées qu&apos;à l&apos;enrichissement d&apos;un profil, qui consomme des crédits.
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
