import type { AoOfferStatus } from './types'
import { addDays, dayOf, dayOfInstant, inPeriod, type StatsPeriod } from './stats-filters'

// Statistiques de la page AO Offers (règles pures, testées) : offres reçues dans le temps, séniorité, compétences et
// technologies, TJM, clients, villes, assistance technique ou forfait.

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export type Seniority = 'junior' | 'confirmed' | 'senior' | 'expert' | 'unknown'

export const SENIORITY_LABEL: Record<Seniority, string> = {
  junior: 'Junior (0-2 ans)', confirmed: 'Confirmé (3-5 ans)', senior: 'Senior (6-9 ans)', expert: 'Expert (10 ans et +)', unknown: 'Non précisée',
}
export const SENIORITY_ORDER: Seniority[] = ['junior', 'confirmed', 'senior', 'expert', 'unknown']
/** Libellé court (colonne du tableau) ; le texte d'expérience d'origine est en infobulle. */
export const SENIORITY_SHORT: Record<Seniority, string> = { junior: 'Junior', confirmed: 'Confirmé', senior: 'Senior', expert: 'Expert', unknown: '—' }

function bucketOfYears(years: number): Seniority {
  return years <= 2 ? 'junior' : years <= 5 ? 'confirmed' : years <= 9 ? 'senior' : 'expert'
}

/**
 * Tranche de séniorité d'après le texte d'expérience de l'offre : années (« 3 à 5 ans » → la borne basse, « 8 ans
 * minimum », « 10+ ans ») d'abord, sinon le niveau écrit (junior, confirmé, senior, expert).
 */
export function seniorityOf(experience: string): Seniority {
  const text = fold(experience)
  const range = text.match(/(\d{1,2})\s*(?:a|-|\/)\s*\d{1,2}\s*(?:ans?|annees?|years?)\b/)
  const single = text.match(/(\d{1,2})\s*\+?\s*(?:ans?|annees?|years?)\b/)
  const years = range?.[1] ?? single?.[1]
  if (years !== undefined) return bucketOfYears(Number(years))
  if (/expert|lead|principal/.test(text)) return 'expert'
  if (/senior/.test(text)) return 'senior'
  if (/confirme|intermediaire/.test(text)) return 'confirmed'
  if (/junior|debutant/.test(text)) return 'junior'
  return 'unknown'
}

/** Graphique des offres reçues : une barre par jour, par semaine (du lundi) ou par mois. */
export type TimeGrain = 'day' | 'week' | 'month'

export interface TimeBucket {
  /** Premier jour de la tranche (AAAA-MM-JJ, UTC) ; une semaine peut commencer avant la période. */
  start: string
  to_review: number
  published: number
  ignored: number
}

/** Barres lisibles : par jour jusqu'à 31 jours, par semaine jusqu'à 120 jours (17 barres), par mois au-delà. */
export function grainOf(period: StatsPeriod): TimeGrain {
  const days = (Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86_400_000 + 1
  return days <= 31 ? 'day' : days <= 120 ? 'week' : 'month'
}

function bucketStart(day: string, grain: TimeGrain): string {
  if (grain === 'day') return day
  if (grain === 'month') return `${day.slice(0, 7)}-01`
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7 // lundi : 0
  return addDays(day, -weekday)
}

function nextBucket(start: string, grain: TimeGrain): string {
  if (grain === 'day') return addDays(start, 1)
  if (grain === 'week') return addDays(start, 7)
  const date = new Date(`${start}T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + 1)
  return dayOf(date)
}

/** Offres reçues sur la période, par jour, semaine ou mois de réception (UTC) et par statut ; hors période : ignorées. */
export function offersOverTime(rows: { receivedAt: string; status: AoOfferStatus }[], period: StatsPeriod): { grain: TimeGrain; buckets: TimeBucket[] } {
  const grain = grainOf(period)
  const buckets: TimeBucket[] = []
  for (let start = bucketStart(period.from, grain); start <= period.to; start = nextBucket(start, grain)) {
    buckets.push({ start, to_review: 0, published: 0, ignored: 0 })
  }
  const byStart = new Map(buckets.map(b => [b.start, b]))
  for (const row of rows) {
    if (!inPeriod(row.receivedAt, period)) continue
    const bucket = byStart.get(bucketStart(dayOfInstant(row.receivedAt), grain))
    if (bucket) bucket[row.status]++
  }
  return { grain, buckets }
}

/** Les 12 mois qui finissent au mois de `now` (UTC) : période des statistiques d'une organisation (page recruteur). */
export function lastTwelveMonths(now: Date): StatsPeriod {
  return { from: dayOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1))), to: dayOf(now) }
}

export interface LabelCount {
  label: string
  count: number
}

/** Les `n` valeurs les plus fréquentes, regroupées sans casse ni accents ; libellé : la graphie la plus fréquente. */
export function topCounts(values: string[], n: number): LabelCount[] {
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>()
  for (const value of values.map(v => v.trim()).filter(Boolean)) {
    const key = fold(value)
    const group = groups.get(key) ?? { count: 0, spellings: new Map<string, number>() }
    group.count++
    group.spellings.set(value, (group.spellings.get(value) ?? 0) + 1)
    groups.set(key, group)
  }
  return [...groups.values()]
    .map(g => ({ label: [...g.spellings].sort((a, b) => b[1] - a[1])[0][0], count: g.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'))
    .slice(0, n)
}

/** Un montant entre ces bornes est un TJM ; au-delà, un salaire annuel (exclu des statistiques de TJM). */
const TJM_MIN = 100
const TJM_MAX = 3000
const TJM_RANGES: [string, number, number][] = [
  ['Moins de 400 €', 0, 399], ['400 à 499 €', 400, 499], ['500 à 599 €', 500, 599], ['600 à 699 €', 600, 699], ['700 € et +', 700, Infinity],
]

export interface TjmSummary {
  count: number
  median: number | null
  ranges: LabelCount[]
}

/** TJM des offres (montants journaliers seulement) : nombre, médiane et répartition par tranche. */
export function tjmSummary(amounts: (number | null)[]): TjmSummary {
  const tjm = amounts.filter((a): a is number => a !== null && a >= TJM_MIN && a <= TJM_MAX).sort((a, b) => a - b)
  const median = tjm.length ? (tjm.length % 2 ? tjm[(tjm.length - 1) / 2] : Math.round((tjm[tjm.length / 2 - 1] + tjm[tjm.length / 2]) / 2)) : null
  return {
    count: tjm.length,
    median,
    ranges: TJM_RANGES.map(([label, min, max]) => ({ label, count: tjm.filter(a => a >= min && a <= max).length })),
  }
}

/** Ville pour les regroupements : « Paris 15e (75015) », « PARIS - La Défense » → « Paris » ; '' si absente. */
export function cityName(location: string): string {
  const first = (location.split(/\s[-–]\s|[,(/–]/)[0] ?? '').replace(/\b\d+\s*(?:e|er|eme|ème)?\b/gi, '').replace(/\s+/g, ' ').trim()
  return first ? first.toLowerCase().replace(/(^|[\s-])\p{L}/gu, c => c.toUpperCase()) : ''
}
