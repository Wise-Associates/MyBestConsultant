import type { TitlePair } from '@/lib/match-scoring'
import {
  CRITERIA_LIMITS, criteriaProblem, criteriaSchema, jsonObjectIn, requiredSkillsOf, same, textList, type MbcCriteria, type MbcProfile,
  type ScoredProfile,
} from './rules'

// Recherche en plusieurs requêtes (ADR 0037, demande du 2026-11-16) : une seule requête à Apollo manque les personnes
// qui exercent le même métier sous un autre intitulé. Le besoin part donc en plusieurs requêtes : celle des critères du
// recruteur, puis jusqu'à 4 autres proposées par l'IA, qui ne changent que les intitulés (et, sans compétence
// obligatoire ★, 0 à 2 mots-clés). Lieu, séniorité, secteur et filtres restent ceux du recruteur ; ses compétences ★
// restent obligatoires partout. Chaque profil est noté sur les critères du recruteur, quelle que soit la requête qui l'a
// trouvé. Règles pures, testées (strategies.test.ts), utilisées aussi dans le navigateur.

export const STRATEGY_LIMITS = {
  /** Requêtes par besoin, celle des critères du recruteur comprise. */
  count: 5,
  titles: 4,
  /** Mots-clés obligatoires que l'IA peut ajouter à une requête quand le recruteur n'en a marqué aucun. */
  keywords: 2,
  label: 80,
  /** Profils par page d'une requête : le maximum d'Apollo. */
  perPage: 100,
  /** Pages par requête (« Chercher plus loin ») : 500 profils par requête au plus. */
  maxPage: 5,
} as const

export interface MbcStrategy {
  /** Ce que la requête cherche de différent, en quelques mots (affiché au recruteur). */
  label: string
  /** Critères envoyés à Apollo pour cette requête (`toApolloQuery`) ; la note se fait sur ceux du recruteur. */
  criteria: MbcCriteria
}

export const BASE_STRATEGY_LABEL = 'Vos critères'

const normalizedList = (list: string[]) => list.map(s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()).sort()
/** Deux requêtes identiques pour Apollo : mêmes intitulés et mêmes mots-clés obligatoires, à la casse et à l'ordre près. */
const queryKey = (c: MbcCriteria) => JSON.stringify([normalizedList(c.titles), normalizedList(requiredSkillsOf(c))])

/**
 * Requêtes d'un besoin : celle des critères du recruteur d'abord, puis celles proposées par l'IA (`text`, donnée non
 * fiable : JSON `{"strategies": [{"label", "titles", "requiredSkills"}]}`), validées une à une par `criteriaSchema`,
 * sans doublon, 5 au plus. Une réponse illisible ne donne que la requête du recruteur. L'IA ne touche ni au lieu, ni à
 * la séniorité, ni au secteur, ni aux filtres ; les compétences ★ du recruteur restent obligatoires.
 */
export function parseStrategies(text: string, base: MbcCriteria): MbcStrategy[] {
  const strategies: MbcStrategy[] = [{ label: BASE_STRATEGY_LABEL, criteria: base }]
  const keys = new Set([queryKey(base)])
  const obj = jsonObjectIn(text)
  const proposed = Array.isArray(obj?.strategies) ? obj.strategies : []
  const baseRequired = requiredSkillsOf(base)
  for (const raw of proposed) {
    if (strategies.length >= STRATEGY_LIMITS.count) break
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const s = raw as Record<string, unknown>
    const titles = textList(s.titles, CRITERIA_LIMITS.item, STRATEGY_LIMITS.titles)
    const required = baseRequired.length > 0 ? baseRequired : textList(s.requiredSkills, CRITERIA_LIMITS.item, STRATEGY_LIMITS.keywords)
    // Mots-clés obligatoires d'abord : ils doivent rester dans la liste des compétences une fois coupée.
    const skills = [...required, ...base.skills.filter(b => !required.some(r => same(r, b)))].slice(0, CRITERIA_LIMITS.items)
    const checked = criteriaSchema.safeParse({ ...base, titles: titles.length > 0 ? titles : base.titles, skills, requiredSkills: required })
    if (!checked.success || criteriaProblem(checked.data)) continue
    const key = queryKey(checked.data)
    if (keys.has(key)) continue
    keys.add(key)
    const label = typeof s.label === 'string' && s.label.trim() ? s.label.trim().slice(0, STRATEGY_LIMITS.label) : checked.data.titles.join(', ')
    strategies.push({ label, criteria: checked.data })
  }
  return strategies
}

