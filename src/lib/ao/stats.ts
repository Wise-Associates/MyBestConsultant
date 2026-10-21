import type { AoOfferStatus } from './types'

// Statistiques de la page AO Offers (règles pures, testées) : offres par mois, séniorité, compétences et
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

export interface MonthCount {
  /** AAAA-MM */
  month: string
  to_review: number
  published: number
  ignored: number
}

/** Offres par mois de réception, sur les 12 mois qui finissent au mois de `now` (UTC), par statut. */
export function offersByMonth(rows: { receivedAt: string; status: AoOfferStatus }[], now: Date): MonthCount[] {
  const months: MonthCount[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    months.push({ month: d.toISOString().slice(0, 7), to_review: 0, published: 0, ignored: 0 })
  }
  const byMonth = new Map(months.map(m => [m.month, m]))
  for (const row of rows) {
    const month = byMonth.get(row.receivedAt.slice(0, 7))
    if (month) month[row.status]++
  }
  return months
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
