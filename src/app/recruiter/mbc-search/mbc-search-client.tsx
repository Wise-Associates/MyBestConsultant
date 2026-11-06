'use client'

import { useState } from 'react'
import {
  AlertCircle, ArrowRight, Bookmark, Check, Circle, ExternalLink, History, Loader2, Mail, Minus, Pencil, Plus, Radar, RotateCcw, Sparkles,
  Star, UserRound, X,
} from 'lucide-react'
import { analyseMbcBrief, deleteMbcSearchEntry, pinMbcSearch, revealMbcProfiles, searchMbcProfiles } from './actions'
import {
  CRITERIA_LIMITS, EMPTY_CRITERIA, MAX_PAGE, PAGE_SIZE, REVEAL_BATCH, SENIORITIES, criteriaProblem,
  requiredSkillsOf, type MbcCriteria, type ScoredProfile, type Seniority,
} from '@/lib/mbc-search/rules'
import type { MbcSearchEntry } from '@/lib/mbc-search/history'
import { ProfilePanel, type Added } from './mbc-profile-panel'
import { Avatar, ChipField, ErrorNote, Toggle, orangeTint, surface, type Reveal } from './mbc-search-ui'

// Parcours en deux temps : un grand champ pour décrire le profil, puis l'espace de travail en trois colonnes —
// critères à gauche, profils classés au centre, profil choisi à droite (fenêtre plein écran sur petit écran).

// Briefs d'exemple, fictifs, pour montrer le niveau de détail attendu.
const EXAMPLES = [
  'Data engineer senior à Lyon, Spark et Kafka, idéalement passé par le secteur bancaire',
  'Chef de projet SAP FI/CO confirmé, Île-de-France, expérience de déploiement international',
  'Développeur React / Node.js, 3 à 5 ans d\'expérience, Nantes ou Rennes',
]

type StepKey = 'brief' | 'search' | 'rank'
type StepState = 'todo' | 'run' | 'done' | 'error' | 'skip'
const STEPS: { key: StepKey; label: string }[] = [
  { key: 'brief', label: 'Brief lu' },
  { key: 'search', label: 'Recherche Apollo' },
  { key: 'rank', label: 'Classement' },
]
const IDLE_STEPS: Record<StepKey, StepState> = { brief: 'todo', search: 'todo', rank: 'todo' }

type Tab = 'all' | 'revealed' | 'shortlist'

// Historique des recherches : enregistré sur le serveur à chaque recherche (critères et brief, aucun profil).
const withEntry = (list: MbcSearchEntry[], entry: MbcSearchEntry) => [entry, ...list.filter(e => e.id !== entry.id)]
const shortDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' })
}
const entryMeta = (e: MbcSearchEntry) => [`${e.total.toLocaleString('fr-FR')} profil${e.total > 1 ? 's' : ''}`, shortDate(e.lastRunAt)].filter(Boolean).join(' · ')

const revealSelectionLabel = (n: number) => `Révéler ${n > 0 ? `la sélection · ${n} crédit${n > 1 ? 's' : ''}` : 'la sélection'}`

function StepIcon({ state }: { state: StepState }) {
  if (state === 'run') return <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: 'var(--color-brand-orange)' }} />
  if (state === 'done') return <Check className="h-3.5 w-3.5" style={{ color: 'var(--color-brand-orange)' }} />
  if (state === 'error') return <AlertCircle className="h-3.5 w-3.5" style={{ color: 'var(--color-brand-orange)' }} />
  if (state === 'skip') return <Minus className="h-3.5 w-3.5" style={{ color: 'var(--color-text-muted)' }} />
  return <Circle className="h-3.5 w-3.5" style={{ color: 'var(--color-border)' }} />
}

function Progress({ steps, total }: { steps: Record<StepKey, StepState>; total: number | null }) {
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Étapes de la recherche">
      {STEPS.map(s => (
        <li key={s.key} className="flex items-center gap-1.5 text-xs font-semibold"
          style={{ color: steps[s.key] === 'todo' || steps[s.key] === 'skip' ? 'var(--color-text-muted)' : 'var(--color-text)' }}>
          <StepIcon state={steps[s.key]} />
          <span>{s.key === 'search' && steps.search === 'done' && total !== null ? `${total.toLocaleString('fr-FR')} profils trouvés` : s.label}</span>
          <span className="sr-only">{{ todo: 'à venir', run: 'en cours', done: 'terminée', error: 'en échec', skip: 'sautée' }[steps[s.key]]}</span>
        </li>
      ))}
    </ol>
  )
}

