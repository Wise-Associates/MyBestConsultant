import type { AoOfferStatus } from '@/lib/ao/types'
import { inPeriod, type StatsPeriod } from '@/lib/ao/stats-filters'
import { BUILTIN_SOURCES, type BuiltinSourceId, type VeilleConfig, type VeilleSource } from './config'
import type { RunReport, SourceRunReport } from './run-report'

// Suivi des sources de la veille (ADR 0030), affiché dans /admin/candidats/statistiques : **par site source** (demande
// du 2026-11-13 : par site, pas par organisme) — BOAMP, TED, Choisir le service public, chaque site carrières, et les
// e-mails de la boîte AO —, son état d'après les rapports de passage du scanner, et sur la période choisie les annonces
// lues et les offres AO qu'il a apportées. Une recherche de la veille (source des réglages) appartient à un site :
// Choisir le service public en a une par organisme, BOAMP et TED une pour les organismes suivis et une chez tous les
// acheteurs. Règles pures, testées dans monitoring.test.ts.

/** Recherches chez tous les acheteurs (ADR 0006 du scanner) : sources du scanner sans entrée dans les réglages. */
export const ALL_BUYERS_SOURCES = {
  'boamp-tous-acheteurs': { label: 'BOAMP — tous les acheteurs', parent: 'boamp' },
  'ted-tous-acheteurs': { label: 'TED — tous les acheteurs', parent: 'ted' },
} as const

/**
 * Passages à 5 h, 9 h, 13 h et 17 h UTC : la plus longue attente normale est de 12 heures (17 h → 5 h). Au-delà de 13
 * heures sans rapport, le scanner est arrêté, en échec avant l'enregistrement de son état, ou ne joint plus ce site.
 */
export const STALE_AFTER_HOURS = 13

export interface StoredRun {
  report: RunReport
}

export type SourceHealth = 'ok' | 'warning' | 'error' | 'skipped' | 'never' | 'disabled' | 'removed'

/** Type de site : appels d'offres, offres d'emploi, e-mails de la boîte AO, ou inconnu (source retirée, sans source). */
export type SiteKind = 'tender' | 'job' | 'email' | 'unknown'

export interface SiteRef {
  /** Identifiant dans l'adresse de la page (`site=`) ; celui de la source pour un site qui n'en a qu'une. */
  id: string
  label: string
  kind: SiteKind
}

export const EMAIL_SITE: SiteRef = { id: 'e-mails', label: 'E-mails AO', kind: 'email' }
/** Offres de la veille reçues sans leur source (avant le suivi des sources, ou en-tête absent). */
export const UNKNOWN_SOURCE_SITE: SiteRef = { id: 'veille-sans-source', label: 'Veille, source non enregistrée', kind: 'unknown' }
const BOAMP_SITE: SiteRef = { id: 'boamp', label: 'BOAMP', kind: 'tender' }
const TED_SITE: SiteRef = { id: 'ted', label: 'TED (Journal officiel de l\'UE)', kind: 'tender' }
const CSP_SITE: SiteRef = { id: 'choisir-le-service-public', label: 'Choisir le service public', kind: 'job' }

/** Groupes de la page (filtre et tableau), dans l'ordre. */
export const SITE_GROUPS: { label: string; kinds: SiteKind[] }[] = [
  { label: 'Appels d\'offres', kinds: ['tender'] },
  { label: 'Offres d\'emploi', kinds: ['job'] },
  { label: 'Autres sources', kinds: ['email', 'unknown'] },
]

/**
 * Site d'une recherche de la veille. `seen` : libellé et type donnés par un rapport de passage, pour une recherche que
 * les réglages ne connaissent pas (retirée depuis, ou réglages illisibles).
 */
