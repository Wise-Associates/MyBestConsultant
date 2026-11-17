'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Bookmark, Loader2, Plus, Radar, X } from 'lucide-react'
import {
  analyseMbcBrief, askMbcQuestions, checkMbcPhone, deleteMbcSearchEntry, evaluateMbcProfile, openMbcDiscussion, pinMbcSearch, planMbcStrategies,
  refineMbcSearch, requestMbcPhone, revealMbcProfiles, saveMbcDiscussion, saveMbcPerson, searchMbcProfiles, similarMbcCriteria, unsaveMbcPerson,
  updateMbcFollow,
} from './actions'
import { DEFAULT_POOL_FILTERS, filterPool, poolCsv, type PoolContext, type PoolFilters } from '@/lib/mbc-search/results-view'
import {
  CRITERIA_LIMITS, EMPTY_CRITERIA, REVEAL_BATCH, criteriaProblem, savedSearchName, scoreProfile, type MbcCriteria, type MbcProfile, type ScoredProfile,
} from '@/lib/mbc-search/rules'
import { failedRun, hasMorePages, mergePool, settledRuns, type PoolProfile, type StrategyRun } from '@/lib/mbc-search/strategies'
import { QUESTION_LIMITS, answerText, type MbcAnswer, type MbcQuestion } from '@/lib/mbc-search/conversation'
import type { MbcSearchEntry } from '@/lib/mbc-search/history'
import type { DiscussionMessage, DiscussionPerson, MbcDiscussion } from '@/lib/mbc-search/discussion'
import type { MbcSavedPerson } from '@/lib/mbc-search/saved'
import { ProfilePanel, type Added } from './mbc-profile-panel'
import { ErrorNote, surface, type Evaluation, type PhoneControl, type Reveal, type SaveButton } from './mbc-search-ui'
import type { MbcPhone } from '@/lib/mbc-search/phone'
import { MbcSearchHome } from './mbc-search-home'
import { AssistantMessage, ProgressSteps, PromptBox, QuestionCard, UserBubble } from './mbc-search-thread'
import { CriteriaEditor, ResultRow, ResultsBlock } from './mbc-search-results'
import { CompareDialog } from './mbc-compare-dialog'
import { COMPARE_MAX, FOLLOW_STATUSES, countByStatus, toggleCompared, type FollowStatus, type MbcFollow } from '@/lib/mbc-search/follow'

// MBC Search en conversation (demande du 2026-11-13, à la place du brief puis de l'espace de travail en trois colonnes) :
// l'accueil (mbc-search-home.tsx) reçoit le besoin ; dans le fil, l'IA pose au plus 3 questions à choix (sauf
// « Recherche directe »), tire les critères du besoin et des réponses, cherche chez Apollo et affiche les profils
// classés ; chaque message du recruteur sous les résultats ajuste les critères et relance. Onglet « Sélection » : les
// personnes enregistrées. Profil choisi : colonne de droite dès 1280 px, fenêtre plein écran en dessous.
// L'historique des recherches (brief et critères) est tenu par le serveur ; une recherche enregistrée (marque-page) garde
// aussi sa discussion et les personnes révélées pendant celle-ci (demande du 2026-11-17, discussion.ts), mises à jour
// au fil de la conversation et rouvertes telles quelles.
// Recherche en plusieurs requêtes (ADR 0037) : la page lance les requêtes du besoin l'une après l'autre (une Server
// Action chacune, pour montrer l'avancement et pouvoir s'arrêter après celle en cours) et réunit leurs profils.

/** Entrée du fil. Seul le dernier `results` affiche la liste des profils ; les précédents ne sont plus qu'un rappel. */
type Msg =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant'; text: string }
  | { id: number; kind: 'error'; text: string; offer?: 'direct' | 'manual' }
  | { id: number; kind: 'results'; total: number; label: string }
type NewMsg = { [K in Msg['kind']]: Omit<Extract<Msg, { kind: K }>, 'id'> }[Msg['kind']]

type Tab = 'search' | 'selection'

const OFFLINE = 'Le serveur ne répond pas : vérifiez votre connexion puis réessayez.'
const PLAN_STEP = 'Préparation de plusieurs recherches'
/** Profils affichés à la fois (« Afficher 50 profils de plus ») : une recherche en réunit jusqu'à 500. */
const SHOW_STEP = 50

/** Recherche en cours ou dernière recherche du fil : ses critères, ses requêtes et leurs profils réunis. */
type Run = {
  /** Critères du recruteur au lancement : la note des profils et la suite (« Chercher plus loin »). */
  base: MbcCriteria
  brief: string
  runs: StrategyRun[]
  pool: PoolProfile[]
  running: boolean
  titleCheckFailed: boolean
  /** « Profils similaires » : la personne de départ, écartée de la liste. */
  seedId?: string
}
/** Profils révélés évalués à la fois (« Évaluer les profils révélés ») : une évaluation prend jusqu'à deux minutes. */
const EVALUATE_BATCH = 10
/** Page d'une requête à lancer. */
type Job = { index: number; page: number; query: MbcCriteria }