/** Score sur 100 dans un anneau rempli d'autant. */
function ScoreRing({ score }: { score: number }) {
  return (
    <span className="relative inline-flex items-center justify-center w-11 h-11 rounded-full shrink-0" aria-label={`Score : ${score} sur 100`}
      style={{ background: `conic-gradient(var(--color-brand-orange) ${score}%, var(--color-border) 0)` }}>
      <span className="absolute inset-[4px] rounded-full" style={{ background: 'var(--color-surface)' }} />
      <span className="relative text-sm font-bold" style={{ color: 'var(--color-text)' }}>{score}</span>
    </span>
  )
}

/** Pastilles des critères : remplis en couleur, manqués barrés. */
function CriteriaPills({ p, criteria }: { p: ScoredProfile; criteria: MbcCriteria }) {
  const pills: { label: string; ok: boolean }[] = []
  if (p.match.title !== 'any') pills.push({ label: 'Intitulé', ok: p.match.title !== 'none' })
  for (const s of criteria.skills.slice(0, 3)) pills.push({ label: s, ok: p.match.skills.includes(s) })
  pills.push({ label: 'E-mail', ok: p.hasEmail }, { label: 'Récent', ok: p.match.fresh })
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Critères remplis">
      {pills.map(c => (
        <li key={c.label} className="text-[10.5px] px-1.5 py-0.5 rounded font-semibold"
          style={c.ok ? { background: orangeTint(12), color: 'var(--color-text)' } : { color: 'var(--color-text-muted)', textDecoration: 'line-through', fontWeight: 500 }}>
          {c.label}<span className="sr-only">{c.ok ? ' : rempli' : ' : non rempli'}</span>
        </li>
      ))}
    </ul>
  )
}

function ResultRow({ p, criteria, reveal, active, selected, shortlisted, inVivier, busy, onOpen, onSelect, onShortlist, onReveal }: {
  p: ScoredProfile; criteria: MbcCriteria; reveal?: Reveal; active: boolean; selected: boolean; shortlisted: boolean; inVivier: boolean; busy: boolean
  onOpen: () => void; onSelect: () => void; onShortlist: () => void; onReveal: () => void
}) {
  const full = reveal?.state === 'done' ? reveal.profile : null
  const name = full?.name || [p.firstName, p.lastNameMasked].filter(Boolean).join(' ') || 'Profil sans nom'
  const iconBtn = 'inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0'
  return (
    <li className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_auto_minmax(0,1fr)_minmax(0,13rem)_auto_auto] items-center gap-x-3 gap-y-2 px-4 py-3"
      style={{ borderTop: '1px solid var(--color-border)', background: active ? orangeTint(5) : undefined, boxShadow: active ? 'inset 3px 0 var(--color-brand-orange)' : undefined }}>
      <input type="checkbox" checked={selected} onChange={onSelect} disabled={Boolean(full) || reveal?.state === 'missing'}
        aria-label={`Sélectionner ${name}`} className="w-4 h-4 accent-[var(--color-brand-orange)] disabled:opacity-30" />
      <Avatar name={name} photoUrl={full?.photoUrl} />
      <button type="button" onClick={onOpen} className="min-w-0 text-left" aria-current={active ? 'true' : undefined}>
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>
            {full ? name : <>{p.firstName || 'Profil'} <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>{p.lastNameMasked}</span></>}
          </span>
          {full && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: orangeTint(14), color: 'var(--color-text)' }}>Révélé</span>}
          {inVivier && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-0.5" style={{ border: '1px solid var(--color-brand-orange)', color: 'var(--color-text)' }}><Check className="h-3 w-3" /> Dans votre vivier</span>}
          {reveal?.state === 'missing' && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ ...surface, color: 'var(--color-text-muted)' }}>Introuvable chez Apollo</span>}
        </span>
        <span className="block text-sm truncate" style={{ color: 'var(--color-text-muted)' }}>{[full?.title || p.title, full?.company || p.company].filter(Boolean).join(' · ')}</span>
        {full?.location && <span className="block text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>{full.location}</span>}
      </button>
      <div className="col-start-3 col-span-2 sm:col-start-auto sm:col-span-1 row-start-2 sm:row-start-auto"><CriteriaPills p={p} criteria={criteria} /></div>
      <div className="col-start-4 row-start-1 sm:col-start-auto sm:row-start-auto"><ScoreRing score={p.score} /></div>
      <div className="hidden sm:flex items-center gap-1.5 justify-end">
        <button type="button" onClick={onShortlist} aria-pressed={shortlisted} aria-label={shortlisted ? `Retirer ${name} de la présélection` : `Présélectionner ${name}`}
          className={iconBtn} style={shortlisted ? { background: orangeTint(12), border: '1px solid var(--color-brand-orange)', color: 'var(--color-brand-orange)' } : { ...surface, color: 'var(--color-text-muted)' }}>
          <Star className="h-4 w-4" fill={shortlisted ? 'currentColor' : 'none'} />
        </button>
        {full ? (
          <>
            {full.linkedinUrl
              ? <a href={full.linkedinUrl} target="_blank" rel="noopener noreferrer" aria-label={`LinkedIn de ${name}`} className={`${iconBtn} no-underline`} style={{ ...surface, color: 'var(--color-text)' }}><ExternalLink className="h-4 w-4" /></a>
              : <span className={iconBtn} />}
            {full.email
              ? <a href={`mailto:${full.email}`} aria-label={`Écrire à ${name}`} className={`${iconBtn} no-underline`} style={{ ...surface, color: 'var(--color-text)' }}><Mail className="h-4 w-4" /></a>
              : <span className={iconBtn} />}
          </>
        ) : reveal?.state !== 'missing' && (
          <button type="button" onClick={onReveal} disabled={busy || reveal?.state === 'loading'}
            className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-bold disabled:opacity-40 whitespace-nowrap" style={{ ...surface, color: 'var(--color-text)' }}>
            {reveal?.state === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserRound className="h-3.5 w-3.5" />} Révéler · 1
          </button>
        )}
      </div>
    </li>
  )
}