export function siteOfSource(id: string, config: VeilleConfig | null, seen?: { label: string; kind: 'tender' | 'job' }): SiteRef {
  if (id === 'boamp' || id === 'boamp-tous-acheteurs') return BOAMP_SITE
  if (id === 'ted' || id === 'ted-tous-acheteurs') return TED_SITE
  const source = config?.sources.find(s => s.id === id)
  // Recherche inconnue des réglages : `csp-<organisme>` est l'identifiant que /admin/veille donne aux recherches de
  // Choisir le service public (sources-tab.tsx).
  if (source ? source.kind === 'csp' : id.startsWith('csp-')) return CSP_SITE
  if (source?.kind === 'rss') return { id, label: source.label, kind: 'job' }
  if (Object.hasOwn(BUILTIN_SOURCES, id)) return { id, label: BUILTIN_SOURCES[id as BuiltinSourceId].label, kind: 'job' }
  return { id, label: seen?.label ?? id, kind: seen?.kind ?? 'unknown' }
}

export interface MonitoredOffer {
  /** '' : offre de la veille sans source connue. */
  veilleSource: string
  channel: 'email' | 'scraping'
  status: AoOfferStatus
  receivedAt: string
}

/** Site d'une offre AO : e-mails de la boîte, ou site de la veille qui l'a envoyée. */
export function siteOfOffer(offer: Pick<MonitoredOffer, 'channel' | 'veilleSource'>, config: VeilleConfig | null): SiteRef {
  if (offer.channel !== 'scraping') return EMAIL_SITE
  return offer.veilleSource ? siteOfSource(offer.veilleSource, config) : UNKNOWN_SOURCE_SITE
}

/** Ce qu'un passage a fait d'une recherche, sans ce que la ligne affiche déjà (identifiant, libellé, type). */
export type SearchRun = Omit<SourceRunReport, 'id' | 'label' | 'kind'> & { at: string }

/** Une recherche de la veille sur le site (détail du site). */
export interface SearchMonitoring {
  id: string
  label: string
  health: SourceHealth
  /** Dernier passage qui a lu cette recherche. */
  lastRun: SearchRun | null
  lastSuccessAt: string | null
  /** Passages en échec de suite, du plus récent en arrière. */
  consecutiveFailures: number
}

export interface OfferCounts {
  total: number
  byStatus: Record<AoOfferStatus, number>
}

export interface SiteMonitoring extends SiteRef {
  searches: SearchMonitoring[]
  /** La plus grave des recherches lues par le scanner ; null : sans objet (e-mails AO) ou rapports non lus. */
  health: SourceHealth | null
  /** Recherches lues par le scanner (ni désactivées ni retirées), dont en échec et à vérifier. */
  active: number
  failing: number
  warning: number
  lastSuccessAt: string | null
  /**
   * Sur la période : passages qui ont lu le site, annonces envoyées à la boîte AO, écartées hors informatique, échues —
   * chacune comptée une fois. Pas les « nouvelles » : une annonce en attente (plafond du passage, envoi interrompu)
   * redevient nouvelle à chaque passage jusqu'à son envoi.
   */
  reads: { runs: number; sent: number; outOfScope: number; outdated: number }
  /** Offres AO créées sur la période à partir des e-mails de ce site, par statut actuel. */
  offers: OfferCounts
}

export interface VeilleMonitoring {
  /** Rapports de passage lus : sinon (suivi non configuré ou illisible), états et chiffres de lecture inconnus. */
  readsKnown: boolean
  lastRunAt: string | null
  /** Plus ancien passage gardé : les chiffres de lecture ne remontent pas plus loin. */
  firstRunAt: string | null
  /** Aucun rapport depuis STALE_AFTER_HOURS (ou jamais). */
  stale: boolean
  /** Réglages utilisés par le dernier passage, et s'ils diffèrent de la version en vigueur. */
  settings: { origin: RunReport['settings']['origin']; version: number | null; outdated: boolean } | null
  deliveryError: string | null
  otherWarnings: RunReport['otherWarnings']
  /** Sites des réglages et ceux vus dans les rapports ou les offres de la période, groupés (SITE_GROUPS) ; e-mails AO toujours. */
  sites: SiteMonitoring[]
}

interface CatalogEntry {
  id: string
  label: string
  kind: 'tender' | 'job'
  enabled: boolean
}

