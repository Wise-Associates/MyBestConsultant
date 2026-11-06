'use client'

import { useState } from 'react'
import {
  AlertCircle, ArrowRight, Building2, Check, Circle, Loader2, Mail, Minus, Pencil, Phone, Plus, Radar, RotateCcw, Sparkles, X,
} from 'lucide-react'
import { analyseMbcBrief, searchMbcProfiles } from './actions'
import {
  CRITERIA_LIMITS, EMPTY_CRITERIA, MAX_PAGE, PAGE_SIZE, SENIORITIES, criteriaProblem,
  type CriteriaMatch, type MbcCriteria, type ScoredProfile, type Seniority,
} from '@/lib/mbc-search/rules'

// Parcours en deux temps : un grand champ pour décrire le profil, puis l'espace de travail (critères modifiables,
// étapes de la recherche, liste avec la grille des critères remplis par chaque profil).

type ListKey = 'titles' | 'skills' | 'locations'
const LISTS: { key: ListKey; label: string; placeholder: string }[] = [
  { key: 'titles', label: 'Intitulés', placeholder: 'ex : Data Engineer' },
  { key: 'skills', label: 'Compétences', placeholder: 'ex : Spark' },
  { key: 'locations', label: 'Lieux', placeholder: 'ex : Lyon, France' },
]

// Briefs d'exemple, fictifs, pour montrer le niveau de détail attendu.
const EXAMPLES = [
  'Data engineer senior à Lyon, Spark et Kafka, à l\'aise en environnement cloud',
  'Chef de projet SAP FI/CO confirmé, Île-de-France, expérience de déploiement international',
  'Développeur React / Node.js, 3 à 5 ans d\'expérience, Nantes ou Rennes',
]

type StepKey = 'brief' | 'search' | 'rank'
type StepState = 'todo' | 'run' | 'done' | 'error' | 'skip'
const STEPS: { key: StepKey; label: string }[] = [
  { key: 'brief', label: 'Lecture du brief par l\'IA' },
  { key: 'search', label: 'Recherche dans la base Apollo' },
  { key: 'rank', label: 'Classement selon vos critères' },
]
const IDLE_STEPS: Record<StepKey, StepState> = { brief: 'todo', search: 'todo', rank: 'todo' }

const surface = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' } as const
const orangeTint = (pct: number) => `color-mix(in srgb, var(--color-brand-orange) ${pct}%, transparent)`

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-2xl p-4 text-sm"
      style={{ ...surface, borderColor: 'var(--color-brand-orange)', color: 'var(--color-text)' }}>
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'var(--color-brand-orange)' }} />
      {children}
    </p>
  )
}