/** Liste de recherches de la colonne des critères : un clic relance, la croix retire (ou supprime). */
function EntryList({ title, entries, busy, currentId, onOpen, onRemove, removeLabel, collapsed }: {
  title: string; entries: MbcSearchEntry[]; busy: boolean; currentId: string | null
  onOpen: (e: MbcSearchEntry) => void; onRemove: (e: MbcSearchEntry) => void; removeLabel: (e: MbcSearchEntry) => string
  collapsed?: boolean
}) {
  const list = (
    <ul className="mt-1">
      {entries.map(e => (
        <li key={e.id} className="flex items-center gap-1">
          <button type="button" onClick={() => onOpen(e)} disabled={busy} aria-current={e.id === currentId || undefined}
            className="flex-1 min-w-0 text-left py-1 hover:underline disabled:opacity-40" style={{ color: 'var(--color-text)' }}>
            <span className={`block text-sm truncate ${e.id === currentId ? 'font-bold' : ''}`}>{e.name}</span>
            <span className="block text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{entryMeta(e)}</span>
          </button>
          <button type="button" onClick={() => onRemove(e)} disabled={busy} aria-label={removeLabel(e)} title={removeLabel(e)}
            className="p-1 rounded disabled:opacity-40" style={{ color: 'var(--color-text-muted)' }}><X className="h-3.5 w-3.5" /></button>
        </li>
      ))}
    </ul>
  )
  return (
    <div className="pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
      {collapsed ? (
        <details>
          <summary className="text-xs font-bold cursor-pointer" style={{ color: 'var(--color-text)' }}>{title} ({entries.length})</summary>
          {list}
        </details>
      ) : (
        <>
          <p className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>{title}</p>
          {list}
        </>
      )}
    </div>
  )
}

