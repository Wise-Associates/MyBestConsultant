// Filtres de la page des statistiques AO de la plateforme (/admin/candidats/statistiques, demande du 2026-11-13) :
// période et sites sources, lus dans l'adresse (formulaire GET, `stats-filters.tsx`). Toute la page les suit : chiffres,
// graphiques et tableau « Par site source ». Règles pures, testées dans stats-filters.test.ts.

/** Période : jours compris, AAAA-MM-JJ en UTC — même règle que le filtre de dates de la liste AO (`offer-index.ts`). */
export interface StatsPeriod {
  from: string
  to: string
}

/** Raccourcis : périodes glissantes, qui finissent aujourd'hui et sont recalculées chaque jour. */
export const PERIOD_PRESETS = [
  { value: '7', label: '7 jours' },
  { value: '30', label: '30 jours' },
  { value: '365', label: '12 mois' },
] as const
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]['value']
const PRESET_DAYS: Record<PeriodPreset, number> = { '7': 7, '30': 30, '365': 365 }
/** Période à l'ouverture de la page : les rapports de passage de la veille gardés couvrent environ 30 jours. */
export const DEFAULT_PERIOD_PRESET: PeriodPreset = '30'

/**
 * Période la plus longue : au-delà, son début est rapproché. Les offres ne sont gardées que 365 jours, et une période de
 * plusieurs siècles saisie dans l'adresse donnerait un graphique de milliers de barres.
 */
export const MAX_PERIOD_DAYS = 731

const DAY_MS = 86_400_000
const DAY = /^\d{4}-\d{2}-\d{2}$/
/** Identifiant de site source accepté dans l'adresse (`monitoring.ts` : identifiants de sources de la veille). */
const SITE_ID = /^[a-z0-9-]{1,60}$/

/** Jour AAAA-MM-JJ qui existe (« 2026-13-01 » ou « 2026-02-30 » sont refusés). */
export function isDay(value: unknown): value is string {
  return typeof value === 'string' && DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)
}

export const dayOf = (date: Date): string => date.toISOString().slice(0, 10)

export function addDays(day: string, n: number): string {
  return dayOf(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS))
}

/** Jour UTC d'un instant ISO (« 2026-11-10T23:30:00.000+00:00 ») ; '' s'il est illisible. */
export function dayOfInstant(iso: string): string {
  const time = Date.parse(iso)
  return Number.isNaN(time) ? '' : dayOf(new Date(time))
}

export function inPeriod(iso: string, period: StatsPeriod): boolean {
  const day = dayOfInstant(iso)
  return day !== '' && day >= period.from && day <= period.to
}

export function presetPeriod(preset: PeriodPreset, now: Date): StatsPeriod {
  const to = dayOf(now)
  return { from: addDays(to, -(PRESET_DAYS[preset] - 1)), to }
}

/** « 2026-11-13 » → « 13/11/2026 ». */
export const frenchDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`

/** « du 15/10/2026 au 13/11/2026 », « le 13/11/2026 ». */
export function periodLabel(period: StatsPeriod): string {
  return period.from === period.to ? `le ${frenchDay(period.from)}` : `du ${frenchDay(period.from)} au ${frenchDay(period.to)}`
}

export interface StatsFilters {
  period: StatsPeriod
  /** Raccourci choisi, null pour des dates saisies. */
  preset: PeriodPreset | null
  /** Sites demandés ; null : tous. */
  sites: string[] | null
}

type Params = Record<string, string | string[] | undefined>
const valuesOf = (value: string | string[] | undefined) => (value === undefined ? [] : Array.isArray(value) ? value : [value])

/**
 * Filtres lus dans l'adresse : `periode` (raccourci, prioritaire), sinon `du` / `au` (une seule date : l'autre est
 * aujourd'hui, ou 30 jours avant), sinon 30 jours ; dates inversées remises dans l'ordre. `site`, répété : sites
 * demandés (absent : tous).
 */
export function statsFiltersFromParams(params: Params, now: Date): StatsFilters {
  const sites = [...new Set(valuesOf(params.site).filter(id => SITE_ID.test(id)))].slice(0, 100)
  const filters = (period: StatsPeriod, preset: PeriodPreset | null): StatsFilters => ({ period, preset, sites: sites.length ? sites : null })

  const preset = PERIOD_PRESETS.find(p => p.value === valuesOf(params.periode)[0])?.value
  if (preset) return filters(presetPeriod(preset, now), preset)
  const from = valuesOf(params.du)[0]
  const to = valuesOf(params.au)[0]
  if (!isDay(from) && !isDay(to)) return filters(presetPeriod(DEFAULT_PERIOD_PRESET, now), DEFAULT_PERIOD_PRESET)

  const end = isDay(to) ? to : dayOf(now)
  const start = isDay(from) ? from : addDays(end, -(PRESET_DAYS[DEFAULT_PERIOD_PRESET] - 1))
  const [first, last] = start <= end ? [start, end] : [end, start]
  const earliest = addDays(last, -(MAX_PERIOD_DAYS - 1))
  return filters({ from: first < earliest ? earliest : first, to: last }, null)
}

/** Sites retenus : ceux demandés qui existent ; aucun demandé, ou aucun qui existe encore : tous. */
export function selectedSites(requested: string[] | null, available: readonly string[]): Set<string> {
  const known = (requested ?? []).filter(id => available.includes(id))
  return new Set(known.length ? known : available)
}
