import { EDUCATION_LEVELS, JOB_FAMILIES, SECTORS } from '@/lib/cv-classification'

// Statistiques des CV classés (ADR 0044 phase 3, page « CV Thèque · Statistiques ») : comptes par champ de l'index de
// recherche (facettes Meilisearch), mis en forme pour l'écran. Règles pures, testées dans cv-stats.test.ts.

/** Champs comptés ; `kind` donne le total, années et TJM leurs bornes. */
export const STAT_FACETS = ['kind', 'jobFamily', 'roles', 'skills', 'seniority', 'sectors', 'languages', 'city', 'educationLevel', 'yearsOfExperience', 'dailyRate', 'cvMonth'] as const

/**
 * Périmètre : la base candidats (la même pour tous les recruteurs), ou le vivier personnel du recruteur ; pour l'admin
 * de la plateforme seulement (page /admin/cvtheque/statistiques) : toute la plateforme, les profils des chasseurs, les
 * viviers de toutes les organisations.
 */
export type StatsScope =
  | { kind: 'pool' }
  | { kind: 'vivier'; tenantId: string; ownerId: string }
  | { kind: 'platform' }
  | { kind: 'hunters' }
  | { kind: 'viviers' }
  /** Viviers de tous les recruteurs d'une organisation : page Organisation (propriétaire, administrateurs) et admin. */
  | { kind: 'tenant'; tenantId: string }

const ID = /^[\w.-]{1,36}$/

/** Filtre du périmètre ; null si les identifiants du vivier ne sont pas valides (rien n'est alors demandé). */
export function statsFilter(scope: StatsScope): string | null {
  switch (scope.kind) {
    case 'pool': return 'kind = "candidate" AND role = "candidate"'
    case 'hunters': return 'kind = "candidate" AND role = "hunter_profile"'
    case 'viviers': return 'kind = "vivier"'
    case 'platform': return 'kind IN ["candidate", "vivier"]'
    case 'tenant':
      return ID.test(scope.tenantId) ? `kind = "vivier" AND tenantId = "${scope.tenantId}"` : null
    case 'vivier':
      if (!ID.test(scope.tenantId) || !ID.test(scope.ownerId)) return null
      return `kind = "vivier" AND tenantId = "${scope.tenantId}" AND ownerId = "${scope.ownerId}"`
  }
}

export interface StatRow { key: string; label: string; count: number; /** Part des CV du périmètre, 0 à 1. */ share: number }
export interface CvStatsView {
  total: number
  families: StatRow[]
  roles: StatRow[]
  skills: StatRow[]
  seniority: StatRow[]
  sectors: StatRow[]
  languages: StatRow[]
  cities: StatRow[]
  education: StatRow[]
  years: { min: number; max: number } | null
  dailyRate: { min: number; max: number } | null
  /** Âge des CV (date de dépôt), du plus récent au plus ancien, puis « Date inconnue ». */
  freshness: StatRow[]
  /** CV déposés chaque mois, les 12 derniers mois (mois en cours compris), du plus ancien au plus récent. */
  monthly: { month: string; label: string; count: number }[]
  /** Part des CV déposés dans les 12 derniers mois ; null sans CV. */
  lastYearShare: number | null
}

export interface RawStats {
  facetDistribution?: Record<string, Record<string, number>>
  facetStats?: Record<string, { min: number; max: number }>
}

const SENIORITY_LABELS: Record<string, string> = {
  junior: 'Junior (moins de 3 ans)', confirme: 'Confirmé (3 à 7 ans)', senior: 'Senior (8 à 14 ans)',
  expert: 'Expert (15 ans et plus)', non_precise: 'Non précisée',
}
const EDUCATION_LABELS: Record<string, string> = {
  bac: 'Bac', 'bac+2': 'Bac +2', 'bac+3': 'Bac +3', 'bac+5': 'Bac +5', doctorat: 'Doctorat', non_precise: 'Non précisé',
}

/** Lignes d'un champ : les plus nombreuses d'abord (`limit` au plus), ou dans l'ordre fixe `order` (échelles). */
function rows(counts: Record<string, number> | undefined, total: number, label: (key: string) => string, opts: { limit?: number; order?: readonly string[] } = {}): StatRow[] {
  const entries = Object.entries(counts ?? {}).filter(([key, count]) => key !== '' && count > 0)
  const sorted = opts.order
    ? opts.order.flatMap(key => entries.filter(([k]) => k === key))
    : entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))
  return sorted.slice(0, opts.limit ?? sorted.length)
    .map(([key, count]) => ({ key, label: label(key), count, share: total > 0 ? count / total : 0 }))
}

/** Mois écoulés entre « 2026-11 » et `now` (0 : mois en cours) ; null si la valeur n'est pas un mois. */
function monthsAgo(month: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return null
  return (now.getUTCFullYear() * 12 + now.getUTCMonth()) - (Number(m[1]) * 12 + Number(m[2]) - 1)
}

const FRESHNESS = [
  { key: 'moins_3_mois', label: 'Moins de 3 mois', below: 3 },
  { key: '3_12_mois', label: '3 à 12 mois', below: 12 },
  { key: '1_2_ans', label: '1 à 2 ans', below: 24 },
  { key: 'plus_2_ans', label: 'Plus de 2 ans', below: Infinity },
] as const

