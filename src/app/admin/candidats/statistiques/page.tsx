import { requireAdmin } from '@/lib/appwrite/auth'
import { AO_MAX_LISTED, EMPTY_AO_FILTERS, type AoOfferRow } from '@/lib/ao/filters'
import { listAllAoOfferRows } from '@/lib/ao/repo'
import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'
import { periodLabel, selectedSites, statsFiltersFromParams } from '@/lib/ao/stats-filters'
import type { VeilleConfig } from '@/lib/veille/config'
import { SITE_GROUPS, buildVeilleMonitoring, siteOfOffer, type StoredRun } from '@/lib/veille/monitoring'
import { isVeilleRunsStorageConfigured, listVeilleRuns } from '@/lib/veille/runs-store'
import { getLatestVeilleConfig, isVeilleConfigStorageConfigured } from '@/lib/veille/store'
import { AoStatsView } from '@/components/ao/ao-stats-view'
import { StatsFilters } from '@/components/ao/stats-filters'
import { VeilleMonitoringSection } from '@/components/ao/veille-monitoring'

// Statistiques des offres AO de la plateforme (même périmètre que /admin/candidats), par période et par site source
// (demande du 2026-11-13 : filtres de dates et de sites, « Tout sélectionner » ; toute la page les suit), avec l'état de
// lecture de chaque site de la veille (ADR 0030) : seule la plateforme reçoit les offres de la veille.
export const dynamic = 'force-dynamic'

export default async function AoStatsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin()
  const now = new Date()
  const filters = statsFiltersFromParams(await searchParams, now)

  let rows: AoOfferRow[] = []
  let loadError = ''
  try {
    rows = await listAllAoOfferRows(PLATFORM_TENANT_ID, { ...EMPTY_AO_FILTERS, from: filters.period.from, to: filters.period.to })
  } catch (err) {
    console.error('AO: statistiques indisponibles', err instanceof Error ? err.message : err)
    loadError = 'Impossible de charger les offres AO : vérifiez les collections AO (npm run ao:setup) et leurs variables APPWRITE_COLLECTION_AO_*.'
  }

  // Réglages et rapports de la veille, lus séparément : sans l'un, l'autre sert encore ; sans les deux, les offres restent
  // comptées par site (sites tirés des offres).
  const [latest, stored] = await Promise.allSettled([
    isVeilleConfigStorageConfigured() ? getLatestVeilleConfig() : Promise.resolve(null),
    isVeilleRunsStorageConfigured() ? listVeilleRuns() : Promise.resolve(null),
  ])
  const config: VeilleConfig | null = latest.status === 'fulfilled' ? latest.value?.config ?? null : null
  const configVersion = latest.status === 'fulfilled' ? latest.value?.version ?? null : null
  const runs: StoredRun[] | null = stored.status === 'fulfilled' ? stored.value : null
  const monitoringErrors: string[] = []
  if (!isVeilleRunsStorageConfigured()) {
    monitoringErrors.push('État des sites de la veille non suivi : créez la collection veille_runs (npm run schema:push) et définissez APPWRITE_COLLECTION_VEILLE_RUNS (ADR 0030).')
  } else if (stored.status === 'rejected') {
    console.error('[veille] rapports de passage illisibles', stored.reason instanceof Error ? stored.reason.message : String(stored.reason))
    monitoringErrors.push('Rapports de passage de la veille illisibles pour le moment : rechargez la page dans quelques instants.')
  }
  if (latest.status === 'rejected') {
    console.error('[veille] réglages illisibles', latest.reason instanceof Error ? latest.reason.message : String(latest.reason))
    monitoringErrors.push('Réglages de la veille illisibles : sites regroupés d\'après les rapports, recherches désactivées non signalées.')
  }

  const monitoring = buildVeilleMonitoring({
    config,
    configVersion,
    runs,
    offers: rows.map(r => ({ veilleSource: r.veilleSource, channel: r.channel, status: r.status, receivedAt: r.receivedAt })),
    period: filters.period,
    now,
  })
  const siteIds = monitoring.sites.map(s => s.id)
  const selected = selectedSites(filters.sites, siteIds)
  const shownRows = selected.size === siteIds.length ? rows : rows.filter(r => selected.has(siteOfOffer(r, config).id))

  const groups = SITE_GROUPS.map(group => ({
    label: group.label,
    sites: monitoring.sites.filter(s => group.kinds.includes(s.kind)).map(s => ({ id: s.id, label: s.label, count: loadError ? null : s.offers.total })),
  })).filter(group => group.sites.length)
  const sitesText = selected.size === siteIds.length ? 'tous les sites sources' : `${selected.size} site${selected.size > 1 ? 's' : ''} source${selected.size > 1 ? 's' : ''} sur ${siteIds.length}`
  // La lecture s'arrête aux AO_MAX_LISTED offres les plus récentes (comme la liste) : le début d'une longue période manque.
  const capped = rows.length >= AO_MAX_LISTED ? ` Seules les ${AO_MAX_LISTED.toLocaleString('fr-FR')} offres les plus récentes sont comptées : réduisez la période.` : ''
  const summary = `${shownRows.length} offre${shownRows.length > 1 ? 's' : ''} reçue${shownRows.length > 1 ? 's' : ''} ${periodLabel(filters.period)}, ${sitesText}. Doublons fusionnés : une offre reçue plusieurs fois compte une fois.${capped}`

  return (
    <AoStatsView titleInAdminBar rows={shownRows} loadError={loadError} back={{ href: '/admin/candidats', label: 'Candidats' }} scope="de la plateforme" now={now}
      period={filters.period} summary={summary}
      toolbar={(
        // Clé : un retour à la page sans filtre (« Réinitialiser ») repart des cases de l'adresse, pas de celles cochées avant.
        <StatsFilters key={`${filters.period.from}|${filters.period.to}|${filters.preset}|${[...selected].join(',')}`}
          period={filters.period} preset={filters.preset} groups={groups} selected={[...selected]} />
      )}>
      <VeilleMonitoringSection monitoring={monitoring} selected={selected} period={filters.period} error={monitoringErrors.join(' ')} offersKnown={!loadError} />
    </AoStatsView>
  )
}