export function MbcSearchClient({ configured, revealUsage, jobs, history }: {
  configured: boolean
  /** Profils complets révélés aujourd'hui par l'organisation, sur sa limite ; null si illisible. */
  revealUsage: { used: number; limit: number } | null
  /** Offres ouvertes de l'organisation, pour « Associer à une offre » ; null si illisibles. */
  jobs: { id: string; title: string }[] | null
  /** Historique des recherches du recruteur, plus récente d'abord ; null si indisponible. */
  history: MbcSearchEntry[] | null
}) {
  const [phase, setPhase] = useState<'compose' | 'workspace'>('compose')
  const [brief, setBrief] = useState('')
  const [criteria, setCriteria] = useState<MbcCriteria>(EMPTY_CRITERIA)
  const [steps, setSteps] = useState<Record<StepKey, StepState>>(IDLE_STEPS)
  const [results, setResults] = useState<{ profiles: ScoredProfile[]; total: number; page: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Profils complets déjà révélés, par identifiant Apollo : gardés d'une page à l'autre (déjà payés).
  const [reveals, setReveals] = useState<Record<string, Reveal>>({})
  // Profils gardés d'une page à l'autre pour les onglets « Révélés » et « Présélection » (pendant la visite seulement).
  const [seen, setSeen] = useState<Record<string, ScoredProfile>>({})
  const [shortlist, setShortlist] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [tab, setTab] = useState<Tab>('all')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [added, setAdded] = useState<Record<string, Added>>({})
  const [revealUsed, setRevealUsed] = useState(revealUsage?.used ?? null)
  const [entries, setEntries] = useState<MbcSearchEntry[]>(history ?? [])
  // Ligne de l'historique de la dernière recherche lancée, et ses critères (pour savoir s'ils ont changé depuis).
  const [current, setCurrent] = useState<{ id: string; criteria: string } | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)

  const setStep = (key: StepKey, state: StepState) => setSteps(s => ({ ...s, [key]: state }))

  // Une Server Action injoignable (réseau coupé, déploiement en cours) lève : l'étape en cours passe en échec.
  const failRunning = () => {
    setSteps(s => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v === 'run' ? 'error' : v])) as Record<StepKey, StepState>)
    setError('Le serveur ne répond pas : vérifiez votre connexion puis relancez.')
  }

  /** Recherche Apollo puis classement, avec ces critères (ceux de l'IA, ou ceux corrigés par le recruteur). */
  const runSearch = async (c: MbcCriteria, page: number, b: string = brief) => {
    setStep('search', 'run')
    const res = await searchMbcProfiles(c, page, b)
    if (res.error) {
      setStep('search', 'error')
      setError(res.error)
      return
    }
    const profiles = res.profiles ?? []
    setStep('search', 'done')
    setStep('rank', 'done')
    setResults({ profiles, total: res.total ?? 0, page })
    // Profils déjà payés par l'organisation : affichés révélés, sans nouveau crédit ; vivier : déjà ajoutés.
    const known = res.revealed ?? []
    if (known.length > 0) setReveals(r => ({ ...r, ...Object.fromEntries(known.map(k => [k.id, { state: 'done', profile: k } as Reveal])) }))
    const inVivier = res.inVivier ?? {}
    if (Object.keys(inVivier).length > 0) {
      setAdded(a => ({ ...a, ...Object.fromEntries(Object.entries(inVivier).map(([id, targets]) => [id, { ...a[id], ...Object.fromEntries(targets.map(t => [t, true as const])) }])) }))
    }
    if (page === 1) {
      const entry = res.entry
      setCurrent(entry ? { id: entry.id, criteria: JSON.stringify(c) } : null)
      if (entry) setEntries(list => withEntry(list, entry))
      setNaming(null)
      setSavedNote(res.historyError ?? null)
    }
    setSeen(s => ({ ...s, ...Object.fromEntries(profiles.map(p => [p.id, p])) }))
    setSelected([])
    setTab('all')
    setActiveId(profiles[0]?.id ?? null)
  }

  /** Profil complet (payant) des profils demandés ; ceux déjà révélés ou en cours ne sont pas redemandés. */
  const reveal = async (ids: string[]) => {
    const wanted = ids.filter(id => !reveals[id]).slice(0, REVEAL_BATCH)
    if (wanted.length === 0) return
    setError(null)
    setReveals(r => ({ ...r, ...Object.fromEntries(wanted.map(id => [id, { state: 'loading' } as Reveal])) }))
    const forget = () => setReveals(r => Object.fromEntries(Object.entries(r).filter(([id]) => !wanted.includes(id))))
    try {
      const res = await revealMbcProfiles(wanted)
      if (res.error || !res.profiles) {
        forget()
        setError(res.error ?? 'Profils indisponibles pour le moment.')
        return
      }
      // Places du quota prises par le serveur : une par profil payé, trouvé ou non (un profil déjà révélé n'en prend pas).
      const charged = res.charged ?? wanted.length
      setRevealUsed(u => (u === null ? null : u + charged))
      if (res.notKept) setError(res.notKept)
      const found = new Map(res.profiles.map(p => [p.id, p]))
      setReveals(r => ({
        ...r,
        ...Object.fromEntries(wanted.map(id => {
          const profile = found.get(id)
          return [id, profile ? { state: 'done', profile } : { state: 'missing' }] as [string, Reveal]
        })),
      }))
      setSelected(s => s.filter(id => !wanted.includes(id)))
    } catch {
      forget()
      setError('Le serveur ne répond pas : vérifiez votre connexion puis réessayez.')
    }
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

  const relaunch = async (page = 1, c: MbcCriteria = criteria, b: string = brief) => {
    setError(null)
    setBusy(true)
    setSteps(s => ({ brief: s.brief === 'done' ? 'done' : 'skip', search: 'todo', rank: 'todo' }))
    try {
      await runSearch(c, page, b)
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

  /** Enregistre la recherche lancée sous un nom, ou la retire des recherches enregistrées (elle reste dans l'historique). */
  const pin = async (id: string, pinned: boolean, name?: string) => {
    setHistoryBusy(true)
    setSavedNote(null)
    try {
      const res = await pinMbcSearch({ id, pinned, name })
      if (res.error || !res.entry) { setSavedNote(res.error ?? 'Enregistrement impossible.'); return }
      const entry = res.entry
      setEntries(list => list.map(e => (e.id === entry.id ? entry : e)))
      setNaming(null)
      if (pinned) setSavedNote(`Recherche « ${entry.name} » enregistrée.`)
    } catch {
      setSavedNote('Le serveur ne répond pas : réessayez.')
    } finally {
      setHistoryBusy(false)
    }
  }
  const removeEntry = async (id: string) => {
    setHistoryBusy(true)
    setSavedNote(null)
    try {
      const res = await deleteMbcSearchEntry(id)
      if (res.error) { setSavedNote(res.error); return }
      setEntries(list => list.filter(e => e.id !== id))
      if (current?.id === id) setCurrent(null)
    } catch {
      setSavedNote('Le serveur ne répond pas : réessayez.')
    } finally {
      setHistoryBusy(false)
    }
  }
  const openEntry = (e: MbcSearchEntry) => {
    setBrief(e.brief)
    setCriteria(e.criteria)
    setPhase('workspace')
    setSteps({ ...IDLE_STEPS, brief: e.brief ? 'done' : 'skip' })
    if (configured && !criteriaProblem(e.criteria)) relaunch(1, e.criteria, e.brief)
  }

  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id])
  const toggleSeniority = (s: Seniority) => setCriteria(c => ({ ...c, seniorities: toggleIn(c.seniorities, s) as Seniority[] }))
  const toggleRequired = (skill: string) => setCriteria(c => {
    const req = requiredSkillsOf(c)
    const on = req.some(r => r.toLowerCase() === skill.toLowerCase())
    return { ...c, requiredSkills: on ? req.filter(r => r.toLowerCase() !== skill.toLowerCase()) : [...req, skill] }
  })

  const missing = criteriaProblem(criteria)
  const saved = entries.filter(e => e.pinned)
  const recent = entries.filter(e => !e.pinned)
  // La recherche affichée peut être enregistrée tant que ses critères n'ont pas changé depuis son lancement.
  const currentEntry = current && current.criteria === JSON.stringify(criteria) ? entries.find(e => e.id === current.id) ?? null : null
  const lastPage = results ? Math.min(MAX_PAGE, Math.ceil(results.total / PAGE_SIZE)) : 0
  const revealedIds = Object.entries(reveals).filter(([, r]) => r.state === 'done').map(([id]) => id)
  const listed: ScoredProfile[] = tab === 'all'
    ? (results?.profiles ?? []).filter(p => !criteria.recentOnly || p.match.fresh)
    : (tab === 'revealed' ? revealedIds : shortlist).map(id => seen[id]).filter((p): p is ScoredProfile => Boolean(p))
  const hiddenByRecent = tab === 'all' && criteria.recentOnly ? (results?.profiles.length ?? 0) - listed.length : 0
  const selectable = listed.filter(p => !reveals[p.id]).map(p => p.id)
  const allSelected = selectable.length > 0 && selectable.every(id => selected.includes(id))
  const active = activeId ? seen[activeId] : undefined
  const quotaLeft = revealUsage && revealUsed !== null ? Math.max(0, revealUsage.limit - revealUsed) : null

  const openProfile = (id: string) => { setActiveId(id); setPanelOpen(true) }
  const toggleShortlist = (id: string) => setShortlist(s => toggleIn(s, id))

  return (
    <div className="relative" style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-7 flex items-end gap-4 flex-wrap">
          <div className="flex-1 min-w-[16rem]">
            <div className="flex items-center gap-2 mb-1">
              <Radar className="h-5 w-5" style={{ color: 'var(--color-brand-orange)' }} />
              <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>MBC Search</h1>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem' }}>Trouvez des profils hors de votre base, classés selon votre besoin.</p>
          </div>
          {revealUsage && revealUsed !== null && (
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs" style={{ border: '1px solid rgba(255,255,255,0.16)', color: 'rgba(255,255,255,0.75)' }}
              title="Chaque profil complet coûte un crédit Apollo à la plateforme. Le compteur repart à zéro chaque jour (minuit UTC).">
              Profils complets aujourd&apos;hui
              <span className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.16)' }} aria-hidden>
                <span className="block h-full" style={{ width: `${Math.min(100, (revealUsed / revealUsage.limit) * 100)}%`, background: 'var(--color-brand-orange)' }} />
              </span>
              <strong style={{ color: 'white' }}>{revealUsed} / {revealUsage.limit}</strong>
            </div>
          )}
          {phase === 'workspace' && (
            <button type="button" onClick={() => { setPhase('compose'); setError(null) }} disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-40" style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
              <Plus className="h-4 w-4" /> Nouvelle recherche
            </button>
          )}
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
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
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
            <div>
              <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>Vos recherches</p>
              {history === null ? (
                <p className="text-sm rounded-xl px-4 py-3" style={{ ...surface, color: 'var(--color-text-muted)' }}>
                  Historique indisponible pour le moment : la recherche fonctionne, sans garder vos recherches.
                </p>
              ) : entries.length === 0 ? (
                <p className="text-sm rounded-xl px-4 py-3" style={{ ...surface, color: 'var(--color-text-muted)' }}>
                  Aucune pour le moment : chaque recherche lancée s&apos;ajoute ici, et <Bookmark className="inline h-3.5 w-3.5" /> la garde en haut de la liste.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {[...saved, ...recent].slice(0, 5).map(e => (
                    <button key={e.id} type="button" onClick={() => openEntry(e)} disabled={!configured}
                      className="text-left text-sm rounded-xl px-4 py-2.5 flex items-center gap-3 hover:opacity-80 disabled:opacity-40" style={{ ...surface, color: 'var(--color-text)' }}>
                      {e.pinned
                        ? <Bookmark className="h-4 w-4 shrink-0" fill="currentColor" style={{ color: 'var(--color-brand-orange)' }} aria-label="Enregistrée" />
                        : <History className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-muted)' }} aria-hidden />}
                      <span className="flex-1 min-w-0">
                        <span className="block truncate font-semibold">{e.name}</span>
                        <span className="block text-xs" style={{ color: 'var(--color-text-muted)' }}>{entryMeta(e)}</span>
                      </span>
                      <RotateCcw className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-muted)' }} aria-hidden />
                    </button>
                  ))}
                  {entries.length > 5 && (
                    <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Toutes vos recherches : dans l&apos;espace de travail, sous les critères.</p>
                  )}
                </div>
              )}
            </div>
          </div>
          <p className="text-center mt-6">
            <button type="button" onClick={manualCriteria} className="text-sm font-semibold underline-offset-4 hover:underline" style={{ color: 'var(--color-text)' }}>
              Ou renseignez les critères vous-même
            </button>
          </p>
        </div>
      ) : (
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 space-y-4">
          <section className="rounded-2xl px-4 py-3 flex items-center gap-4 flex-wrap" style={surface} aria-label="Votre brief">
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Votre brief</span>
            <p className="flex-1 min-w-[14rem] text-sm line-clamp-2" style={{ color: brief.trim() ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
              {brief.trim() || 'Critères renseignés à la main.'}
            </p>
            <Progress steps={steps} total={results?.total ?? null} />
            <button type="button" onClick={() => { setPhase('compose'); setError(null) }} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40" style={{ ...surface, color: 'var(--color-text)' }}>
              <Pencil className="h-3.5 w-3.5" /> Modifier le brief
            </button>
          </section>

          {error && <ErrorNote>{error}</ErrorNote>}

          <div className="grid gap-4 items-start lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_340px]">
            {/* Critères : remplis par l'IA, corrigés par le recruteur, puis « Relancer ». */}
            <aside className="rounded-2xl p-4 space-y-4" style={surface} aria-label="Critères de recherche">
              <ChipField id="mbc-titles" label="Intitulés" hint="1 au moins" placeholder="ex : Data Engineer" values={criteria.titles}
                onChange={v => setCriteria(c => ({ ...c, titles: v }))} />
              <ChipField id="mbc-skills" label="Compétences" hint="★ = obligatoire" placeholder="ex : Spark" values={criteria.skills}
                onChange={v => setCriteria(c => ({ ...c, skills: v }))} starred={requiredSkillsOf(criteria)} onStar={toggleRequired} />
              <ChipField id="mbc-locations" label="Lieu" placeholder="ex : Lyon, France" values={criteria.locations}
                onChange={v => setCriteria(c => ({ ...c, locations: v }))} />
              <ChipField id="mbc-sectors" label="Secteur de l'employeur" hint="en anglais" placeholder="ex : Banking" values={criteria.sectors ?? []}
                onChange={v => setCriteria(c => ({ ...c, sectors: v }))} />
              <fieldset>
                <legend className="text-xs font-bold mb-1.5" style={{ color: 'var(--color-text)' }}>Séniorité</legend>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(SENIORITIES) as Seniority[]).map(s => {
                    const on = criteria.seniorities.includes(s)
                    return (
                      <button key={s} type="button" onClick={() => toggleSeniority(s)} aria-pressed={on}
                        className="px-2.5 py-1 rounded-full text-xs font-semibold"
                        style={on ? { background: orangeTint(12), color: 'var(--color-text)', border: '1px solid var(--color-brand-orange)' } : { ...surface, color: 'var(--color-text-muted)' }}>
                        {SENIORITIES[s]}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
              <div className="pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                <Toggle label="E-mail disponible seulement" checked={criteria.emailOnly ?? false} onChange={v => setCriteria(c => ({ ...c, emailOnly: v }))} />
                <Toggle label="Mis à jour depuis moins de 6 mois" checked={criteria.recentOnly ?? false} onChange={v => setCriteria(c => ({ ...c, recentOnly: v }))} />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => relaunch(1)} disabled={busy || !configured || Boolean(missing)}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40"
                  style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  {results ? 'Relancer' : 'Rechercher'}
                </button>
                <button type="button" disabled={!currentEntry || historyBusy || busy}
                  onClick={() => currentEntry && (currentEntry.pinned ? pin(currentEntry.id, false) : setNaming(n => (n === null ? currentEntry.name : null)))}
                  aria-pressed={currentEntry?.pinned ?? false}
                  aria-label={currentEntry?.pinned ? 'Retirer des recherches enregistrées' : 'Enregistrer cette recherche'}
                  title={!currentEntry ? 'Lancez la recherche avec ces critères pour l\'enregistrer' : currentEntry.pinned ? 'Retirer des recherches enregistrées' : 'Enregistrer cette recherche'}
                  className="inline-flex items-center justify-center w-11 rounded-xl disabled:opacity-40" style={{ ...surface, color: currentEntry?.pinned ? 'var(--color-brand-orange)' : 'var(--color-text)' }}>
                  <Bookmark className="h-4 w-4" fill={currentEntry?.pinned ? 'currentColor' : 'none'} />
                </button>
              </div>
              {missing && !busy && steps.brief !== 'run' && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{missing}</p>}
              {naming !== null && currentEntry && (
                <form className="flex items-center gap-1.5" onSubmit={ev => { ev.preventDefault(); pin(currentEntry.id, true, naming) }}>
                  <label htmlFor="mbc-save-name" className="sr-only">Nom de la recherche</label>
                  <input id="mbc-save-name" value={naming} onChange={ev => setNaming(ev.target.value)} maxLength={CRITERIA_LIMITS.item} autoFocus
                    className="flex-1 min-w-0 rounded-lg px-2 py-1.5 text-sm outline-none" style={{ ...surface, color: 'var(--color-text)' }} />
                  <button type="submit" disabled={historyBusy || !naming.trim()} className="px-2.5 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40"
                    style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
                    {historyBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Enregistrer'}
                  </button>
                  <button type="button" onClick={() => setNaming(null)} aria-label="Annuler" className="p-1 rounded" style={{ color: 'var(--color-text-muted)' }}><X className="h-3.5 w-3.5" /></button>
                </form>
              )}
              {savedNote && <p role="status" className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{savedNote}</p>}
              {history === null ? (
                <p className="text-xs pt-3" style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Historique des recherches indisponible pour le moment.</p>
              ) : (
                <>
                  {saved.length > 0 && (
                    <EntryList title="Recherches enregistrées" entries={saved} busy={busy || historyBusy} currentId={current?.id ?? null}
                      onOpen={openEntry} onRemove={e => pin(e.id, false)} removeLabel={e => `Retirer ${e.name} des recherches enregistrées`} />
                  )}
                  {recent.length > 0 && (
                    <EntryList title="Historique" entries={recent} busy={busy || historyBusy} currentId={current?.id ?? null}
                      onOpen={openEntry} onRemove={e => removeEntry(e.id)} removeLabel={e => `Supprimer ${e.name} de l'historique`} collapsed />
                  )}
                </>
              )}
            </aside>

            <section className="rounded-2xl overflow-hidden min-w-0" style={surface} aria-label="Profils" aria-busy={busy}>
              <div className="flex items-center gap-2 flex-wrap px-4 py-3">
                <div className="inline-flex rounded-lg p-0.5" style={{ background: 'var(--page-bg)' }} role="tablist" aria-label="Profils affichés">
                  {([['all', `Tous · ${results?.profiles.length ?? 0}`], ['revealed', `Révélés · ${revealedIds.length}`], ['shortlist', `Présélection · ${shortlist.length}`]] as [Tab, string][]).map(([key, label]) => (
                    <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                      className="px-2.5 py-1 rounded-md text-xs whitespace-nowrap"
                      style={tab === key ? { ...surface, color: 'var(--color-text)', fontWeight: 700 } : { color: 'var(--color-text-muted)' }}>
                      {label}
                    </button>
                  ))}
                </div>
                <span className="flex-1" />
                {selectable.length > 0 && (
                  <label className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>
                    <input type="checkbox" checked={allSelected} className="w-4 h-4 accent-[var(--color-brand-orange)]"
                      onChange={() => setSelected(allSelected ? [] : selectable.slice(0, REVEAL_BATCH))} />
                    {selected.length > 0 ? `${selected.length} sélectionné${selected.length > 1 ? 's' : ''}` : `Sélectionner (${REVEAL_BATCH} au plus)`}
                  </label>
                )}
                <button type="button" onClick={() => reveal(selected)} disabled={busy || selected.length === 0 || (quotaLeft !== null && quotaLeft < selected.length)}
                  title={quotaLeft !== null && quotaLeft < selected.length ? `Il vous reste ${quotaLeft} profil${quotaLeft > 1 ? 's' : ''} complet${quotaLeft > 1 ? 's' : ''} aujourd'hui.` : undefined}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40 whitespace-nowrap"
                  style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
                  <UserRound className="h-3.5 w-3.5" /> {revealSelectionLabel(selected.length)}
                </button>
              </div>

              {!results && tab === 'all' ? (
                <p className="px-6 pb-10 pt-6 text-center text-sm" style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)' }}>
                  {busy ? 'Recherche en cours…' : 'Vérifiez les critères puis lancez la recherche.'}
                </p>
              ) : listed.length === 0 ? (
                <p className="px-6 pb-10 pt-6 text-center text-sm" style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)' }}>
                  {tab === 'revealed' ? 'Aucun profil révélé pour le moment.'
                    : tab === 'shortlist' ? 'Aucun profil présélectionné : cliquez sur l’étoile d’un profil.'
                      : hiddenByRecent > 0 ? 'Aucun profil récent sur cette page : décochez « Mis à jour depuis moins de 6 mois » ou passez à la page suivante.'
                        : 'Aucun profil pour ces critères. Retirez un lieu, une séniorité ou une compétence obligatoire.'}
                </p>
              ) : (
                <ul style={{ opacity: busy ? 0.5 : 1 }}>
                  {listed.map(p => (
                    <ResultRow key={p.id} p={p} criteria={criteria} reveal={reveals[p.id]} active={p.id === activeId} busy={busy}
                      selected={selected.includes(p.id)} shortlisted={shortlist.includes(p.id)} inVivier={Object.keys(added[p.id] ?? {}).length > 0}
                      onOpen={() => openProfile(p.id)} onSelect={() => setSelected(s => (s.includes(p.id) ? s.filter(x => x !== p.id) : s.length < REVEAL_BATCH ? [...s, p.id] : s))}
                      onShortlist={() => toggleShortlist(p.id)} onReveal={() => reveal([p.id])} />
                  ))}
                </ul>
              )}

              {results && tab === 'all' && results.profiles.length > 0 && (
                <nav className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 text-xs" style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }} aria-label="Pages de résultats">
                  <span>
                    Page {results.page} sur {lastPage} · classés par score{hiddenByRecent > 0 ? ` · ${hiddenByRecent} profil${hiddenByRecent > 1 ? 's' : ''} ancien${hiddenByRecent > 1 ? 's' : ''} masqué${hiddenByRecent > 1 ? 's' : ''}` : ''} · nom de famille masqué tant que le profil n’est pas révélé
                  </span>
                  {lastPage > 1 && (
                    <span className="flex gap-2">
                      <button type="button" onClick={() => relaunch(results.page - 1)} disabled={busy || results.page <= 1}
                        className="px-3 py-1.5 rounded-lg font-semibold disabled:opacity-40" style={{ ...surface, color: 'var(--color-text)' }}>Précédente</button>
                      <button type="button" onClick={() => relaunch(results.page + 1)} disabled={busy || results.page >= lastPage}
                        className="px-3 py-1.5 rounded-lg font-semibold disabled:opacity-40" style={{ ...surface, color: 'var(--color-text)' }}>Suivante</button>
                    </span>
                  )}
                </nav>
              )}
            </section>

            {/* Profil choisi : colonne collée à droite sur très grand écran, fenêtre plein écran en dessous. */}
            <aside aria-label="Profil choisi"
              className={`${panelOpen && active ? 'fixed inset-0 z-50 overflow-y-auto p-4' : 'hidden'} xl:block xl:p-0 xl:sticky xl:inset-auto xl:top-24 xl:overflow-visible xl:z-auto`}
              style={panelOpen && active ? { background: 'var(--page-bg)' } : undefined}>
              {active ? (
                <ProfilePanel key={active.id} profile={active} reveal={reveals[active.id]} criteria={criteria} brief={brief} jobs={jobs}
                  shortlisted={shortlist.includes(active.id)} added={added[active.id] ?? {}} canReveal={!busy && (quotaLeft === null || quotaLeft > 0)}
                  onReveal={() => reveal([active.id])} onShortlist={() => toggleShortlist(active.id)}
                  onAdded={target => setAdded(a => ({ ...a, [active.id]: { ...a[active.id], [target]: true } }))}
                  onClose={() => setPanelOpen(false)} />
              ) : (
                <div className="hidden xl:block rounded-2xl p-6 text-sm text-center" style={{ ...surface, color: 'var(--color-text-muted)' }}>
                  Choisissez un profil dans la liste pour voir le détail de son score et le révéler.
                </div>
              )}
            </aside>
          </div>

          <p className="text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
            Source : Apollo.io. Un profil complet (nom entier, e-mail professionnel, LinkedIn, lieu, parcours) coûte un crédit Apollo par profil trouvé. Un profil révélé est gardé 90 jours pour votre organisation (il ne coûte pas de second crédit), puis supprimé ; vos critères et votre brief restent dans votre historique : utilisez ces données pour un recrutement, conformément au RGPD.
          </p>
        </div>
      )}
    </div>
  )
}
