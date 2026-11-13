'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Bookmark, Loader2, Plus, Radar, X } from 'lucide-react'
import {
  analyseMbcBrief, askMbcQuestions, deleteMbcSearchEntry, pinMbcSearch, refineMbcSearch, revealMbcProfiles, saveMbcPerson, searchMbcProfiles,
  unsaveMbcPerson,
} from './actions'
import {
  CRITERIA_LIMITS, EMPTY_CRITERIA, MAX_PAGE, PAGE_SIZE, REVEAL_BATCH, criteriaProblem, savedSearchName, scoreProfile, type MbcCriteria,
  type ScoredProfile,
} from '@/lib/mbc-search/rules'
import { QUESTION_LIMITS, answerText, type MbcAnswer, type MbcQuestion } from '@/lib/mbc-search/conversation'
import type { MbcSearchEntry } from '@/lib/mbc-search/history'
import type { MbcSavedPerson } from '@/lib/mbc-search/saved'
import { ProfilePanel, type Added } from './mbc-profile-panel'
import { ErrorNote, surface, type Reveal, type SaveButton } from './mbc-search-ui'
import { MbcSearchHome } from './mbc-search-home'
import { AssistantMessage, ProgressSteps, PromptBox, QuestionCard, UserBubble } from './mbc-search-thread'
import { CriteriaEditor, ResultRow, ResultsBlock } from './mbc-search-results'

// MBC Search en conversation (demande du 2026-11-13, à la place du brief puis de l'espace de travail en trois colonnes) :
// l'accueil (mbc-search-home.tsx) reçoit le besoin ; dans le fil, l'IA pose au plus 3 questions à choix (sauf
// « Recherche directe »), tire les critères du besoin et des réponses, cherche chez Apollo et affiche les profils
// classés ; chaque message du recruteur sous les résultats ajuste les critères et relance. Onglet « Sélection » : les
// personnes enregistrées. Profil choisi : colonne de droite dès 1280 px, fenêtre plein écran en dessous.
// La conversation n'est pas enregistrée : seul l'historique des recherches (brief et critères) l'est, par le serveur.

/** Entrée du fil. Seul le dernier `results` affiche la liste des profils ; les précédents ne sont plus qu'un rappel. */
type Msg =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant'; text: string }
  | { id: number; kind: 'error'; text: string; offer?: 'direct' | 'manual' }
  | { id: number; kind: 'results'; total: number; label: string }
type NewMsg = { [K in Msg['kind']]: Omit<Extract<Msg, { kind: K }>, 'id'> }[Msg['kind']]

type Tab = 'search' | 'selection'

const OFFLINE = 'Le serveur ne répond pas : vérifiez votre connexion puis réessayez.'
const SEARCH_STEP = 'Recherche des profils et classement'

const withEntry = (list: MbcSearchEntry[], entry: MbcSearchEntry) => [entry, ...list.filter(e => e.id !== entry.id)]