function labelOf(source: VeilleSource): string {
  if (source.kind === 'boamp') return 'BOAMP'
  if (source.kind === 'ted') return 'TED (Journal officiel de l\'UE)'
  if (source.kind === 'builtin') return BUILTIN_SOURCES[source.id].label
  return source.label
}

/** Recherches des réglages, dans leur ordre, BOAMP et TED suivis de leur recherche chez tous les acheteurs. */
function catalog(config: VeilleConfig): CatalogEntry[] {
  const organisations = new Map(config.organisations.map(o => [o.id, o]))
  const entries: CatalogEntry[] = []
  for (const source of config.sources) {
    if (source.kind === 'boamp' || source.kind === 'ted') {
      entries.push({ id: source.id, label: labelOf(source), kind: 'tender', enabled: source.enabled })
      const [allId, all] = Object.entries(ALL_BUYERS_SOURCES).find(([, s]) => s.parent === source.id) ?? []
      if (allId && all) entries.push({ id: allId, label: all.label, kind: 'tender', enabled: source.enabled && config.tenderKeywords.allBuyers })
      continue
    }
    const organisationId = source.kind === 'builtin' ? BUILTIN_SOURCES[source.id].organisationId : source.organisationId
    entries.push({ id: source.id, label: labelOf(source), kind: 'job', enabled: source.enabled && (organisations.get(organisationId)?.enabled ?? false) })
  }
  return entries
}

function runOf(at: string, read: SourceRunReport): SearchRun {
  const { ok, error, listed, outOfScope, outdated, pending, sent, warnings } = read
  return { at, ok, error, listed, outOfScope, new: read.new, sent, outdated, pending, warnings }
}

const emptyOffers = (): OfferCounts => ({ total: 0, byStatus: { to_review: 0, published: 0, ignored: 0 } })

/** États d'une recherche lue par le scanner, du plus grave au moins grave : celui du site est le plus grave. */
const ACTIVE_HEALTH: SourceHealth[] = ['error', 'skipped', 'warning', 'never', 'ok']
const isActive = (search: SearchMonitoring) => search.health !== 'disabled' && search.health !== 'removed'

/**
 * `runs` : rapports enregistrés, dans n'importe quel ordre, null s'ils n'ont pas pu être lus ; `config` : réglages en
 * vigueur (null s'ils sont illisibles : seules les recherches vues dans les rapports sont listées) ; `offers` : offres AO
 * de la plateforme (hors période : ignorées) ; `period` : période choisie sur la page.
 */
