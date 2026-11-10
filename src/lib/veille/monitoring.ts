import type { AoOfferStatus } from '@/lib/ao/types'
import { BUILTIN_SOURCES, type VeilleConfig, type VeilleSource } from './config'
import type { RunReport, SourceRunReport } from './run-report'

// Suivi des sources de la veille (ADR 0030), affiché dans /admin/candidats/statistiques : pour chaque source des
// réglages, son état d'après les rapports de passage du scanner et les offres AO qu'elle a apportées. Règles pures,
// testées dans monitoring.test.ts.

/** Recherches chez tous les acheteurs (ADR 0006 du scanner) : sources du scanner sans entrée dans les réglages. */
export const ALL_BUYERS_SOURCES = {
  'boamp-tous-acheteurs': { label: 'BOAMP — tous les acheteurs', parent: 'boamp' },
  'ted-tous-acheteurs': { label: 'TED — tous les acheteurs', parent: 'ted' },
} as const

/** Identifiant des offres de la veille reçues sans source (avant le suivi, ou en-tête absent). */
export const UNKNOWN_SOURCE_ID = ''

/** Fenêtre des totaux (passages et offres reçues). */
export const MONITORING_WINDOW_DAYS = 30

/**
 * Passages à 5 h, 9 h, 13 h et 17 h UTC : la plus longue attente normale est de 12 heures (17 h → 5 h). Au-delà de 13
 * heures sans rapport, le scanner est arrêté, en échec avant l'enregistrement de son état, ou ne joint plus ce site.
 */
export const STALE_AFTER_HOURS = 13

const DAY_MS = 86_400_000

export interface StoredRun {
  report: RunReport
}

export type SourceHealth = 'ok' | 'warning' | 'error' | 'skipped' | 'never' | 'disabled' | 'removed'

export interface SourceMonitoring {
  id: string
  label: string
  kind: 'tender' | 'job'
  /** Organisme dont la source lit les offres ; '' pour BOAMP et TED (tous les organismes suivis). */
  organisation: string
  health: SourceHealth
  /** Dernier passage qui a lu cette source. */
  lastRun: (Omit<SourceRunReport, 'id' | 'label' | 'kind'> & { at: string }) | null
  lastSuccessAt: string | null
  /** Passages en échec de suite, du plus récent en arrière. */
  consecutiveFailures: number
  /**
   * Sur MONITORING_WINDOW_DAYS : annonces envoyées, écartées hors informatique, échues — chacune comptée une seule fois.
   * Pas les « nouvelles » : une offre en attente (plafond du passage, envoi interrompu) redevient nouvelle à chaque
   * passage jusqu'à son envoi, et serait comptée plusieurs fois.
   */
  window: { runs: number; sent: number; outOfScope: number; outdated: number }
  /** Offres AO créées dans la boîte à partir des e-mails de cette source. */
  offers: { total: number; recent: number; byStatus: Record<AoOfferStatus, number> }
}

export interface VeilleMonitoring {
  lastRunAt: string | null
  /** Aucun rapport depuis STALE_AFTER_HOURS (ou jamais). */
  stale: boolean
  /** Réglages utilisés par le dernier passage, et s'ils diffèrent de la version en vigueur. */
  settings: { origin: RunReport['settings']['origin']; version: number | null; outdated: boolean } | null
  deliveryError: string | null
  otherWarnings: RunReport['otherWarnings']
  sources: SourceMonitoring[]
  /** Offres de la veille sans source connue (reçues avant le suivi). */
  unknownOffers: SourceMonitoring['offers']
}

interface CatalogEntry {
  id: string
  label: string
  kind: 'tender' | 'job'
  organisation: string
  enabled: boolean
}

function labelOf(source: VeilleSource): string {
  if (source.kind === 'boamp') return 'BOAMP'
  if (source.kind === 'ted') return 'TED (Journal officiel de l\'UE)'
  if (source.kind === 'builtin') return BUILTIN_SOURCES[source.id].label
  return source.label
}

/** Sources des réglages, dans leur ordre, chacune suivie de sa recherche chez tous les acheteurs pour BOAMP et TED. */
function catalog(config: VeilleConfig): CatalogEntry[] {
  const organisations = new Map(config.organisations.map(o => [o.id, o]))
  const entries: CatalogEntry[] = []
  for (const source of config.sources) {
    if (source.kind === 'boamp' || source.kind === 'ted') {
      entries.push({ id: source.id, label: labelOf(source), kind: 'tender', organisation: '', enabled: source.enabled })
      const [allId, all] = Object.entries(ALL_BUYERS_SOURCES).find(([, s]) => s.parent === source.id) ?? []
      if (allId && all) {
        entries.push({ id: allId, label: all.label, kind: 'tender', organisation: 'Autres acheteurs', enabled: source.enabled && config.tenderKeywords.allBuyers })
      }
      continue
    }
    const organisationId = source.kind === 'builtin' ? BUILTIN_SOURCES[source.id].organisationId : source.organisationId
    const organisation = organisations.get(organisationId)
    entries.push({
      id: source.id,
      label: labelOf(source),
      kind: 'job',
      organisation: organisation?.name ?? organisationId,
      enabled: source.enabled && (organisation?.enabled ?? false),
    })
  }
  return entries
}