/** Profil de la liste commune, avec les requêtes (numéros dans l'ordre des requêtes) qui l'ont trouvé. */
export interface PoolProfile extends ScoredProfile {
  strategies: number[]
}

/**
 * Ajoute à la liste commune les profils d'une page de la requête `strategy`, sans doublon (identifiant Apollo : le seul
 * connu avant enrichissement). `added` : profils nouveaux pour la liste. Liste du meilleur au moins bon score ; à score
 * égal, ordre d'arrivée.
 */
export function mergePool(pool: PoolProfile[], incoming: ScoredProfile[], strategy: number): { pool: PoolProfile[]; added: number } {
  const byId = new Map(pool.map(p => [p.id, p]))
  let added = 0
  for (const p of incoming) {
    const known = byId.get(p.id)
    if (known) {
      if (!known.strategies.includes(strategy)) byId.set(p.id, { ...known, strategies: [...known.strategies, strategy] })
      continue
    }
    byId.set(p.id, { ...p, strategies: [strategy] })
    added++
  }
  return { pool: [...byId.values()].sort((a, b) => b.score - a.score), added }
}

/** Avancement d'une requête dans la page. `found` et `added` : cumulés sur ses pages. */
export interface StrategyRun {
  strategy: MbcStrategy
  status: 'waiting' | 'running' | 'done' | 'error' | 'stopped'
  /** Dernière page lue (0 : aucune). */
  page: number
  /** Profils qu'Apollo annonce pour cette requête. */
  total: number
  found: number
  added: number
  error?: string
}

/** Requête dont Apollo a encore des profils à donner (« Chercher plus loin »), dans la limite de STRATEGY_LIMITS.maxPage. */
export function hasMorePages(run: StrategyRun): boolean {
  return run.status === 'done' && run.page > 0 && run.page < STRATEGY_LIMITS.maxPage && run.page * STRATEGY_LIMITS.perPage < run.total
}

/**
 * Requête dont la page `page` a échoué. Sa première page : « échec ». Une page suivante (« Chercher plus loin ») : la
 * requête garde ses profils et ses chiffres, l'erreur s'affiche, et la même page sera proposée de nouveau.
 */
export function failedRun(run: StrategyRun, page: number, error: string): StrategyRun {
  return page > 1 ? { ...run, status: 'done', error } : { ...run, status: 'error', error }
}

/**
 * Fin d'un passage, qu'il soit allé au bout, arrêté ou interrompu (serveur injoignable) : requêtes pas encore lancées
 * « arrêtées » ; requête restée en cours (sa réponse n'est jamais arrivée) en échec avec `interrupted`.
 */
export function settledRuns(runs: StrategyRun[], interrupted: string): StrategyRun[] {
  return runs.map(r => (r.status === 'waiting' ? { ...r, status: 'stopped' } : r.status === 'running' ? failedRun(r, r.page + 1, interrupted) : r))
}

/** Clé d'un intitulé pour la comparaison par l'IA : un intitulé répété dans la page n'est comparé qu'une fois. */
export const titleKey = (title: string) => title.trim().toLowerCase()

/** Longueur du métier demandé que lit l'IA (`titleCheckPrompt` coupe à 120 caractères). */
const METIER_CHARS = 120

/** Intitulés du recruteur entiers qui tiennent dans ce que lit l'IA (au moins le premier, que la consigne coupe au besoin). */
function metierOf(titles: string[]): string {
  let metier = titles[0] ?? ''
  for (const t of titles.slice(1)) {
    if (`${metier} / ${t}`.length > METIER_CHARS) break
    metier = `${metier} / ${t}`
  }
  return metier
}

/**
 * Paires à faire comparer par l'IA (title-check) : le métier demandé (les intitulés du recruteur) et chaque intitulé
 * différent de la page. Sans intitulé demandé, aucune : le critère ne départage personne. Un intitulé identique à l'un
 * de ceux du recruteur n'est pas demandé : il garde tous ses points (mots en commun), l'IA ne peut pas le contredire.
 */
export function titlePairs(criteria: MbcCriteria, profiles: MbcProfile[]): TitlePair[] {
  if (criteria.titles.length === 0) return []
  const metier = metierOf(criteria.titles)
  const wanted = new Set(criteria.titles.map(titleKey))
  const seen = new Set<string>()
  const pairs: TitlePair[] = []
  for (const p of profiles) {
    const key = titleKey(p.title)
    if (!key || seen.has(key) || wanted.has(key)) continue
    seen.add(key)
    pairs.push({ metier, intitule: p.title.trim() })
  }
  return pairs
}