const withEntry = (list: MbcSearchEntry[], entry: MbcSearchEntry) => [entry, ...list.filter(e => e.id !== entry.id)]
/** Ligne de recherche d'une personne, seule envoyée au serveur avec la discussion (le profil complet y est relu). */
const searchRow = (p: MbcProfile): MbcProfile => ({
  id: p.id, firstName: p.firstName, lastNameMasked: p.lastNameMasked, title: p.title, company: p.company,
  hasEmail: p.hasEmail, hasPhone: p.hasPhone, refreshedAt: p.refreshedAt,
})
/** Entrée du fil telle qu'enregistrée : sans identifiant d'écran ni proposition d'une erreur (valable sur le moment). */
const storedMessage = (m: Msg): DiscussionMessage => (m.kind === 'results' ? { kind: 'results', total: m.total, label: m.label } : { kind: m.kind, text: m.text })
/** Personnes envoyées à chaque enregistrement, les premières révélées d'abord (le serveur en garde 50 par discussion). */
const DISCUSSION_PEOPLE_SENT = 100

export function MbcSearchClient({ firstName, configured, revealUsage, phoneIncluded, jobs, history, savedPeople }: {
  /** Prénom du recruteur, pour la salutation de l'accueil. */
  firstName: string
  configured: boolean
  /** Profils complets révélés aujourd'hui par l'organisation, sur sa limite ; null si illisible. */
  revealUsage: { used: number; limit: number } | null
  /** Téléphone des profils compris dans la formule (formules payées seulement, ADR 0042). */
  phoneIncluded: boolean
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
  const [run, setRun] = useState<Run | null>(null)
  const [shown, setShown] = useState(SHOW_STEP)
  const [listFilters, setListFilters] = useState<PoolFilters>(DEFAULT_POOL_FILTERS)
  // Évaluations par l'IA pendant la visite (relatives au besoin de la recherche affichée : vidées à chaque recherche).
  const [evaluations, setEvaluations] = useState<Record<string, Evaluation>>({})
  const [evaluating, setEvaluating] = useState<{ done: number; total: number } | null>(null)
  // Onglet « Sélection » (ADR 0039) : filtre par statut du suivi, personnes à comparer (révélées, 3 au plus).
  const [statusFilter, setStatusFilter] = useState<FollowStatus | 'all'>('all')
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)
  const [stopping, setStopping] = useState(false)
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
  // Téléphones demandés ou relus en ce moment (ADR 0042), par identifiant Apollo.
  const [phoneBusy, setPhoneBusy] = useState<string[]>([])
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
  // Recherche enregistrée dont la discussion est gardée et tenue à jour (marque-page, ou recherche rouverte).
  const [keptId, setKeptId] = useState<string | null>(null)
  // Personnes révélées pendant la conversation (« Révéler », « Enregistrer ») ou rouvertes avec elle : leur ligne de recherche.
  const [talkPeople, setTalkPeople] = useState<Record<string, MbcProfile>>({})

  const nextId = useRef(0)
  // Réponses données aux questions de la conversation en cours : gardées si la lecture du besoin échoue ensuite, pour
  // que le besoin complété dans le champ du bas les reprenne.
  const answered = useRef<MbcAnswer[]>([])
  // « Arrêter » : lu entre deux requêtes (celle en cours, une Server Action, ne s'interrompt pas).
  const stopRef = useRef(false)
  // Numéro des évaluations : changé à chaque recherche ; une évaluation finie après n'est pas reprise (autre besoin).
  const evalEpoch = useRef(0)
  // « Profils similaires » : la personne de départ, écartée de toutes les recherches de la conversation (ajustements compris).
  const seedRef = useRef<string | null>(null)
  // Personnes de la recherche affichée, sans doublon : le nombre que garde son rappel une fois remplacée dans le fil.
  const poolIds = useRef(new Set<string>())
  // Dernière discussion envoyée au serveur : rien n'est renvoyé tant qu'elle n'a pas changé. Envois l'un après l'autre
  // (un plus ancien arrivé après écraserait le plus récent) : celui qui attend, et celui qui attend la fin du délai.
  const lastKept = useRef<string | null>(null)
  const keptSaving = useRef(false)
  const keptQueued = useRef<string | null>(null)
  const keptPending = useRef<string | null>(null)
  // Message d'échec d'enregistrement affiché : retiré au premier enregistrement réussi.
  const keptError = useRef<string | null>(null)
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

  // Discussion d'une recherche enregistrée : envoyée une seconde après le dernier changement (message, critères, personne
  // révélée), et seulement si elle a changé. Échec : affiché sous l'en-tête, renvoyée au changement suivant.
  const keptPayload = keptId && messages.length > 0 ? JSON.stringify({
    id: keptId,
    discussion: { brief, criteria, messages: messages.map(storedMessage) },
    people: Object.values(talkPeople).slice(0, DISCUSSION_PEOPLE_SENT),
  }) : null
  const sendKept = (payload: string) => {
    if (keptSaving.current) {
      keptQueued.current = payload
      return
    }
    keptSaving.current = true
    lastKept.current = payload
    const fail = (text: string) => {
      lastKept.current = null
      keptError.current = text
      setHistoryNote(text)
    }
    saveMbcDiscussion(JSON.parse(payload)).then(res => {
      if (res.error) { fail(res.error); return }
      const shown = keptError.current
      keptError.current = null
      if (shown) setHistoryNote(n => (n === shown ? null : n))
    }, () => fail(OFFLINE)).finally(() => {
      keptSaving.current = false
      const next = keptQueued.current
      keptQueued.current = null
      if (next && next !== lastKept.current) sendKept(next)
    })
  }
  /** Envoie tout de suite la discussion qui attendait la fin du délai (autre discussion ouverte, page quittée). */
  const flushKept = () => {
    const pending = keptPending.current
    keptPending.current = null
    if (pending && pending !== lastKept.current) sendKept(pending)
  }
  useEffect(() => {
    if (!keptPayload || keptPayload === lastKept.current) return
    keptPending.current = keptPayload
    const timer = setTimeout(flushKept, 1000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flushKept ne lit que des refs
  }, [keptPayload])
  // Page quittée dans l'application (autre rubrique) : la dernière modification part quand même.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- au démontage seulement ; flushKept ne lit que des refs
  useEffect(() => () => flushKept(), [])

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
    // La discussion gardée qui attendait son envoi part avant d'être remplacée ; la suivante repart de zéro.
    flushKept()
    lastKept.current = null
    answered.current = []
    setMessages([])
    setQuestions(null)
    setRun(null)
    setShown(SHOW_STEP)
    setListFilters(DEFAULT_POOL_FILTERS)
    // Évaluées pour le besoin d'avant : une autre conversation, un autre besoin.
    evalEpoch.current++
    setEvaluations({})
    setEvaluating(null)
    seedRef.current = null
    setEditing(false)
    setCurrent(null)
    setNaming(null)
    setKeptId(null)
    setTalkPeople({})
    setSelected([])
    setPanelOpen(false)
    setActiveId(null)
    setNotice(null)
  }

  /**
   * Lance les pages demandées des requêtes, l'une après l'autre, et réunit leurs profils (sans doublon) au fil de l'eau.
   * « Arrêter » : après la requête en cours. Un refus qui se répéterait (`stop` : quota, clé Apollo…) arrête tout ; une
   * requête en échec n'arrête pas les autres ; aucune n'aboutit : le fil le dit. Serveur injoignable (exception) : la
   * fin du passage est faite quand même, puis l'erreur remonte à `guarded`, qui l'écrit dans le fil.
   */
  const executeRuns = async (base: MbcCriteria, b: string, jobs: Job[]) => {
    stopRef.current = false
    setStopping(false)
    setRun(r => r && { ...r, running: true })
    const update = (index: number, change: (x: StrategyRun) => StrategyRun) => setRun(r => r && { ...r, runs: r.runs.map((x, i) => (i === index ? change(x) : x)) })
    let succeeded = 0
    let firstError: string | null = null
    let blocked = false
    try {
      for (const job of jobs) {
        if (stopRef.current) break
        update(job.index, x => ({ ...x, status: 'running', error: undefined }))
        const record = job.index === 0 && job.page === 1
        const res = await searchMbcProfiles({ criteria: base, query: job.query, page: job.page, brief: b, record })
        if (res.error) {
          const error = res.error
          update(job.index, x => failedRun(x, job.page, error))
          firstError ??= error
          if (res.stop) {
            blocked = true
            push({ kind: 'error', text: error })
            break
          }
          continue
        }
        succeeded++
        const profiles = res.profiles ?? []
        // Profils déjà payés par l'organisation : affichés révélés, sans nouveau crédit ; vivier : déjà ajoutés.
        const known = res.revealed ?? []
        if (known.length > 0) setReveals(r => ({ ...r, ...Object.fromEntries(known.map(k => [k.id, { state: 'done', profile: k } as Reveal])) }))
        const inVivier = res.inVivier ?? {}
        if (Object.keys(inVivier).length > 0) {
          setAdded(a => ({ ...a, ...Object.fromEntries(Object.entries(inVivier).map(([id, targets]) => [id, { ...a[id], ...Object.fromEntries(targets.map(t => [t, true as const])) }])) }))
        }
        if (record) {
          const entry = res.entry
          setCurrent(entry ? { id: entry.id, criteria: JSON.stringify(base) } : null)
          if (entry) setEntries(list => withEntry(list, entry))
          setNaming(null)
          setHistoryNote(res.historyError ?? null)
        }
        setSeen(s => ({ ...s, ...Object.fromEntries(profiles.map(p => [p.id, p])) }))
        for (const p of profiles) poolIds.current.add(p.id)
        const total = res.total ?? 0
        setRun(r => {
          if (!r) return r
          const merged = mergePool(r.pool, profiles, job.index)
          return {
            ...r,
            pool: merged.pool,
            titleCheckFailed: r.titleCheckFailed || Boolean(res.titleCheckFailed),
            runs: r.runs.map((x, i) => (i === job.index
              ? { ...x, status: 'done', page: job.page, total, found: x.found + profiles.length, added: x.added + merged.added }
              : x)),
          }
        })
      }
      if (!blocked && succeeded === 0 && firstError) push({ kind: 'error', text: `Aucune recherche n'a abouti : ${firstError}` })
    } finally {
      // Requêtes pas encore lancées : « arrêtée » ; requête dont la réponse n'est jamais arrivée : en échec.
      setRun(r => r && { ...r, running: false, runs: settledRuns(r.runs, OFFLINE) })
      setStopping(false)
      const seed = seedRef.current
      const size = poolIds.current.size - (seed && poolIds.current.has(seed) ? 1 : 0)
      setMessages(list => {
        let last = -1
        list.forEach((m, i) => { if (m.kind === 'results') last = i })
        return list.map((m, i) => (i === last && m.kind === 'results' ? { ...m, total: size } : m))
      })
    }
  }

  /**
   * Nouvelle recherche dans le fil : requêtes du besoin (celle des critères, puis celles de l'IA), lancées l'une après
   * l'autre. `before` : étapes déjà faites de la conversation (lecture du besoin, ajustement), pour l'avancement affiché.
   */
  const runSearch = async (c: MbcCriteria, b: string, before: string[] = []) => {
    setProgress({ steps: [...before, PLAN_STEP], at: before.length })
    const plan = await planMbcStrategies({ brief: b, criteria: c })
    if (plan.error || !plan.strategies) {
      push({ kind: 'error', text: plan.error ?? 'Recherche impossible pour le moment : réessayez dans quelques instants.' })
      return
    }
    setProgress(null)
    if (plan.note) push({ kind: 'assistant', text: plan.note })
    const strategies = plan.strategies
    setRun({
      base: c, brief: b, pool: [], running: true, titleCheckFailed: false, seedId: seedRef.current ?? undefined,
      runs: strategies.map(strategy => ({ strategy, status: 'waiting', page: 0, total: 0, found: 0, added: 0 })),
    })
    setShown(SHOW_STEP)
    setListFilters(DEFAULT_POOL_FILTERS)
    evalEpoch.current++
    setEvaluations({})
    setEvaluating(null)
    setSelected([])
    setEditing(false)
    setPanelOpen(false)
    poolIds.current = new Set()
    push({ kind: 'results', total: 0, label: savedSearchName(c) })
    await executeRuns(c, b, strategies.map((s, index) => ({ index, page: 1, query: s.criteria })))
  }

  /** « Chercher plus loin » : page suivante de chaque requête qui a encore des profils chez Apollo. */
  const searchDeeper = () => {
    if (!run) return
    const { base, brief: b, runs } = run
    const jobs = runs.flatMap((r, index) => (hasMorePages(r) ? [{ index, page: r.page + 1, query: r.strategy.criteria }] : []))
    if (jobs.length > 0) void guarded(() => executeRuns(base, b, jobs))
  }

  const stopRun = () => {
    stopRef.current = true
    setStopping(true)
  }

  /** Critères tirés du besoin (et des réponses aux questions), avec les filtres choisis à l'accueil, puis recherche. */
  const analyseAndSearch = async (b: string, answers: MbcAnswer[]) => {
    setProgress({ steps: ['Lecture de votre besoin', PLAN_STEP], at: 0 })
    const res = await analyseMbcBrief(b, answers)
    if (res.error || !res.criteria) {
      push({ kind: 'error', text: res.error ?? 'L\'IA n\'a pas pu lire le besoin.', offer: 'manual' })
      return
    }
    const c = { ...res.criteria, emailOnly: filters.emailOnly, recentOnly: filters.recentOnly }
    setCriteria(c)
    await runSearch(c, b, ['Lecture de votre besoin'])
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
      setProgress({ steps: ['Ajustement des critères', PLAN_STEP], at: 0 })
      const res = await refineMbcSearch({ brief, criteria, message })
      if (res.error || !res.criteria) {
        push({ kind: 'error', text: res.error ?? 'L\'IA n\'a pas pu ajuster la recherche.' })
        return
      }
      if (res.reply) push({ kind: 'assistant', text: res.reply })
      setCriteria(res.criteria)
      await runSearch(res.criteria, brief, ['Ajustement des critères'])
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
    void guarded(() => runSearch(criteria, brief))
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

  /** Personnes révélées pendant la conversation : gardées avec sa discussion si la recherche est enregistrée. */
  const noteRevealed = (ids: string[]) => {
    const rows = ids.flatMap(id => {
      const p = profileOf(id)
      return p ? [[id, searchRow(p)] as const] : []
    })
    if (rows.length > 0) setTalkPeople(t => ({ ...t, ...Object.fromEntries(rows) }))
  }

  /** Discussion enregistrée rouverte telle quelle, avec ses personnes révélées ; la liste des profils revient sur demande. */
  const restoreDiscussion = (e: MbcSearchEntry, d: MbcDiscussion, people: DiscussionPerson[]) => {
    resetConversation()
    setBrief(d.brief)
    setCriteria(d.criteria)
    setMessages(d.messages.map(m => ({ ...m, id: ++nextId.current })))
    setKeptId(e.id)
    setTalkPeople(Object.fromEntries(people.map(p => [p.search.id, p.search])))
    setReveals(r => ({ ...r, ...Object.fromEntries(people.map(p => [p.profile.id, { state: 'done', profile: p.profile } as Reveal])) }))
    setSeen(s => ({ ...s, ...Object.fromEntries(people.map(p => [p.search.id, scoreProfile(p.search, d.criteria, openedAt)])) }))
    setView('chat')
    setTab('search')
  }

  /** Recherche de l'historique : une recherche enregistrée rouvre sa discussion ; sinon (ou rien de gardé), elle est relancée. */
  const openEntry = (e: MbcSearchEntry) => {
    if (!e.pinned) {
      relaunchEntry(e)
      return
    }
    setHistoryBusy(true)
    setHistoryNote(null)
    openMbcDiscussion(e.id).then(res => {
      if (res.error) setHistoryNote(res.error)
      else if (res.discussion) restoreDiscussion(e, res.discussion, res.people ?? [])
      else relaunchEntry(e)
    }, () => setHistoryNote(OFFLINE)).finally(() => setHistoryBusy(false))
  }

  const relaunchEntry = (e: MbcSearchEntry) => {
    resetConversation()
    // Recherche enregistrée sans discussion gardée (enregistrée avant le 2026-11-17) : cette conversation devient la sienne.
    if (e.pinned) setKeptId(e.id)
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
    void guarded(() => runSearch(e.criteria, e.brief))
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
      noteRevealed(wanted.filter(id => found.has(id)))
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

  /** Téléphone d'une personne : sur son profil révélé et sur la personne enregistrée (nouvelle version pour son suivi). */
  const applyPhone = (id: string, phone: MbcPhone, savedUpdatedAt?: string) => {
    setReveals(r => {
      const current = r[id]
      return current?.state === 'done' ? { ...r, [id]: { state: 'done', profile: { ...current.profile, phone } } } : r
    })
    setSavedPersons(list => list.map(s => (s.profile.id === id ? { ...s, profile: { ...s.profile, phone }, updatedAt: savedUpdatedAt ?? s.updatedAt } : s)))
  }
  const markPhoneBusy = (id: string, on: boolean) => setPhoneBusy(b => (on ? (b.includes(id) ? b : [...b, id]) : b.filter(x => x !== id)))
  /** Relit une demande en attente : toutes les 5 s, 2 min au plus ; ensuite « Vérifier » relance la relecture. */
  const pollPhone = (id: string, tries = 0, delayMs = 5000) => {
    markPhoneBusy(id, true)
    setTimeout(() => {
      checkMbcPhone(id).then(res => {
        if (res.phone) applyPhone(id, res.phone, res.savedUpdatedAt)
        if (res.error) setNotice(res.error)
        if (!res.error && res.phone?.status === 'pending' && tries < 23) pollPhone(id, tries + 1)
        else markPhoneBusy(id, false)
      }, () => {
        markPhoneBusy(id, false)
        setNotice(OFFLINE)
      })
    }, delayMs)
  }
  /** « Demander le téléphone » : la demande (crédits si un numéro est trouvé), puis sa relecture si Apollo cherche encore. */
  const requestPhone = async (id: string) => {
    if (phoneBusy.includes(id)) return
    markPhoneBusy(id, true)
    setNotice(null)
    try {
      const res = await requestMbcPhone(id)
      if (res.phone) applyPhone(id, res.phone, res.savedUpdatedAt)
      if (res.error) setNotice(res.error)
      if (res.phone?.status === 'pending') {
        pollPhone(id)
        return
      }
    } catch {
      setNotice(OFFLINE)
    }
    markPhoneBusy(id, false)
  }
  const phoneControl = (id: string): PhoneControl => ({
    included: phoneIncluded,
    busy: phoneBusy.includes(id),
    disabled: busy ? 'Une autre action est en cours.' : null,
    onRequest: () => { void requestPhone(id) },
    onCheck: () => pollPhone(id, 0, 0),
  })

  const savedById = new Map(savedPersons.map(s => [s.profile.id, s]))
  // Profil trouvé par plusieurs requêtes : celui de la liste réunie (la ligne affichée), pour que le panneau ait sa note.
  const poolById = new Map((run?.pool ?? []).map(p => [p.id, p]))
  const profileOf = (id: string): ScoredProfile | undefined => {
    const s = savedById.get(id)
    return poolById.get(id) ?? seen[id] ?? (s ? scoreProfile(s.search, need.criteria, openedAt) : undefined)
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
        // Plus dans la sélection : plus à comparer (et la fenêtre ne se rouvrira pas seule).
        setCompareIds(c => c.filter(x => x !== id))
        setComparing(false)
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
      if (full) noteRevealed([id])
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
    const entry = entries.find(e => e.id === id)
    if (!pinned && !window.confirm(`Retirer « ${entry?.name ?? 'cette recherche'} » des recherches enregistrées ? Sa discussion et les personnes gardées avec elle seront effacées (la recherche reste dans l’historique).`)) return
    setHistoryBusy(true)
    setHistoryNote(null)
    try {
      const res = await pinMbcSearch({ id, pinned, name })
      if (res.error || !res.entry) { setHistoryNote(res.error ?? 'Enregistrement impossible.'); return }
      const entry = res.entry
      setEntries(list => list.map(e => (e.id === entry.id ? entry : e)))
      setNaming(null)
      // Enregistrée depuis la conversation : sa discussion est gardée dès maintenant ; retirée : le serveur l'a effacée,
      // elle sera renvoyée entière si la recherche est de nouveau enregistrée.
      lastKept.current = null
      if (pinned) setKeptId(entry.id)
      else if (entry.id === keptId) setKeptId(null)
      if (pinned) setHistoryNote(`Recherche « ${entry.name} » enregistrée, avec sa discussion et les personnes révélées.`)
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

  // Besoin des évaluations et des profils similaires : celui de la recherche affichée, sinon les critères en cours
  // (onglet « Sélection » sans recherche).
  const need = run ? { criteria: run.base, brief: run.brief } : { criteria, brief }

  /**
   * « Évaluer » un profil révélé pour le besoin (une recherche du quota) : l'erreur, ou null ; `stale` : une autre
   * recherche a commencé pendant l'évaluation, son résultat (pour l'ancien besoin) est écarté.
   */
  const evaluate = async (id: string): Promise<{ stale: true } | { error: string | null }> => {
    const epoch = evalEpoch.current
    setEvaluations(e => ({ ...e, [id]: { state: 'loading' } }))
    const next: Evaluation = await evaluateMbcProfile({ id, brief: need.brief, criteria: need.criteria })
      .then((res): Evaluation => (res.evaluation
        ? { state: 'done', evaluation: res.evaluation }
        : { state: 'error', text: res.error ?? 'Évaluation indisponible pour le moment.' }))
      .catch((): Evaluation => ({ state: 'error', text: OFFLINE }))
    if (evalEpoch.current !== epoch) return { stale: true }
    setEvaluations(e => ({ ...e, [id]: next }))
    return { error: next.state === 'error' ? next.text : null }
  }

  /** « Évaluer les profils révélés » : l'un après l'autre ; un échec (quota, IA indisponible) arrête la série et s'affiche. */
  const evaluateAll = async (ids: string[]) => {
    const epoch = evalEpoch.current
    setNotice(null)
    setEvaluating({ done: 0, total: ids.length })
    try {
      for (const [i, id] of ids.entries()) {
        const res = await evaluate(id)
        if ('stale' in res) break
        if (res.error) {
          setNotice(res.error)
          break
        }
        setEvaluating({ done: i + 1, total: ids.length })
      }
    } finally {
      // Une autre recherche a commencé : elle a déjà remis l'avancement à zéro (et a pu lancer le sien).
      if (evalEpoch.current === epoch) setEvaluating(null)
    }
  }

  /**
   * « Chercher des profils similaires » : nouvelle conversation, critères tirés du profil révélé par l'IA, puis recherche
   * en plusieurs requêtes ; la personne de départ est écartée de la liste.
   */
  const startSimilar = (id: string) => {
    const r = reveals[id]
    const first = r?.state === 'done' ? r.profile.name.split(/\s+/)[0] : ''
    resetConversation()
    seedRef.current = id
    // Besoin de la conversation d'avant oublié : si la lecture du profil échoue, rien ne la reprendrait par erreur.
    setBrief('')
    setCriteria({ ...EMPTY_CRITERIA, ...filters })
    setView('chat')
    setTab('search')
    push({ kind: 'user', text: `Profils similaires à ${first || 'ce profil'}` })
    void guarded(async () => {
      setProgress({ steps: ['Lecture du profil', PLAN_STEP], at: 0 })
      const res = await similarMbcCriteria(id)
      if (res.error || !res.criteria || !res.brief) {
        push({ kind: 'error', text: res.error ?? 'Profils similaires indisponibles pour le moment.', offer: 'manual' })
        return
      }
      const c = res.criteria
      setBrief(res.brief)
      setCriteria(c)
      push({ kind: 'assistant', text: `Je cherche des profils proches : ${[...c.titles, ...c.skills].slice(0, 6).join(', ')}${c.locations[0] ? ` · ${c.locations[0]}` : ''}.` })
      await runSearch(c, res.brief, ['Lecture du profil'])
    })
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
  // Ce que la page sait de plus sur chaque profil : révélé, score de l'évaluation par l'IA (filtres, tri, export).
  const poolContext: PoolContext = {
    revealed: Object.fromEntries(Object.entries(reveals).flatMap(([id, r]) => (r.state === 'done' ? [[id, r.profile]] : []))),
    aiScore: Object.fromEntries(Object.entries(evaluations).flatMap(([id, e]) => (e.state === 'done' ? [[id, e.evaluation.score]] : []))),
  }
  const toggleCompare = (id: string) => setCompareIds(c => toggleCompared(c, id, x => savedById.has(x)))
  /** Ligne d'une personne ; `mode` : sa case sert à « Révéler la sélection » (recherche) ou à « Comparer » (sélection). */
  const row = (p: ScoredProfile, mode: 'reveal' | 'compare' = 'reveal') => (
    <ResultRow key={p.id} p={p} criteria={run?.base ?? criteria} reveal={reveals[p.id]} aiScore={poolContext.aiScore[p.id]}
      follow={savedById.get(p.id)?.follow} selectMode={mode} active={panelOpen && p.id === activeId} busy={busy}
      selected={mode === 'compare' ? compareIds.includes(p.id) : selected.includes(p.id)} save={saveButton(p.id)}
      inVivier={Object.keys(added[p.id] ?? {}).length > 0}
      onOpen={() => openProfile(p.id)} onSelect={() => (mode === 'compare' ? toggleCompare(p.id) : toggleSelected(p.id))} onReveal={() => reveal([p.id])} />
  )

  /**
   * Suivi d'une personne enregistrée, avec la version lue (un suivi enregistré entre-temps dans un autre onglet n'est
   * pas écrasé) : le suivi enregistré, ou l'erreur à afficher. La liste est mise à jour.
   */
  const saveFollow = async (id: string, follow: MbcFollow): Promise<{ follow?: MbcFollow; error?: string }> => {
    try {
      const res = await updateMbcFollow({ id, follow, updatedAt: savedById.get(id)?.updatedAt ?? '' })
      const saved = res.follow
      const updatedAt = res.updatedAt
      if (!saved || !updatedAt) return { error: res.error ?? 'Suivi non enregistré.' }
      setSavedPersons(list => list.map(s => (s.profile.id === id ? { ...s, follow: saved, updatedAt } : s)))
      return { follow: saved }
    } catch {
      return { error: OFFLINE }
    }
  }

  const problem = criteriaProblem(criteria)
  const lastResultsId = [...messages].reverse().find(m => m.kind === 'results')?.id ?? null
  // Les propositions d'une erreur (« sans questions », « à la main ») ne valent que tant qu'elle est le dernier message.
  const lastId = messages.at(-1)?.id ?? null
  // Sans la personne de départ de « Profils similaires » : ni dans la liste, ni dans les nombres.
  const pool = (run?.pool ?? []).filter(p => p.id !== run?.seedId)
  const listed = pool.filter(p => !criteria.recentOnly || p.match.fresh)
  const hiddenByRecent = criteria.recentOnly ? pool.length - listed.length : 0
  const filtered = filterPool(listed, listFilters, poolContext)
  const visible = filtered.slice(0, shown)
  // Profils révélés de la liste filtrée à évaluer (jamais évalués, ou en échec), 10 au plus par clic.
  const toEvaluate = filtered
    .filter(p => poolContext.revealed[p.id] && (!evaluations[p.id] || evaluations[p.id].state === 'error'))
    .slice(0, EVALUATE_BATCH).map(p => p.id)
  /** Export CSV des profils filtrés (results-view.ts), téléchargé par le navigateur : rien ne passe par le serveur. */
  const exportCsv = () => {
    // BOM : Excel lit le fichier en UTF-8 (accents des noms et des intitulés).
    const blob = new Blob([`\uFEFF${poolCsv(filtered, poolContext)}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mbc-search-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    // Révoquée plus tard : Safari annule un téléchargement dont l'adresse disparaît aussitôt (comme esn-export-dialog.tsx).
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  const runningIndex = run?.running ? run.runs.findIndex(r => r.status === 'running') : -1
  const savedListed = savedPersons.map(s => profileOf(s.profile.id)).filter((p): p is ScoredProfile => Boolean(p))
  const keptPeople = Object.keys(talkPeople).map(profileOf).filter((p): p is ScoredProfile => Boolean(p))
  const statusCounts = countByStatus(savedPersons.map(s => s.follow))
  const savedShown = statusFilter === 'all' ? savedListed : savedListed.filter(p => savedById.get(p.id)?.follow.status === statusFilter)
  // Personnes cochées pour « Comparer », encore enregistrées et révélées.
  const compared = compareIds.flatMap(id => {
    const profile = profileOf(id)
    const r = reveals[id]
    if (!savedById.has(id) || !profile || r?.state !== 'done') return []
    const e = evaluations[id]
    return [{ profile, full: r.profile, evaluation: e?.state === 'done' ? e.evaluation : undefined, follow: savedById.get(id)?.follow }]
  })
  const active = panelOpen && activeId ? profileOf(activeId) : undefined
  // Marque-page de l'en-tête : la recherche dont la discussion est gardée ; sinon la recherche affichée, qui peut être
  // enregistrée tant que ses critères n'ont pas changé depuis son lancement.
  const currentEntry = (keptId ? entries.find(e => e.id === keptId) : undefined)
    ?? (current && current.criteria === JSON.stringify(criteria) ? entries.find(e => e.id === current.id) ?? null : null)
  const conversationTitle = !problem ? savedSearchName(criteria) : brief ? (brief.length > 60 ? `${brief.slice(0, 60)}…` : brief) : null
  const title = conversationTitle ?? (messages.length === 0 ? 'Votre sélection' : 'Nouvelle recherche')
  const lastSpoken = [...messages].reverse().find(m => m.kind === 'assistant' || m.kind === 'error')
  const status = progress ? `${progress.steps[progress.at]}…`
    : run && runningIndex >= 0 ? `Recherche ${runningIndex + 1} sur ${run.runs.length} : ${run.runs[runningIndex].strategy.label}…`
      : lastSpoken && 'text' in lastSpoken ? lastSpoken.text : ''

  const editor = (
    <CriteriaEditor criteria={criteria} onChange={setCriteria} onRun={runEdited} running={busy} disabled={busy || !configured}
      problem={problem} runLabel={run ? 'Relancer' : 'Rechercher'} />
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
                  if (m.id !== lastResultsId || !run) {
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
                      <ResultsBlock total={pool.length} listed={visible} remaining={filtered.length - visible.length} hiddenByRecent={hiddenByRecent}
                        filters={listFilters} onFilters={f => { setListFilters(f); setShown(SHOW_STEP) }} filtered={filtered.length} onExport={exportCsv}
                        toEvaluate={toEvaluate.length} evaluating={evaluating} onEvaluateAll={() => { void evaluateAll(toEvaluate) }}
                        runs={run.runs} running={run.running} stopping={stopping} titleCheckFailed={run.titleCheckFailed}
                        deeper={run.runs.filter(hasMorePages).length}
                        criteria={run.base} busy={busy} editing={editing} onToggleEditing={() => setEditing(v => !v)} editor={editor}
                        selectable={visible.filter(p => !reveals[p.id]).map(p => p.id)} selected={selected} quotaLeft={quotaLeft}
                        renderRow={row} onSelectAll={setSelected} onRevealSelection={() => { void reveal(selected) }}
                        onShowMore={() => setShown(s => s + SHOW_STEP)} onStop={stopRun} onDeeper={searchDeeper} />
                    </div>
                  )
                })}
                {/* Discussion rouverte (choix du 2026-11-17) : ses personnes révélées, puis la liste des profils sur demande. */}
                {!run && keptId && messages.length > 0 && (
                  <AssistantMessage>
                    {keptPeople.length > 0 && (
                      <section aria-label="Personnes révélées dans cette discussion" className="rounded-2xl overflow-hidden mb-3" style={surface}>
                        <p className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                          <strong style={{ color: 'var(--color-text)' }}>{keptPeople.length} personne{keptPeople.length > 1 ? 's' : ''} révélée{keptPeople.length > 1 ? 's' : ''}</strong>
                          {' '}dans cette discussion · gardée{keptPeople.length > 1 ? 's' : ''} avec elle (50 au plus)
                        </p>
                        <ul>{keptPeople.map(p => row(p))}</ul>
                      </section>
                    )}
                    {!busy && !questions && !problem && (
                      <button type="button" onClick={() => { void guarded(() => runSearch(criteria, brief)) }} disabled={!configured}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-40"
                        style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
                        <Radar className="h-4 w-4" aria-hidden /> Relancer la recherche
                      </button>
                    )}
                  </AssistantMessage>
                )}
                {/* Critères saisis à la main, ou à compléter : avant toute liste de profils. */}
                {editing && !run && <div className="rounded-2xl overflow-hidden" style={surface}>{editor}</div>}
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
                        : run ? 'Dites-moi ce qui ne va pas, ce qui manque ou où chercher ensuite.'
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
                {savedListed.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap px-4 pb-3">
                    <select aria-label="Filtrer par statut du suivi" value={statusFilter} onChange={e => setStatusFilter(e.target.value as FollowStatus | 'all')}
                      className="rounded-lg px-2 py-1.5 text-xs" style={{ ...surface, color: 'var(--color-text)' }}>
                      <option value="all">Tous les statuts · {savedListed.length}</option>
                      {(Object.keys(FOLLOW_STATUSES) as FollowStatus[]).map(st => (
                        <option key={st} value={st} disabled={statusCounts[st] === 0}>{FOLLOW_STATUSES[st]} · {statusCounts[st]}</option>
                      ))}
                    </select>
                    <span className="flex-1" />
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {compared.length > 0 ? `${compared.length} à comparer` : `Cochez 2 ou ${COMPARE_MAX} personnes pour les comparer`}
                    </span>
                    <button type="button" onClick={() => setComparing(true)} disabled={compared.length < 2}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40" style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
                      Comparer
                    </button>
                  </div>
                )}
                {savedPeople === null ? (
                  <p className="px-6 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)' }}>
                    Personnes enregistrées indisponibles pour le moment : la recherche fonctionne, sans elles.
                  </p>
                ) : savedListed.length === 0 ? (
                  <p className="px-6 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)' }}>
                    Aucune personne enregistrée : cliquez sur le marque-page d’un profil. Elle est révélée (1 crédit si elle ne l’est pas encore) et reste ici jusqu’à ce que vous la retiriez.
                  </p>
                ) : savedShown.length === 0 ? (
                  <p className="px-6 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)' }}>
                    Personne avec ce statut.
                  </p>
                ) : (
                  <ul>{savedShown.map(p => row(p, 'compare'))}</ul>
                )}
              </section>
            </div>
          )}

          <p className="max-w-4xl w-full mx-auto px-4 sm:px-6 pb-6 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Source : Apollo.io. Un profil complet (nom entier, e-mail professionnel, LinkedIn, lieu, parcours) coûte un crédit Apollo ; son téléphone se demande à part, jusqu&apos;à 8 crédits de plus si un numéro est trouvé. Un profil révélé est gardé 90 jours pour votre organisation (sans second crédit) ; une personne enregistrée reste dans votre sélection jusqu&apos;à ce que vous la retiriez ; votre besoin et vos critères restent dans votre historique ; une recherche enregistrée (marque-page) garde aussi sa discussion et les personnes révélées pendant celle-ci, jusqu&apos;à ce que vous la retiriez. Utilisez ces données pour un recrutement, conformément au RGPD.
          </p>
        </div>

        <CompareDialog people={compared} open={comparing && compared.length >= 2} onClose={() => setComparing(false)} />

        {/* Profil choisi : colonne de droite dès 1280 px, fenêtre plein écran en dessous. */}
        {active && (
          <aside aria-label="Profil choisi"
            className="fixed inset-0 z-50 overflow-y-auto p-4 xl:sticky xl:inset-auto xl:z-auto xl:w-96 xl:shrink-0 xl:top-[68px] xl:h-[calc(100vh-68px)]"
            style={{ background: 'var(--color-background)', borderLeft: '1px solid var(--color-border)' }}>
            <ProfilePanel key={active.id} profile={active} reveal={reveals[active.id]} criteria={need.criteria} brief={need.brief} jobs={jobs}
              save={saveButton(active.id)} added={added[active.id] ?? {}} canReveal={!busy && (quotaLeft === null || quotaLeft > 0)}
              onReveal={() => { void reveal([active.id]) }}
              onAdded={target => setAdded(a => ({ ...a, [active.id]: { ...a[active.id], [target]: true } }))}
              evaluation={evaluations[active.id]} canSimilar={!busy && evaluating === null}
              evaluateBlocked={busy || evaluating !== null ? 'Une autre action est en cours.' : criteriaProblem(need.criteria)}
              onEvaluate={() => { void evaluate(active.id) }} onSimilar={() => startSimilar(active.id)}
              follow={savedById.get(active.id)?.follow} onSaveFollow={f => saveFollow(active.id, f)} phone={phoneControl(active.id)}
              onClose={() => setPanelOpen(false)} />
          </aside>
        )}
      </div>
    </div>
  )
}