/** Valeurs d'un critère en puces, avec un petit champ pour en ajouter (Entrée ou +). */
function ChipField({ id, label, placeholder, values, onChange }: {
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
    <div className="min-w-0">
      <label htmlFor={id} className="text-[11px] font-bold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{label}</label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl p-1.5" style={surface}>
        {values.map(v => (
          <span key={v} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-lg text-xs font-semibold"
            style={{ background: orangeTint(12), color: 'var(--color-text)' }}>
            {v}
            <button type="button" onClick={() => onChange(values.filter(x => x !== v))} aria-label={`Retirer ${v}`}
              className="rounded p-0.5 hover:opacity-70 focus-visible:outline-2">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input id={id} value={draft} onChange={e => setDraft(e.target.value)} onBlur={add} disabled={full} maxLength={CRITERIA_LIMITS.item}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={full ? `${CRITERIA_LIMITS.items} au plus` : placeholder}
          className="flex-1 min-w-[7rem] bg-transparent px-1.5 py-1 text-sm outline-none" style={{ color: 'var(--color-text)' }} />
        {draft.trim() && (
          <button type="button" onClick={add} aria-label={`Ajouter à ${label}`} className="rounded-lg p-1" style={{ color: 'var(--color-text)' }}>
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'run') return <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--color-brand-orange)' }} />
  if (state === 'done') return <Check className="h-4 w-4" style={{ color: 'var(--color-brand-orange)' }} />
  if (state === 'error') return <AlertCircle className="h-4 w-4" style={{ color: 'var(--color-brand-orange)' }} />
  if (state === 'skip') return <Minus className="h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
  return <Circle className="h-4 w-4" style={{ color: 'var(--color-border)' }} />
}

function Progress({ steps }: { steps: Record<StepKey, StepState> }) {
  return (
    <ol className="flex flex-col sm:flex-row gap-2 sm:gap-6" aria-label="Étapes de la recherche">
      {STEPS.map(s => (
        <li key={s.key} className="flex items-center gap-2 text-sm"
          style={{ color: steps[s.key] === 'todo' || steps[s.key] === 'skip' ? 'var(--color-text-muted)' : 'var(--color-text)' }}>
          <StepIcon state={steps[s.key]} />
          <span>{s.label}</span>
          <span className="sr-only">
            {{ todo: 'à venir', run: 'en cours', done: 'terminée', error: 'en échec', skip: 'sautée' }[steps[s.key]]}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** Case de la grille des critères : rempli, en partie, non rempli, ou critère non demandé. */
function MatchCell({ value, label }: { value: 'yes' | 'partial' | 'no' | 'any'; label: string }) {
  const text = { yes: 'rempli', partial: 'en partie', no: 'non rempli', any: 'non demandé' }[value]
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg" title={`${label} : ${text}`}
      style={value === 'yes' ? { background: 'var(--color-brand-orange)', color: 'white' }
        : value === 'partial' ? { background: orangeTint(18), color: 'var(--color-text)' }
          : { border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
      {value === 'yes' ? <Check className="h-4 w-4" /> : value === 'partial' ? <Check className="h-3.5 w-3.5 opacity-60" /> : <Minus className="h-3.5 w-3.5" />}
      <span className="sr-only">{label} : {text}</span>
    </span>
  )
}

function matchCells(m: CriteriaMatch, wantedSkills: number) {
  return [
    { label: 'Intitulé', value: m.title === 'full' ? 'yes' : m.title === 'partial' ? 'partial' : m.title === 'any' ? 'any' : 'no' },
    { label: 'Compétences', value: wantedSkills === 0 ? 'any' : m.skills.length === wantedSkills ? 'yes' : m.skills.length > 0 ? 'partial' : 'no' },
    { label: 'Joignable', value: m.reachable ? 'yes' : 'no' },
    { label: 'Profil récent', value: m.fresh ? 'yes' : 'no' },
  ] as const
}

const GRID = 'md:grid md:grid-cols-[3.5rem_minmax(0,1fr)_repeat(4,4.75rem)] md:items-center md:gap-3'

function ResultRow({ p, wantedSkills }: { p: ScoredProfile; wantedSkills: number }) {
  const name = [p.firstName, p.lastNameMasked].filter(Boolean).join(' ') || 'Profil sans nom'
  return (
    <li className={`px-4 py-4 ${GRID}`} style={{ borderTop: '1px solid var(--color-border)' }}>
      <div className="flex items-start gap-3 md:contents">
        <span className="shrink-0 inline-flex items-center justify-center w-12 h-12 rounded-xl text-base font-bold"
          style={{ background: orangeTint(8 + Math.round(p.score * 0.22)), color: 'var(--color-text)' }}
          aria-label={`Score : ${p.score} sur 100`}>
          {p.score}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-sm truncate" style={{ color: 'var(--color-text)' }}>{name}</p>
          {p.title && <p className="text-sm truncate" style={{ color: 'var(--color-text)' }}>{p.title}</p>}
          <p className="flex items-center gap-3 flex-wrap text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {p.company && <span className="inline-flex items-center gap-1 min-w-0"><Building2 className="h-3 w-3 shrink-0" /><span className="truncate">{p.company}</span></span>}
            {p.hasEmail && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />E-mail</span>}
            {p.hasPhone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />Téléphone</span>}
          </p>
          {p.reasons.length > 0 && (
            <details className="mt-1.5 text-xs" style={{ color: 'var(--color-text)' }}>
              <summary className="cursor-pointer font-semibold w-fit" style={{ color: 'var(--color-text-muted)' }}>Pourquoi ce score ?</summary>
              <ul className="mt-1.5 space-y-0.5 pl-1">
                {p.reasons.map(r => <li key={r}>· {r}</li>)}
              </ul>
            </details>
          )}
        </div>
      </div>
      {/* Mobile : la grille devient une ligne de pastilles libellées sous le profil. */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 md:contents">
        {matchCells(p.match, wantedSkills).map(c => (
          <span key={c.label} className="inline-flex items-center gap-1.5 md:justify-center">
            <MatchCell value={c.value} label={c.label} />
            <span className="md:hidden text-xs" style={{ color: 'var(--color-text-muted)' }}>{c.label}</span>
          </span>
        ))}
      </div>
    </li>
  )
}

export function MbcSearchClient({ configured }: { configured: boolean }) {
  const [phase, setPhase] = useState<'compose' | 'workspace'>('compose')
  const [brief, setBrief] = useState('')
  const [criteria, setCriteria] = useState<MbcCriteria>(EMPTY_CRITERIA)
  const [steps, setSteps] = useState<Record<StepKey, StepState>>(IDLE_STEPS)
  const [results, setResults] = useState<{ profiles: ScoredProfile[]; total: number; page: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const setStep = (key: StepKey, state: StepState) => setSteps(s => ({ ...s, [key]: state }))

  // Une Server Action injoignable (réseau coupé, déploiement en cours) lève : l'étape en cours passe en échec.
  const failRunning = () => {
    setSteps(s => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v === 'run' ? 'error' : v])) as Record<StepKey, StepState>)
    setError('Le serveur ne répond pas : vérifiez votre connexion puis relancez.')
  }

  /** Recherche Apollo puis classement, avec ces critères (ceux de l'IA, ou ceux corrigés par le recruteur). */
  const runSearch = async (c: MbcCriteria, page: number) => {
    setStep('search', 'run')
    const res = await searchMbcProfiles(c, page)
    if (res.error) {
      setStep('search', 'error')
      setError(res.error)
      return
    }
    setStep('search', 'done')
    setStep('rank', 'done')
    setResults({ profiles: res.profiles ?? [], total: res.total ?? 0, page })
  }

  const launchFromBrief = async () => {
    setError(null)
    setBusy(true)
    setPhase('workspace')
    setResults(null)
    setSteps({ ...IDLE_STEPS, brief: 'run' })
    try {
      const res = await analyseMbcBrief(brief)
      if (res.error || !res.criteria) {
        setStep('brief', 'error')
        setError(res.error ?? 'L\'IA n\'a pas pu lire le brief.')
        return
      }
      setCriteria(res.criteria)
      setStep('brief', 'done')
      await runSearch(res.criteria, 1)
    } catch {
      failRunning()
    } finally {
      setBusy(false)
    }
  }

  const relaunch = async (page = 1) => {
    setError(null)
    setBusy(true)
    setSteps(s => ({ brief: s.brief === 'done' ? 'done' : 'skip', search: 'todo', rank: 'todo' }))
    try {
      await runSearch(criteria, page)
    } catch {
      failRunning()
    } finally {
      setBusy(false)
    }
  }

  const manualCriteria = () => {
    setError(null)
    setPhase('workspace')
    setSteps({ ...IDLE_STEPS, brief: 'skip' })
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
          <div className="flex items-center gap-2 mb-1">
            <Radar className="h-5 w-5" style={{ color: 'var(--color-brand-orange)' }} />
            <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>MBC Search</h1>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem' }}>
            Décrivez le profil idéal : l&apos;IA en tire les critères et cherche parmi des millions de profils professionnels.
          </p>
        </div>
      </div>

      {phase === 'compose' ? (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
          <h2 className="text-center text-2xl sm:text-3xl font-bold mb-2" style={{ color: 'var(--color-text)' }}>Qui recherchez-vous ?</h2>
          <p className="text-center text-sm mb-6" style={{ color: 'var(--color-text-muted)' }}>
            Une fiche de poste, un brief rapide ou le portrait du candidat idéal : écrivez comme vous parleriez à un collègue.
          </p>
          {!configured && <div className="mb-4"><ErrorNote>La recherche n&apos;est pas encore activée sur la plateforme (clé Apollo manquante). Contactez le support.</ErrorNote></div>}
          <div className="rounded-3xl p-3 sm:p-4" style={{ ...surface, boxShadow: '0 20px 50px -24px rgba(0,0,0,0.25)' }}>
            <label htmlFor="mbc-brief" className="sr-only">Profil recherché</label>
            <textarea id="mbc-brief" value={brief} onChange={e => setBrief(e.target.value)} rows={5} maxLength={CRITERIA_LIMITS.brief} autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && brief.trim().length >= 20 && configured) launchFromBrief() }}
              placeholder="ex : Data engineer senior basé à Lyon, Spark et Kafka, 5 ans d'expérience, disponible rapidement…"
              className="w-full resize-none bg-transparent px-2 py-1.5 text-base outline-none" style={{ color: 'var(--color-text)' }} />
            <div className="flex items-center justify-between gap-3 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
              <span className="text-xs pl-2" style={{ color: 'var(--color-text-muted)' }}>{brief.length} / {CRITERIA_LIMITS.brief}</span>
              <button type="button" onClick={launchFromBrief} disabled={!configured || brief.trim().length < 20}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40"
                style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
                <Sparkles className="h-4 w-4" /> Lancer la recherche
              </button>
            </div>
          </div>
          <div className="mt-5">
            <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>Exemples</p>
            <div className="flex flex-col gap-2">
              {EXAMPLES.map(ex => (
                <button key={ex} type="button" onClick={() => setBrief(ex)}
                  className="text-left text-sm rounded-xl px-4 py-2.5 inline-flex items-center justify-between gap-3 hover:opacity-80" style={{ ...surface, color: 'var(--color-text)' }}>
                  {ex}
                  <ArrowRight className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-muted)' }} />
                </button>
              ))}
            </div>
          </div>
          <p className="text-center mt-6">
            <button type="button" onClick={manualCriteria} className="text-sm font-semibold underline-offset-4 hover:underline" style={{ color: 'var(--color-text)' }}>
              Ou renseignez les critères vous-même
            </button>
          </p>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-5">
          {/* Brief et critères : l'IA les a remplis, le recruteur les corrige puis relance. */}
          <section className="rounded-3xl p-4 sm:p-6 space-y-5" style={surface} aria-labelledby="mbc-criteria-title">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <h2 id="mbc-criteria-title" className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Critères de recherche</h2>
                {brief.trim() && <p className="text-sm mt-1 line-clamp-2" style={{ color: 'var(--color-text-muted)' }}>« {brief.trim()} »</p>}
              </div>
              <button type="button" onClick={() => { setPhase('compose'); setError(null) }} disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-40" style={{ ...surface, color: 'var(--color-text)' }}>
                <Pencil className="h-3.5 w-3.5" /> Modifier le brief
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {LISTS.map(l => (
                <ChipField key={l.key} id={`mbc-${l.key}`} label={l.label} placeholder={l.placeholder} values={criteria[l.key]}
                  onChange={v => setCriteria(c => ({ ...c, [l.key]: v }))} />
              ))}
            </div>
            <fieldset>
              <legend className="text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Séniorité</legend>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(SENIORITIES) as Seniority[]).map(s => {
                  const on = criteria.seniorities.includes(s)
                  return (
                    <button key={s} type="button" onClick={() => toggleSeniority(s)} aria-pressed={on}
                      className="mbc-search-pill px-3 py-1.5 rounded-lg text-xs font-semibold"
                      style={on ? { background: orangeTint(14), color: 'var(--color-text)', border: '1px solid var(--color-brand-orange)' }
                        : { ...surface, color: 'var(--color-text-muted)' }}>
                      {SENIORITIES[s]}
                    </button>
                  )
                })}
              </div>
            </fieldset>
            <div className="flex items-center justify-between gap-4 flex-wrap pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
              <Progress steps={steps} />
              <button type="button" onClick={() => relaunch(1)} disabled={busy || !configured || Boolean(missing)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40"
                style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                {results ? 'Relancer avec ces critères' : 'Rechercher'}
              </button>
            </div>
            {missing && !busy && steps.brief !== 'run' && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{missing}</p>}
          </section>

          {error && <ErrorNote>{error}</ErrorNote>}

          <section className="rounded-3xl overflow-hidden" style={surface} aria-labelledby="mbc-results-title" aria-busy={busy}>
            <div className="flex items-baseline justify-between gap-4 flex-wrap px-4 sm:px-6 py-4">
              <h2 id="mbc-results-title" className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>
                {results ? `${results.total.toLocaleString('fr-FR')} profil${results.total > 1 ? 's' : ''}` : 'Profils'}
              </h2>
              {results && results.total > 0 && (
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Page {results.page} sur {lastPage} · classés par score</p>
              )}
            </div>

            {!results ? (
              <p className="px-6 pb-10 pt-4 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {busy ? 'Recherche en cours…' : 'Vérifiez les critères puis lancez la recherche.'}
              </p>
            ) : results.profiles.length === 0 ? (
              <p className="px-6 pb-10 pt-4 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                Aucun profil pour ces critères. Retirez un lieu ou une séniorité, ou élargissez les intitulés.
              </p>
            ) : (
              <>
                <div className={`hidden px-4 pb-2 text-[11px] font-bold uppercase tracking-wider ${GRID}`} style={{ color: 'var(--color-text-muted)' }} aria-hidden>
                  <span>Score</span><span>Profil</span>
                  <span className="text-center">Intitulé</span><span className="text-center">Compét.</span>
                  <span className="text-center">Joignable</span><span className="text-center">Récent</span>
                </div>
                <ul style={{ opacity: busy ? 0.5 : 1 }}>
                  {results.profiles.map(p => <ResultRow key={p.id} p={p} wantedSkills={criteria.skills.length} />)}
                </ul>
              </>
            )}

            {results && lastPage > 1 && (
              <nav className="flex items-center justify-center gap-3 py-4" style={{ borderTop: '1px solid var(--color-border)' }} aria-label="Pages de résultats">
                <button type="button" onClick={() => relaunch(results.page - 1)} disabled={busy || results.page <= 1}
                  className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40" style={{ ...surface, color: 'var(--color-text)' }}>
                  Précédente
                </button>
                <button type="button" onClick={() => relaunch(results.page + 1)} disabled={busy || results.page >= lastPage}
                  className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40" style={{ ...surface, color: 'var(--color-text)' }}>
                  Suivante
                </button>
              </nav>
            )}
          </section>

          <p className="text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
            Source : Apollo.io. Les noms de famille sont masqués et les coordonnées ne sont pas affichées : elles ne sont révélées qu&apos;à l&apos;enrichissement d&apos;un profil, qui consomme des crédits.
          </p>
        </div>
      )}
    </div>
  )
}