export function buildVeilleMonitoring(input: {
  config: VeilleConfig | null
  configVersion: number | null
  runs: StoredRun[] | null
  offers: MonitoredOffer[]
  period: StatsPeriod
  now: Date
}): VeilleMonitoring {
  const { config, period } = input
  const readsKnown = input.runs !== null
  const runs = [...(input.runs ?? [])].sort((a, b) => b.report.startedAt.localeCompare(a.report.startedAt))
  const latest = runs[0]?.report ?? null

  const entries = config ? catalog(config) : []
  const inConfig = new Set(entries.map(e => e.id))
  // Recherche lue par le scanner mais absente des réglages (retirée depuis, ou réglages illisibles) : gardée, libellé du
  // dernier rapport, pour que ses échecs et ses offres restent visibles.
  for (const run of runs) {
    for (const source of run.report.sources) {
      if (entries.some(e => e.id === source.id)) continue
      entries.push({ id: source.id, label: source.label, kind: source.kind, enabled: config === null })
    }
  }
  const seen = new Map(entries.map(e => [e.id, { label: e.label, kind: e.kind }]))
  const siteIdOf = (sourceId: string) => siteOfSource(sourceId, config, seen.get(sourceId)).id

  const sites = new Map<string, SiteMonitoring>()
  const siteFor = (ref: SiteRef): SiteMonitoring => {
    const existing = sites.get(ref.id)
    if (existing) return existing
    const site: SiteMonitoring = {
      ...ref, searches: [], health: null, active: 0, failing: 0, warning: 0, lastSuccessAt: null,
      reads: { runs: 0, sent: 0, outOfScope: 0, outdated: 0 }, offers: emptyOffers(),
    }
    sites.set(ref.id, site)
    return site
  }

  for (const entry of entries) {
    const reads = runs.flatMap(run => {
      const read = run.report.sources.find(s => s.id === entry.id)
      return read ? [{ at: run.report.startedAt, read }] : []
    })
    const last = reads[0] ?? null
    let consecutiveFailures = 0
    for (const r of reads) {
      if (r.read.ok) break
      consecutiveFailures++
    }
    const removed = config !== null && !inConfig.has(entry.id)
    // Activée mais absente du dernier passage : le scanner ne la lit plus (réglages de repli, version antérieure).
    const skipped = latest !== null && last !== null && last.at !== latest.startedAt
    const health: SourceHealth = removed ? 'removed'
      : !entry.enabled ? 'disabled'
      : !last ? 'never'
      : skipped ? 'skipped'
      : !last.read.ok ? 'error'
      : last.read.warnings.length ? 'warning'
      : 'ok'
    siteFor(siteOfSource(entry.id, config, seen.get(entry.id))).searches.push({
      id: entry.id,
      label: entry.label,
      health,
      lastRun: last ? runOf(last.at, last.read) : null,
      lastSuccessAt: reads.find(r => r.read.ok)?.at ?? null,
      consecutiveFailures,
    })
  }
  // Toujours proposées : les offres reçues par e-mail sont la moitié de la page.
  siteFor(EMAIL_SITE)

  for (const run of runs) {
    if (!inPeriod(run.report.startedAt, period)) continue
    const read = new Set<string>()
    for (const source of run.report.sources) {
      const site = sites.get(siteIdOf(source.id))
      if (!site) continue
      read.add(site.id)
      site.reads.sent += source.sent
      site.reads.outOfScope += source.outOfScope
      site.reads.outdated += source.outdated
    }
    for (const id of read) {
      const site = sites.get(id)
      if (site) site.reads.runs++
    }
  }

  for (const offer of input.offers) {
    if (!inPeriod(offer.receivedAt, period)) continue
    // Site déjà connu (recherche retirée vue dans un rapport) : il garde le libellé du rapport.
    const site = siteFor(siteOfOffer(offer, config))
    site.offers.total++
    site.offers.byStatus[offer.status]++
  }

  for (const site of sites.values()) {
    const active = site.searches.filter(isActive)
    site.active = active.length
    site.failing = active.filter(s => s.health === 'error').length
    site.warning = active.filter(s => s.health === 'warning').length
    site.lastSuccessAt = site.searches.reduce<string | null>((max, s) => (s.lastSuccessAt && (!max || s.lastSuccessAt > max) ? s.lastSuccessAt : max), null)
    site.health = !readsKnown || site.kind === 'email' || site.id === UNKNOWN_SOURCE_SITE.id ? null
      : active.length ? ACTIVE_HEALTH.find(h => active.some(s => s.health === h)) ?? 'ok'
      : site.searches.some(s => s.health === 'disabled') ? 'disabled'
      // Site vu seulement dans les offres : sa recherche n'est plus dans les réglages.
      : config !== null ? 'removed'
      : null
  }

  const groupOf = (kind: SiteKind) => SITE_GROUPS.findIndex(g => g.kinds.includes(kind))
  return {
    readsKnown,
    lastRunAt: latest?.startedAt ?? null,
    firstRunAt: runs.at(-1)?.report.startedAt ?? null,
    stale: !latest || input.now.getTime() - Date.parse(latest.finishedAt) > STALE_AFTER_HOURS * 3_600_000,
    settings: latest
      ? { ...latest.settings, outdated: latest.settings.origin !== 'remote' || (input.configVersion !== null && latest.settings.version !== input.configVersion) }
      : null,
    deliveryError: latest?.deliveryError ?? null,
    otherWarnings: latest?.otherWarnings ?? [],
    // Tri stable : dans un groupe, l'ordre des réglages, puis les sites vus dans les rapports, puis dans les offres.
    sites: [...sites.values()].sort((a, b) => groupOf(a.kind) - groupOf(b.kind)),
  }
}