/** Ce qu'un passage a fait d'une source, sans ce que la ligne affiche déjà (identifiant, libellé, type). */
function runOf(at: string, read: SourceRunReport): NonNullable<SourceMonitoring['lastRun']> {
  const { ok, error, listed, outOfScope, outdated, pending, sent, warnings } = read
  return { at, ok, error, listed, outOfScope, new: read.new, sent, outdated, pending, warnings }
}

const emptyOffers = (): SourceMonitoring['offers'] => ({ total: 0, recent: 0, byStatus: { to_review: 0, published: 0, ignored: 0 } })

export interface MonitoredOffer {
  /** '' : offre de la veille sans source connue. */
  veilleSource: string
  channel: 'email' | 'scraping'
  status: AoOfferStatus
  receivedAt: string
}

/**
 * `runs` : rapports enregistrés, dans n'importe quel ordre ; `config` : réglages en vigueur (null s'ils sont illisibles :
 * seules les sources vues dans les rapports sont listées) ; `offers` : offres AO de la plateforme.
 */
export function buildVeilleMonitoring(input: {
  config: VeilleConfig | null
  configVersion: number | null
  runs: StoredRun[]
  offers: MonitoredOffer[]
  now: Date
}): VeilleMonitoring {
  const runs = [...input.runs].sort((a, b) => b.report.startedAt.localeCompare(a.report.startedAt))
  const windowStart = new Date(input.now.getTime() - MONITORING_WINDOW_DAYS * DAY_MS).toISOString()
  const latest = runs[0]?.report ?? null

  const entries = input.config ? catalog(input.config) : []
  const inConfig = new Set(entries.map(e => e.id))
  const known = new Set(inConfig)
  // Source lue par le scanner mais absente des réglages (retirée depuis, ou réglages illisibles) : gardée, libellé du
  // dernier rapport, pour que ses échecs et ses offres restent visibles.
  for (const run of runs) {
    for (const source of run.report.sources) {
      if (known.has(source.id)) continue
      known.add(source.id)
      entries.push({ id: source.id, label: source.label, kind: source.kind, organisation: '', enabled: input.config === null })
    }
  }

  const offersBySource = new Map<string, SourceMonitoring['offers']>()
  for (const offer of input.offers) {
    if (offer.channel !== 'scraping') continue
    const counts = offersBySource.get(offer.veilleSource) ?? emptyOffers()
    counts.total++
    if (offer.receivedAt >= windowStart) counts.recent++
    counts.byStatus[offer.status]++
    offersBySource.set(offer.veilleSource, counts)
  }
  for (const id of offersBySource.keys()) {
    if (id === UNKNOWN_SOURCE_ID || known.has(id)) continue
    known.add(id)
    entries.push({ id, label: id, kind: 'tender', organisation: '', enabled: false })
  }

  const sources = entries.map((entry): SourceMonitoring => {
    const reads = runs.flatMap(run => {
      const read = run.report.sources.find(s => s.id === entry.id)
      return read ? [{ at: run.report.startedAt, read }] : []
    })
    const last = reads[0] ?? null
    const lastSuccess = reads.find(r => r.read.ok) ?? null
    let consecutiveFailures = 0
    for (const r of reads) {
      if (r.read.ok) break
      consecutiveFailures++
    }
    const recent = reads.filter(r => r.at >= windowStart)
    const sum = (key: 'sent' | 'outOfScope' | 'outdated') => recent.reduce((n, r) => n + r.read[key], 0)
    const removed = input.config !== null && !inConfig.has(entry.id)
    // Activée mais absente du dernier passage : le scanner ne la lit plus (réglages de repli, version antérieure).
    const skipped = latest !== null && last !== null && last.at !== latest.startedAt
    const health: SourceHealth = removed ? 'removed'
      : !entry.enabled ? 'disabled'
      : !last ? 'never'
      : skipped ? 'skipped'
      : !last.read.ok ? 'error'
      : last.read.warnings.length ? 'warning'
      : 'ok'
    return {
      id: entry.id,
      label: entry.label,
      kind: entry.kind,
      organisation: entry.organisation,
      health,
      lastRun: last ? runOf(last.at, last.read) : null,
      lastSuccessAt: lastSuccess?.at ?? null,
      consecutiveFailures,
      window: { runs: recent.length, sent: sum('sent'), outOfScope: sum('outOfScope'), outdated: sum('outdated') },
      offers: offersBySource.get(entry.id) ?? emptyOffers(),
    }
  })

  return {
    lastRunAt: latest?.startedAt ?? null,
    stale: !latest || input.now.getTime() - Date.parse(latest.finishedAt) > STALE_AFTER_HOURS * 3_600_000,
    settings: latest
      ? { ...latest.settings, outdated: latest.settings.origin !== 'remote' || (input.configVersion !== null && latest.settings.version !== input.configVersion) }
      : null,
    deliveryError: latest?.deliveryError ?? null,
    otherWarnings: latest?.otherWarnings ?? [],
    sources,
    unknownOffers: offersBySource.get(UNKNOWN_SOURCE_ID) ?? emptyOffers(),
  }
}