const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' })

/** Fraîcheur, dépôts des 12 derniers mois et part de moins d'un an, d'après les comptes par mois de dépôt. */
function datesView(months: Record<string, number> | undefined, total: number, now: Date) {
  const counts = new Map(FRESHNESS.map(b => [b.key, 0]))
  let dated = 0
  let lastYear = 0
  for (const [month, count] of Object.entries(months ?? {})) {
    const age = monthsAgo(month, now)
    // Un mois à venir (horloge d'un serveur en avance) compte comme récent.
    if (age === null || count <= 0) continue
    const bucket = FRESHNESS.find(b => Math.max(0, age) < b.below)!
    counts.set(bucket.key, counts.get(bucket.key)! + count)
    dated += count
    if (age < 12) lastYear += count
  }
  const freshness: StatRow[] = FRESHNESS.flatMap(b => {
    const count = counts.get(b.key)!
    return count > 0 ? [{ key: b.key, label: b.label, count, share: total > 0 ? count / total : 0 }] : []
  })
  if (total > dated) freshness.push({ key: 'inconnue', label: 'Date inconnue', count: total - dated, share: (total - dated) / total })
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - i), 1))
    const month = d.toISOString().slice(0, 7)
    return { month, label: monthLabel.format(d), count: months?.[month] ?? 0 }
  })
  return { freshness, monthly, lastYearShare: total > 0 ? lastYear / total : null }
}

export function cvStatsView(raw: RawStats, now: Date): CvStatsView {
  const facets = raw.facetDistribution ?? {}
  // Chaque CV a un seul `kind` : la somme est le nombre de CV du périmètre (facettes exhaustives, sans plafond).
  const total = Object.values(facets.kind ?? {}).reduce((sum, n) => sum + n, 0)
  const asIs = (key: string) => key
  const bounds = (field: string) => {
    const s = raw.facetStats?.[field]
    return s && Number.isFinite(s.min) && Number.isFinite(s.max) ? { min: Math.round(s.min), max: Math.round(s.max) } : null
  }
  return {
    total,
    families: rows(facets.jobFamily, total, key => JOB_FAMILIES[key as keyof typeof JOB_FAMILIES] ?? key),
    roles: rows(facets.roles, total, asIs, { limit: 12 }),
    skills: rows(facets.skills, total, asIs, { limit: 20 }),
    seniority: rows(facets.seniority, total, key => SENIORITY_LABELS[key] ?? key, { order: Object.keys(SENIORITY_LABELS) }),
    sectors: rows(facets.sectors, total, key => SECTORS[key as keyof typeof SECTORS] ?? key),
    languages: rows(facets.languages, total, asIs, { limit: 10 }),
    cities: rows(facets.city, total, asIs, { limit: 10 }),
    education: rows(facets.educationLevel, total, key => EDUCATION_LABELS[key] ?? key, { order: EDUCATION_LEVELS }),
    years: bounds('yearsOfExperience'),
    dailyRate: bounds('dailyRate'),
    ...datesView(facets.cvMonth, total, now),
  }
}

/** Compétence plus présente dans les CV récents que dans les plus anciens. */
export interface RisingSkill { label: string; recentShare: number; olderShare: number; /** Écart en points de pourcentage. */ delta: number }

/** CV de chaque côté sous lesquels la comparaison n'aurait pas de sens (« en hausse » sur 3 CV). */
export const RISING_MIN_CVS = 10
/** CV récents qui citent une compétence, au moins, pour la dire « en hausse ». */
const RISING_MIN_COUNT = 3
/** Ancienneté qui sépare les CV « récents » des autres. */
export const RISING_RECENT_MONTHS = 6

const totalOf = (raw: RawStats) => Object.values(raw.facetDistribution?.kind ?? {}).reduce((sum, n) => sum + n, 0)

/**
 * Compétences en hausse : part des CV déposés dans les RISING_RECENT_MONTHS derniers mois qui les citent, comparée à
 * celle des CV plus anciens ; les `limit` plus grands écarts positifs. null s'il n'y a pas assez de CV de chaque côté.
 */
export function risingSkills(recent: RawStats, older: RawStats, limit = 8): RisingSkill[] | null {
  const recentTotal = totalOf(recent)
  const olderTotal = totalOf(older)
  if (recentTotal < RISING_MIN_CVS || olderTotal < RISING_MIN_CVS) return null
  const olderSkills = older.facetDistribution?.skills ?? {}
  return Object.entries(recent.facetDistribution?.skills ?? {})
    .filter(([, count]) => count >= RISING_MIN_COUNT)
    .map(([label, count]) => {
      const recentShare = count / recentTotal
      const olderShare = (olderSkills[label] ?? 0) / olderTotal
      return { label, recentShare, olderShare, delta: Math.round((recentShare - olderShare) * 100) }
    })
    .filter(s => s.delta > 0)
    .sort((a, b) => b.delta - a.delta || b.recentShare - a.recentShare)
    .slice(0, limit)
}

/** Filtre des CV déposés depuis (ou avant) `months` mois ; `now` injecté. */
export function sinceFilter(base: string, months: number, now: Date, side: 'recent' | 'older'): string {
  const cut = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()) / 1000)
  return `${base} AND cvDate ${side === 'recent' ? '>=' : '<'} ${cut}`
}