export function MbcSearchClient({ firstName, configured, revealUsage, jobs, history, savedPeople }: {
  /** Prénom du recruteur, pour la salutation de l'accueil. */
  firstName: string
  configured: boolean
  /** Profils complets révélés aujourd'hui par l'organisation, sur sa limite ; null si illisible. */
  revealUsage: { used: number; limit: number } | null
  /** Offres ouvertes de l'organisation, pour « Associer à une offre » ; null si illisibles. */
  jobs: { id: string; title: string }[] | null
  /** Historique des recherches du recruteur, plus récente d'abord ; null si indisponible. */
  history: MbcSearchEntry[] | null
  /** Personnes enregistrées par le recruteur, la plus récente d'abord ; null si indisponibles. */
  savedPeople: MbcSavedPerson[] | null
}) {
  const [view, setView] = useState<'home' | 'chat'>('home')
  const [tab, setTab] = useState<Tab>('search')
  const [direct, setDirect] = useState(false)
  const [filters, setFilters] = useState({ emailOnly: false, recentOnly: false })
  const [brief, setBrief] = useState('')
  const [criteria, setCriteria] = useState<MbcCriteria>(EMPTY_CRITERIA)
  const [messages, setMessages] = useState<Msg[]>([])
  const [questions, setQuestions] = useState<MbcQuestion[] | null>(null)
  const [progress, setProgress] = useState<{ steps: string[]; at: number } | null>(null)
  const [results, setResults] = useState<{ profiles: ScoredProfile[]; total: number; page: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  // Erreur d'une action sur un profil (révéler, enregistrer) : bandeau sous l'en-tête, hors du fil.
  const [notice, setNotice] = useState<string | null>(null)
  // Profils complets déjà révélés, par identifiant Apollo : gardés d'une page à l'autre (déjà payés). Les personnes
  // enregistrées le sont d'emblée : leur profil complet est gardé avec elles.
  const [reveals, setReveals] = useState<Record<string, Reveal>>(
    () => Object.fromEntries((savedPeople ?? []).map(s => [s.profile.id, { state: 'done', profile: s.profile } as Reveal])),
  )
  // Profils vus pendant la visite (toutes pages) : le panneau d'un profil reste ouvrable après un changement de page.
  const [seen, setSeen] = useState<Record<string, ScoredProfile>>({})
  const [savedPersons, setSavedPersons] = useState<MbcSavedPerson[]>(savedPeople ?? [])
  const [saving, setSaving] = useState<string[]>([])
  // Une personne enregistrée absente des résultats est notée selon les critères affichés, avec la ligne de recherche
  // gardée à son enregistrement ; « récent » se mesure à l'ouverture de la page.
  const [openedAt] = useState(() => new Date())
  const [selected, setSelected] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [added, setAdded] = useState<Record<string, Added>>({})
  const [revealUsed, setRevealUsed] = useState(revealUsage?.used ?? null)
  const [entries, setEntries] = useState<MbcSearchEntry[]>(history ?? [])
  // Ligne de l'historique de la dernière recherche lancée, et ses critères (pour savoir s'ils ont changé depuis).
  const [current, setCurrent] = useState<{ id: string; criteria: string } | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const [historyNote, setHistoryNote] = useState<string | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)

  const nextId = useRef(0)
  // Réponses données aux questions de la conversation en cours : gardées si la lecture du besoin échoue ensuite, pour
  // que le besoin complété dans le champ du bas les reprenne.
  const answered = useRef<MbcAnswer[]>([])
  const endRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const push = (...items: NewMsg[]) => setMessages(list => [...list, ...items.map(m => ({ ...m, id: ++nextId.current }) as Msg)])

  // Chaque nouvelle entrée du fil est amenée à l'écran : le haut des profils quand ils arrivent, sinon le bas du fil.
  const lastKind = messages.at(-1)?.kind
  useEffect(() => {
    if (view !== 'chat' || tab !== 'search') return
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    if (lastKind === 'results' && !progress && !questions) resultsRef.current?.scrollIntoView({ block: 'start', behavior })
    else endRef.current?.scrollIntoView({ block: 'end', behavior })
  }, [messages.length, lastKind, questions, progress, view, tab])

  /** Une étape de la conversation : occupée pendant le travail, erreur réseau (Server Action injoignable) dans le fil. */
  const guarded = async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
    } catch {
      push({ kind: 'error', text: OFFLINE })
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const resetConversation = () => {
    answered.current = []
    setMessages([])
    setQuestions(null)
    setResults(null)
    setEditing(false)
    setCurrent(null)
    setNaming(null)
    setSelected([])
    setPanelOpen(false)
    setActiveId(null)
    setNotice(null)
  }

  /** Recherche Apollo puis classement ; `newRun` : nouvelle recherche dans le fil (sinon : autre page de la même). */
  const searchStep = async (c: MbcCriteria, page: number, b: string, newRun: boolean): Promise<boolean> => {
    const res = await searchMbcProfiles(c, page, b)
    if (res.error) {
      push({ kind: 'error', text: res.error })
      return false
    }
    const profiles = res.profiles ?? []
    const total = res.total ?? 0
    setResults({ profiles, total, page })
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
      setHistoryNote(res.historyError ?? null)
    }
    setSeen(s => ({ ...s, ...Object.fromEntries(profiles.map(p => [p.id, p])) }))
    setSelected([])
    if (newRun) {
      push({ kind: 'results', total, label: savedSearchName(c) })
      setEditing(false)
      setPanelOpen(false)
    }
    return true
  }

  /** Critères tirés du besoin (et des réponses aux questions), avec les filtres choisis à l'accueil, puis recherche. */
  const analyseAndSearch = async (b: string, answers: MbcAnswer[]) => {
    setProgress({ steps: ['Lecture de votre besoin', SEARCH_STEP], at: 0 })
    const res = await analyseMbcBrief(b, answers)
    if (res.error || !res.criteria) {
      push({ kind: 'error', text: res.error ?? 'L\'IA n\'a pas pu lire le besoin.', offer: 'manual' })
      return
    }
    const c = { ...res.criteria, emailOnly: filters.emailOnly, recentOnly: filters.recentOnly }
    setCriteria(c)
    setProgress({ steps: ['Lecture de votre besoin', SEARCH_STEP], at: 1 })
    await searchStep(c, 1, b, true)
  }

  /** Envoi du besoin depuis l'accueil : début d'une nouvelle conversation. */
  const start = (text: string) => {
    const b = text.trim()
    resetConversation()
    setBrief(b)
    // Filtres de l'accueil gardés même si l'IA échoue et que le recruteur saisit ses critères à la main.
    setCriteria({ ...EMPTY_CRITERIA, ...filters })
    setView('chat')
    setTab('search')
    push({ kind: 'user', text: b })
    void guarded(async () => {
      if (direct) {
        await analyseAndSearch(b, [])
        return
      }
      setProgress({ steps: ['Lecture de votre besoin'], at: 0 })
      const res = await askMbcQuestions(b)
      if (res.error) {
        push({ kind: 'error', text: res.error, offer: 'direct' })
        return
      }
      const asked = res.questions ?? []
      if (asked.length > 0) {
        push({ kind: 'assistant', text: res.reply || 'Quelques précisions avant de chercher :' })
        setQuestions(asked)
        return
      }
      // Besoin assez précis : pas de question, la recherche part.
      push({ kind: 'assistant', text: res.reply || 'Votre besoin est clair : je lance la recherche.' })
      await analyseAndSearch(b, [])
    })
  }

  const submitAnswers = (answers: MbcAnswer[]) => {
    setQuestions(null)
    const given = answers.filter(a => answerText(a))
    answered.current = given
    push({ kind: 'user', text: given.length > 0 ? given.map(answerText).join(' · ') : 'Pas de précision : lancez la recherche.' })
    void guarded(() => analyseAndSearch(brief, given))
  }

  /** Message sous les résultats : l'IA ajuste les critères, puis la recherche est relancée. */
  const refine = (message: string) => {
    push({ kind: 'user', text: message })
    void guarded(async () => {
      setProgress({ steps: ['Ajustement des critères', SEARCH_STEP], at: 0 })
      const res = await refineMbcSearch({ brief, criteria, message })
      if (res.error || !res.criteria) {
        push({ kind: 'error', text: res.error ?? 'L\'IA n\'a pas pu ajuster la recherche.' })
        return
      }
      if (res.reply) push({ kind: 'assistant', text: res.reply })
      setCriteria(res.criteria)
      setProgress({ steps: ['Ajustement des critères', SEARCH_STEP], at: 1 })
      await searchStep(res.criteria, 1, brief, true)
    })
  }

  /** Champ du bas : ajuste la recherche ; sans critères encore (lecture du besoin en échec), complète le besoin. */
  const sendFromComposer = (text: string) => {
    if (!criteriaProblem(criteria)) {
      refine(text)
      return
    }
    const b = `${brief}\n${text}`.trim().slice(0, CRITERIA_LIMITS.brief)
    setBrief(b)
    push({ kind: 'user', text })
    void guarded(() => analyseAndSearch(b, answered.current))
  }

  /** Critères modifiés à la main (ou saisis sans brief) : nouvelle recherche dans le fil. */
  const runEdited = () => {
    push({ kind: 'assistant', text: 'Je relance la recherche avec vos critères.' })
    void guarded(async () => {
      setProgress({ steps: [SEARCH_STEP], at: 0 })
      await searchStep(criteria, 1, brief, true)
    })
  }

  const goToPage = (page: number) => {
    void guarded(async () => {
      if (await searchStep(criteria, page, brief, false)) resultsRef.current?.scrollIntoView({ block: 'start' })
    })
  }

  /** Après un échec de l'IA : recherche sans questions, ou critères saisis à la main. */
  const takeOffer = (offer: 'direct' | 'manual') => {
    if (offer === 'direct') void guarded(() => analyseAndSearch(brief, answered.current))
    else setEditing(true)
  }

  const startManual = () => {
    resetConversation()
    setBrief('')
    setCriteria({ ...EMPTY_CRITERIA, ...filters })
    setView('chat')
    setTab('search')
    push({ kind: 'assistant', text: 'Renseignez vos critères ci-dessous, puis lancez la recherche.' })
    setEditing(true)
  }

  const openEntry = (e: MbcSearchEntry) => {
    resetConversation()
    setBrief(e.brief)
    setCriteria(e.criteria)
    setView('chat')
    setTab('search')
    push({ kind: 'user', text: e.brief || e.name })
    if (criteriaProblem(e.criteria)) {
      push({ kind: 'assistant', text: 'Complétez les critères de cette recherche, puis relancez-la.' })
      setEditing(true)
      return
    }
    push({ kind: 'assistant', text: `Je relance votre recherche « ${e.name} ».` })
    void guarded(async () => {
      setProgress({ steps: [SEARCH_STEP], at: 0 })
      await searchStep(e.criteria, 1, e.brief, true)
    })
  }

  /** Profil complet (payant) des profils demandés ; ceux déjà révélés ou en cours ne sont pas redemandés. */
  const reveal = async (ids: string[]) => {
    const wanted = ids.filter(id => !reveals[id]).slice(0, REVEAL_BATCH)
    if (wanted.length === 0) return
    setNotice(null)
    setReveals(r => ({ ...r, ...Object.fromEntries(wanted.map(id => [id, { state: 'loading' } as Reveal])) }))
    const forget = () => setReveals(r => Object.fromEntries(Object.entries(r).filter(([id]) => !wanted.includes(id))))
    try {
      const res = await revealMbcProfiles(wanted)
      if (res.error || !res.profiles) {
        forget()
        setNotice(res.error ?? 'Profils indisponibles pour le moment.')
        return
      }
      // Places du quota prises par le serveur : une par profil payé, trouvé ou non (un profil déjà révélé n'en prend pas).
      const charged = res.charged ?? wanted.length
      setRevealUsed(u => (u === null ? null : u + charged))
      if (res.notKept) setNotice(res.notKept)
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
      setNotice(OFFLINE)
    }
  }

  const savedById = new Map(savedPersons.map(s => [s.profile.id, s]))
  const profileOf = (id: string): ScoredProfile | undefined => {
    const s = savedById.get(id)
    return seen[id] ?? (s ? scoreProfile(s.search, criteria, openedAt) : undefined)
  }

  /**
   * « Enregistrer » : révèle la personne si besoin (1 crédit, sauf profil déjà révélé par l'organisation) et la garde
   * dans la sélection du recruteur ; sur une personne enregistrée, la retire (son profil reste affiché).
   */
  const toggleSave = async (id: string) => {
    const p = profileOf(id)
    if (!p || saving.includes(id)) return
    const wasRevealed = reveals[id]?.state === 'done'
    const forgetLoading = () => setReveals(r => Object.fromEntries(Object.entries(r).filter(([k, v]) => k !== id || v.state !== 'loading')))
    setNotice(null)
    setSaving(s => [...s, id])
    try {
      if (savedById.has(id)) {
        const res = await unsaveMbcPerson(id)
        if (res.error) { setNotice(res.error); return }
        // Encore révélée pour la visite : sa ligne et son panneau restent ouvrables.
        setSeen(s => (s[id] ? s : { ...s, [id]: p }))
        setSavedPersons(list => list.filter(s => s.profile.id !== id))
        return
      }
      // Révélation en cours : « Révéler » et « Révéler la sélection » l'écartent, sinon la personne serait payée deux fois.
      if (!wasRevealed) setReveals(r => ({ ...r, [id]: { state: 'loading' } }))
      const res = await saveMbcPerson({
        id: p.id, firstName: p.firstName, lastNameMasked: p.lastNameMasked, title: p.title, company: p.company,
        hasEmail: p.hasEmail, hasPhone: p.hasPhone, refreshedAt: p.refreshedAt,
      })
      const charged = res.charged ?? 0
      if (charged > 0) setRevealUsed(u => (u === null ? null : u + charged))
      const full = res.saved?.profile ?? res.revealed
      if (full) setReveals(r => ({ ...r, [id]: { state: 'done', profile: full } }))
      else if (res.missing) setReveals(r => ({ ...r, [id]: { state: 'missing' } }))
      else if (!wasRevealed) forgetLoading()
      if (full || res.missing) setSelected(s => s.filter(x => x !== id))
      const entry = res.saved
      if (entry) setSavedPersons(list => [entry, ...list.filter(s => s.profile.id !== id)])
      if (res.error) setNotice(res.error)
    } catch {
      if (!wasRevealed) forgetLoading()
      setNotice(OFFLINE)
    } finally {
      setSaving(s => s.filter(x => x !== id))
    }
  }

  /** Enregistre la recherche lancée sous un nom, ou la retire des recherches enregistrées (elle reste dans l'historique). */
  const pin = async (id: string, pinned: boolean, name?: string) => {
    setHistoryBusy(true)
    setHistoryNote(null)
    try {
      const res = await pinMbcSearch({ id, pinned, name })
      if (res.error || !res.entry) { setHistoryNote(res.error ?? 'Enregistrement impossible.'); return }
      const entry = res.entry
      setEntries(list => list.map(e => (e.id === entry.id ? entry : e)))
      setNaming(null)
      if (pinned) setHistoryNote(`Recherche « ${entry.name} » enregistrée.`)
    } catch {
      setHistoryNote(OFFLINE)
    } finally {
      setHistoryBusy(false)
    }
  }
  const removeEntry = async (e: MbcSearchEntry) => {
    if (e.pinned) {
      await pin(e.id, false)
      return
    }
    setHistoryBusy(true)
    setHistoryNote(null)
    try {
      const res = await deleteMbcSearchEntry(e.id)
      if (res.error) { setHistoryNote(res.error); return }
      setEntries(list => list.filter(x => x.id !== e.id))
      if (current?.id === e.id) setCurrent(null)
    } catch {
      setHistoryNote(OFFLINE)
    } finally {
      setHistoryBusy(false)
    }
  }

  const quotaLeft = revealUsage && revealUsed !== null ? Math.max(0, revealUsage.limit - revealUsed) : null
  /** Bouton « Enregistrer » d'une personne : sans profil révélé, il en révèle un et prend donc une place du quota. */
  const saveButton = (id: string): SaveButton => {
    const isSaved = savedById.has(id)
    const r = reveals[id]
    const reason = savedPeople === null ? 'Enregistrement des personnes indisponible pour le moment.'
      : isSaved ? null
        : r?.state === 'missing' ? 'Apollo ne trouve pas le profil complet de cette personne.'
          : r?.state !== 'done' && quotaLeft !== null && quotaLeft <= 0 ? 'Plus de profil complet disponible aujourd’hui.'
            : null
    return {
      saved: isSaved,
      saving: saving.includes(id),
      disabled: reason !== null || saving.includes(id) || r?.state === 'loading',
      reason,
      onToggle: () => toggleSave(id),
    }
  }
  const openProfile = (id: string) => { setActiveId(id); setPanelOpen(true) }
  const toggleSelected = (id: string) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : s.length < REVEAL_BATCH ? [...s, id] : s))
  const row = (p: ScoredProfile) => (
    <ResultRow key={p.id} p={p} criteria={criteria} reveal={reveals[p.id]} active={panelOpen && p.id === activeId} busy={busy}
      selected={selected.includes(p.id)} save={saveButton(p.id)} inVivier={Object.keys(added[p.id] ?? {}).length > 0}
      onOpen={() => openProfile(p.id)} onSelect={() => toggleSelected(p.id)} onReveal={() => reveal([p.id])} />
  )

  const problem = criteriaProblem(criteria)
  const lastResultsId = [...messages].reverse().find(m => m.kind === 'results')?.id ?? null
  // Les propositions d'une erreur (« sans questions », « à la main ») ne valent que tant qu'elle est le dernier message.
  const lastId = messages.at(-1)?.id ?? null
  const listed = (results?.profiles ?? []).filter(p => !criteria.recentOnly || p.match.fresh)
  const hiddenByRecent = criteria.recentOnly ? (results?.profiles.length ?? 0) - listed.length : 0
  const lastPage = results ? Math.min(MAX_PAGE, Math.ceil(results.total / PAGE_SIZE)) : 0
  const savedListed = savedPersons.map(s => profileOf(s.profile.id)).filter((p): p is ScoredProfile => Boolean(p))
  const active = panelOpen && activeId ? profileOf(activeId) : undefined
  // La recherche affichée peut être enregistrée tant que ses critères n'ont pas changé depuis son lancement.
  const currentEntry = current && current.criteria === JSON.stringify(criteria) ? entries.find(e => e.id === current.id) ?? null : null
  const conversationTitle = !problem ? savedSearchName(criteria) : brief ? (brief.length > 60 ? `${brief.slice(0, 60)}…` : brief) : null
  const title = conversationTitle ?? (messages.length === 0 ? 'Votre sélection' : 'Nouvelle recherche')
  const lastSpoken = [...messages].reverse().find(m => m.kind === 'assistant' || m.kind === 'error')
  const status = progress ? `${progress.steps[progress.at]}…` : lastSpoken && 'text' in lastSpoken ? lastSpoken.text : ''

  const editor = (
    <CriteriaEditor criteria={criteria} onChange={setCriteria} onRun={runEdited} running={busy} disabled={busy || !configured}
      problem={problem} runLabel={results ? 'Relancer' : 'Rechercher'} />
  )

  // Jauge du jour : dès 1280 px (en dessous, l'en-tête n'a pas la place ; le coût est rappelé sur chaque bouton « Révéler »).
  const gauge = revealUsage && revealUsed !== null && (
    <span className="hidden xl:inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs whitespace-nowrap" style={{ ...surface, color: 'var(--color-text-muted)' }}
      title="Chaque profil complet coûte un crédit Apollo à la plateforme. Le compteur repart à zéro chaque jour (minuit UTC).">
      Profils complets aujourd&apos;hui
      <span className="w-14 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }} aria-hidden>
        <span className="block h-full" style={{ width: `${Math.min(100, (revealUsed / revealUsage.limit) * 100)}%`, background: 'var(--color-brand-orange)' }} />
      </span>
      <strong style={{ color: 'var(--color-text)' }}>{revealUsed} / {revealUsage.limit}</strong>
    </span>
  )

  if (view === 'home') {
    return (
      <div className="min-h-[calc(100vh-68px)]" style={{ background: 'var(--color-surface)' }}>
        <header className="flex items-center gap-3 px-4 sm:px-6 h-16">
          <Radar className="h-5 w-5" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />
          <span className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>MBC Search</span>
          <span className="flex-1" />
          {gauge}
          <button type="button" onClick={() => { setView('chat'); setTab('selection') }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold" style={{ ...surface, color: 'var(--color-text)' }}>
            <Bookmark className="h-4 w-4" fill="currentColor" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />
            Sélection{savedPeople === null ? '' : ` · ${savedPersons.length}`}
          </button>
        </header>
        <MbcSearchHome firstName={firstName} configured={configured} direct={direct} onDirect={setDirect} filters={filters} onFilters={setFilters}
          entries={entries} historyAvailable={history !== null} historyBusy={historyBusy} historyNote={historyNote}
          resumeTitle={messages.some(m => m.kind === 'user') ? conversationTitle ?? 'Recherche en cours' : null}
          onStart={start} onManual={startManual} onOpenEntry={openEntry} onRemoveEntry={e => { void removeEntry(e) }} onResume={() => { setView('chat'); setTab('search') }} />
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-68px)] flex flex-col" style={{ background: 'var(--color-surface)' }}>
      <header className="px-4 sm:px-6 pt-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-3 min-h-10">
          <button type="button" onClick={() => setView('home')} disabled={busy} aria-label="Retour à l’accueil de MBC Search" title="Accueil de MBC Search"
            className="inline-flex items-center justify-center w-9 h-9 rounded-xl shrink-0 disabled:opacity-40 hover:bg-[var(--color-background)]" style={{ ...surface, color: 'var(--color-text)' }}>
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="min-w-0 truncate" style={{ color: 'var(--color-text)', fontWeight: 300, fontSize: '1.25rem', lineHeight: 1.4 }}>{title}</h1>
          {currentEntry && (
            <button type="button" disabled={historyBusy || busy}
              onClick={() => (currentEntry.pinned ? pin(currentEntry.id, false) : setNaming(n => (n === null ? currentEntry.name : null)))}
              aria-pressed={currentEntry.pinned} aria-label={currentEntry.pinned ? 'Retirer des recherches enregistrées' : 'Enregistrer cette recherche'}
              title={currentEntry.pinned ? 'Retirer des recherches enregistrées' : 'Enregistrer cette recherche'}
              className="inline-flex items-center justify-center w-9 h-9 rounded-xl shrink-0 disabled:opacity-40 hover:bg-[var(--color-background)]"
              style={{ color: currentEntry.pinned ? 'var(--color-brand-orange)' : 'var(--color-text-muted)' }}>
              <Bookmark className="h-4 w-4" fill={currentEntry.pinned ? 'currentColor' : 'none'} />
            </button>
          )}
          <span className="flex-1" />
          {gauge}
          <button type="button" onClick={() => setView('home')} disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl text-sm font-bold shrink-0 disabled:opacity-40"
            style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
            <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nouvelle recherche</span><span className="sm:hidden">Nouvelle</span>
          </button>
        </div>
        {naming !== null && currentEntry && (
          <form className="flex items-center gap-1.5 mt-2 max-w-md" onSubmit={ev => { ev.preventDefault(); void pin(currentEntry.id, true, naming) }}>
            <label htmlFor="mbc-save-name" className="sr-only">Nom de la recherche</label>
            <input id="mbc-save-name" value={naming} onChange={ev => setNaming(ev.target.value)} maxLength={CRITERIA_LIMITS.item} autoFocus
              className="flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-sm outline-none" style={{ ...surface, color: 'var(--color-text)' }} />
            <button type="submit" disabled={historyBusy || !naming.trim()} className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40"
              style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
              {historyBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Enregistrer'}
            </button>
            <button type="button" onClick={() => setNaming(null)} aria-label="Annuler" className="p-1.5 rounded" style={{ color: 'var(--color-text-muted)' }}><X className="h-3.5 w-3.5" /></button>
          </form>
        )}
        {historyNote && <p role="status" className="text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>{historyNote}</p>}
        <div role="tablist" aria-label="MBC Search" className="flex gap-6 mt-2">
          {([['search', 'Recherche'], ['selection', `Sélection${savedPeople === null ? '' : ` · ${savedPersons.length}`}`]] as [Tab, string][]).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
              className="relative py-2.5 text-sm" style={{ color: tab === key ? 'var(--color-text)' : 'var(--color-text-muted)', fontWeight: tab === key ? 600 : 500 }}>
              {label}
              {tab === key && <span aria-hidden className="absolute left-0 right-0 bottom-0 h-0.5 rounded-full" style={{ background: 'var(--color-brand-orange)' }} />}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 flex items-start">
        <div className="flex-1 min-w-0 flex flex-col min-h-[calc(100vh-180px)]">
          {notice && (
            <div className="max-w-4xl w-full mx-auto px-4 sm:px-6 pt-4">
              <ErrorNote>
                <span className="flex-1">{notice}</span>
                <button type="button" onClick={() => setNotice(null)} aria-label="Fermer le message" className="rounded p-0.5" style={{ color: 'var(--color-text-muted)' }}><X className="h-4 w-4" /></button>
              </ErrorNote>
            </div>
          )}

          {tab === 'search' ? (
            <>
              <div className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
                {messages.length === 0 && (
                  <div className="py-16 text-center space-y-3">
                    <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Aucune recherche en cours.</p>
                    <button type="button" onClick={() => setView('home')} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold"
                      style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
                      <Plus className="h-4 w-4" /> Nouvelle recherche
                    </button>
                  </div>
                )}
                {messages.map(m => {
                  if (m.kind === 'user') return <UserBubble key={m.id}>{m.text}</UserBubble>
                  if (m.kind === 'assistant') return <AssistantMessage key={m.id} text={m.text} />
                  if (m.kind === 'error') {
                    return (
                      <AssistantMessage key={m.id}>
                        <ErrorNote>{m.text}</ErrorNote>
                        {m.offer && m.id === lastId && (
                          <button type="button" onClick={() => takeOffer(m.offer ?? 'manual')} disabled={busy}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold disabled:opacity-40" style={{ ...surface, color: 'var(--color-text)' }}>
                            {m.offer === 'direct' ? 'Lancer la recherche sans questions' : 'Renseigner les critères vous-même'}
                          </button>
                        )}
                      </AssistantMessage>
                    )
                  }
                  if (m.id !== lastResultsId || !results) {
                    return (
                      <AssistantMessage key={m.id}>
                        <p className="text-sm rounded-xl px-4 py-2.5 inline-block" style={{ background: 'var(--color-background)', color: 'var(--color-text-muted)' }}>
                          Recherche précédente · {m.label} · {m.total.toLocaleString('fr-FR')} profil{m.total > 1 ? 's' : ''}
                        </p>
                      </AssistantMessage>
                    )
                  }
                  return (
                    <div key={m.id} ref={resultsRef} className="scroll-mt-24">
                      <ResultsBlock total={results.total} page={results.page} lastPage={lastPage} listed={listed} hiddenByRecent={hiddenByRecent}
                        criteria={criteria} busy={busy} editing={editing} onToggleEditing={() => setEditing(v => !v)} editor={editor}
                        selectable={listed.filter(p => !reveals[p.id]).map(p => p.id)} selected={selected} quotaLeft={quotaLeft}
                        renderRow={row} onSelectAll={setSelected} onRevealSelection={() => { void reveal(selected) }} onPage={goToPage} />
                    </div>
                  )
                })}
                {/* Critères saisis à la main, ou à compléter : avant toute liste de profils. */}
                {editing && !results && <div className="rounded-2xl overflow-hidden" style={surface}>{editor}</div>}
                {questions && (
                  <AssistantMessage continued={lastKind === 'assistant'}>
                    <QuestionCard questions={questions} disabled={busy} onSubmit={submitAnswers} />
                  </AssistantMessage>
                )}
                {progress && <AssistantMessage continued={lastKind === 'assistant'}><ProgressSteps steps={progress.steps} at={progress.at} /></AssistantMessage>}
                <p role="status" className="sr-only">{status}</p>
                {/* Marge du bas : le champ collé en bas d'écran ne doit pas cacher le dernier message amené à l'écran. */}
                <div ref={endRef} className="scroll-mb-36" />
              </div>

              {messages.length > 0 && (
                // Marge à droite sous 1024 px : le bouton rond de l'assistant IA est fixé en bas à droite.
                <div className="sticky bottom-0 z-10 pt-3 pb-4 px-4 sm:px-6 pr-20 lg:pr-6" style={{ background: 'var(--color-surface)' }}>
                  <div className="max-w-3xl mx-auto">
                    <PromptBox id="mbc-composer" label="Message pour ajuster la recherche" rows={2} maxLength={QUESTION_LIMITS.message} minLength={2}
                      disabled={busy || !configured || Boolean(questions)}
                      placeholder={questions ? 'Répondez à la question ci-dessus, ou passez-la.'
                        : results ? 'Dites-moi ce qui ne va pas, ce qui manque ou où chercher ensuite.'
                          : 'Précisez votre besoin…'}
                      onSend={sendFromComposer} />
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="max-w-4xl w-full mx-auto px-4 sm:px-6 py-6">
              <section className="rounded-2xl overflow-hidden" style={surface} aria-label="Personnes enregistrées">
                <p className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  <strong style={{ color: 'var(--color-text)' }}>{savedPersons.length} personne{savedPersons.length > 1 ? 's' : ''} enregistrée{savedPersons.length > 1 ? 's' : ''}</strong>
                  {' '}· révélées, gardées jusqu&apos;à ce que vous les retiriez{problem ? '' : ' · notées selon la recherche en cours'}
                </p>
                {savedPeople === null ? (
                  <p className="px-6 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)' }}>
                    Personnes enregistrées indisponibles pour le moment : la recherche fonctionne, sans elles.
                  </p>
                ) : savedListed.length === 0 ? (
                  <p className="px-6 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)' }}>
                    Aucune personne enregistrée : cliquez sur le marque-page d’un profil. Elle est révélée (1 crédit si elle ne l’est pas encore) et reste ici jusqu’à ce que vous la retiriez.
                  </p>
                ) : (
                  <ul>{savedListed.map(row)}</ul>
                )}
              </section>
            </div>
          )}

          <p className="max-w-4xl w-full mx-auto px-4 sm:px-6 pb-6 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Source : Apollo.io. Un profil complet (nom entier, e-mail professionnel, LinkedIn, lieu, parcours) coûte un crédit Apollo. Un profil révélé est gardé 90 jours pour votre organisation (sans second crédit) ; une personne enregistrée reste dans votre sélection jusqu&apos;à ce que vous la retiriez ; votre besoin et vos critères restent dans votre historique, la conversation n&apos;est pas enregistrée. Utilisez ces données pour un recrutement, conformément au RGPD.
          </p>
        </div>

        {/* Profil choisi : colonne de droite dès 1280 px, fenêtre plein écran en dessous. */}
        {active && (
          <aside aria-label="Profil choisi"
            className="fixed inset-0 z-50 overflow-y-auto p-4 xl:sticky xl:inset-auto xl:z-auto xl:w-96 xl:shrink-0 xl:top-[68px] xl:h-[calc(100vh-68px)]"
            style={{ background: 'var(--color-background)', borderLeft: '1px solid var(--color-border)' }}>
            <ProfilePanel key={active.id} profile={active} reveal={reveals[active.id]} criteria={criteria} brief={brief} jobs={jobs}
              save={saveButton(active.id)} added={added[active.id] ?? {}} canReveal={!busy && (quotaLeft === null || quotaLeft > 0)}
              onReveal={() => { void reveal([active.id]) }}
              onAdded={target => setAdded(a => ({ ...a, [active.id]: { ...a[active.id], [target]: true } }))}
              onClose={() => setPanelOpen(false)} />
          </aside>
        )}
      </div>
    </div>
  )
}
