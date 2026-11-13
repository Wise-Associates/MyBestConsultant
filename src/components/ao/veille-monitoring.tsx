import Link from 'next/link'
import { ChartCard } from './stats-charts'
import { dayOfInstant, frenchDay, periodLabel, type StatsPeriod } from '@/lib/ao/stats-filters'
import { SITE_GROUPS, STALE_AFTER_HOURS, UNKNOWN_SOURCE_SITE, type OfferCounts, type SearchMonitoring, type SiteMonitoring, type SourceHealth, type VeilleMonitoring } from '@/lib/veille/monitoring'

// « Par site source » (ADR 0030, par site depuis le 2026-11-13), sous les chiffres de /admin/candidats/statistiques :
// pour chaque site retenu par les filtres, son état d'après les rapports de passage du scanner, les annonces lues sur la
// période et les offres AO qu'il a apportées. Affichage seulement ; règles dans src/lib/veille/monitoring.ts.

const muted = { color: 'var(--admin-fg-muted)' } as const
const fg = { color: 'var(--admin-fg)' } as const
const numbers = { ...fg, fontVariantNumeric: 'tabular-nums' } as const

/** Libellés au masculin : ils qualifient un site (ou une recherche dans le détail). */
const HEALTH: Record<SourceHealth, { label: string; color: string }> = {
  ok: { label: 'OK', color: '#047857' },
  warning: { label: 'À vérifier', color: '#b45309' },
  error: { label: 'En échec', color: '#b91c1c' },
  skipped: { label: 'Non lu au dernier passage', color: '#b45309' },
  never: { label: 'Jamais lu', color: '#1d4ed8' },
  disabled: { label: 'Désactivé', color: '#6B6B70' },
  removed: { label: 'Retiré des réglages', color: '#6B6B70' },
}

const PARIS = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
/** Date et heure de Paris (« 10/11/2026 10:00 ») ; les passages sont planifiés en UTC. */
const atParis = (iso: string) => PARIS.format(new Date(iso)).replace(',', '')

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`

function Badge({ health, detail = '' }: { health: SourceHealth; detail?: string }) {
  const { label, color } = HEALTH[health]
  return (
    <span className="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color, background: `${color}18` }}>
      {label}{detail}
    </span>
  )
}

function SiteHealth({ site }: { site: SiteMonitoring }) {
  if (!site.health) return <span style={muted}>—</span>
  const single = site.searches.length === 1 ? site.searches[0] : null
  // Une recherche : depuis combien de passages ; plusieurs : combien sont touchées.
  const detail = site.health === 'error'
    ? (single ? (single.consecutiveFailures > 1 ? ` (${single.consecutiveFailures} passages)` : '') : ` : ${site.failing} sur ${site.active}`)
    : site.health === 'warning' && !single ? ` : ${site.warning} sur ${site.active}` : ''
  return <Badge health={site.health} detail={detail} />
}

/** Premier problème du site (échec, sinon alerte), avec la recherche en cause quand le site en a plusieurs. */
function Problem({ site }: { site: SiteMonitoring }) {
  const failing = site.searches.find(s => s.health === 'error' && s.lastRun?.error)
  const warned = site.searches.find(s => (s.health === 'warning' || s.health === 'error') && s.lastRun?.warnings.length)
  const search = failing ?? warned
  const text = failing?.lastRun?.error ?? warned?.lastRun?.warnings[0]
  if (!search || !text) return null
  return (
    <p className="mt-1 text-xs break-words" style={{ color: failing ? '#b91c1c' : '#b45309' }}>
      {site.searches.length > 1 ? `${search.label} : ` : ''}{text}
    </p>
  )
}

function Searches({ searches }: { searches: SearchMonitoring[] }) {
  if (searches.length < 2) return null
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer" style={muted}>{searches.length} recherches</summary>
      <ul className="mt-1.5 space-y-1.5">
        {searches.map(s => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span style={fg}>{s.label}</span>
            <Badge health={s.health} detail={s.health === 'error' && s.consecutiveFailures > 1 ? ` (${s.consecutiveFailures} passages)` : ''} />
            {s.lastSuccessAt && <span style={muted}>lu le {atParis(s.lastSuccessAt)}</span>}
          </li>
        ))}
      </ul>
    </details>
  )
}

function Offers({ offers, known }: { offers: OfferCounts; known: boolean }) {
  if (!known) return <span style={muted} title="Offres AO illisibles (voir le message en haut de la page)">—</span>
  const { published, to_review: toReview, ignored } = offers.byStatus
  return (
    <>
      <span className="font-semibold" style={numbers}>{offers.total}</span>
      {offers.total > 0 && (
        <span className="block text-xs whitespace-nowrap" style={muted}>{published} publiée{published > 1 ? 's' : ''} · {toReview} à valider · {ignored} ignorée{ignored > 1 ? 's' : ''}</span>
      )}
    </>
  )
}

function Alerts({ monitoring }: { monitoring: VeilleMonitoring }) {
  if (!monitoring.readsKnown) return null
  const alerts: string[] = []
  if (!monitoring.lastRunAt) {
    alerts.push('Aucun rapport de passage reçu : le scanner n\'a pas encore tourné avec le suivi, ou ne joint pas ce site (VEILLE_CONFIG_URL, VEILLE_CONFIG_TOKEN).')
  } else if (monitoring.stale) {
    alerts.push(`Aucun rapport depuis plus de ${STALE_AFTER_HOURS} heures : le scanner est peut-être arrêté, ou ses passages échouent avant la fin (alerte e-mail envoyée à l'équipe).`)
  }
  if (monitoring.settings?.origin === 'defaults') alerts.push('Le dernier passage a utilisé les réglages du dépôt du scanner, pas ceux de /admin/veille.')
  else if (monitoring.settings?.origin === 'snapshot') alerts.push(`Le dernier passage n'a pas pu lire /admin/veille : il a utilisé la version ${monitoring.settings.version ?? '?'} qu'il connaissait.`)
  else if (monitoring.settings?.outdated) alerts.push(`Le dernier passage a utilisé la version ${monitoring.settings.version ?? '?'} des réglages : la version en vigueur s'appliquera au prochain.`)
  if (monitoring.deliveryError) alerts.push(`Envoi des offres interrompu au dernier passage : ${monitoring.deliveryError}`)
  for (const w of monitoring.otherWarnings) alerts.push(`${w.label} : ${w.message}`)
  if (!alerts.length) return null
  return (
    <ul role="status" className="mb-4 space-y-1.5 rounded-xl p-3 text-sm" style={{ background: 'rgba(180,83,9,0.06)', border: '1px solid rgba(180,83,9,0.2)', color: '#b45309' }}>
      {alerts.map(a => <li key={a} className="break-words">{a}</li>)}
    </ul>
  )
}

/** Site lu par la veille (pas la boîte AO ni les offres sans source) : ses chiffres de lecture ont un sens. */
const isRead = (site: SiteMonitoring) => site.searches.length > 0

const COLUMNS = [
  { label: 'Site source', title: '', align: 'left' },
  { label: 'État', title: 'État au dernier passage de la veille', align: 'left' },
  { label: 'Dernière lecture réussie', title: '', align: 'left' },
  { label: 'Annonces envoyées', title: 'Annonces que la veille a envoyées à la boîte AO sur la période', align: 'right' },
  { label: 'Écartées hors informatique', title: 'Nouvelles annonces écartées par le filtre informatique sur la période', align: 'right' },
  { label: 'Échues', title: 'Annonces non envoyées : date limite déjà passée', align: 'right' },
  { label: 'Offres AO créées', title: 'Offres enregistrées dans la boîte AO sur la période, par statut actuel', align: 'right' },
] as const

interface Props {
  monitoring: VeilleMonitoring
  /** Sites retenus par les filtres de la page. */
  selected: ReadonlySet<string>
  period: StatsPeriod
  /** Suivi non configuré ou illisible : affiché au-dessus du tableau (les offres restent comptées). */
  error: string
  /** Offres AO lues : sinon leurs colonnes affichent « — » (pas un zéro). */
  offersKnown: boolean
}

export function VeilleMonitoringSection({ monitoring, selected, period, error, offersKnown }: Props) {
  const shown = monitoring.sites.filter(s => selected.has(s.id))
  const readSites = shown.filter(isRead)
  const showReads = monitoring.readsKnown
  const sum = (key: 'sent' | 'outOfScope' | 'outdated') => readSites.reduce((n, s) => n + s.reads[key], 0)
  const totalOffers: OfferCounts = {
    total: shown.reduce((n, s) => n + s.offers.total, 0),
    byStatus: {
      published: shown.reduce((n, s) => n + s.offers.byStatus.published, 0),
      to_review: shown.reduce((n, s) => n + s.offers.byStatus.to_review, 0),
      ignored: shown.reduce((n, s) => n + s.offers.byStatus.ignored, 0),
    },
  }
  const firstRunDay = monitoring.firstRunAt ? dayOfInstant(monitoring.firstRunAt) : ''
  const note = `Reçues ${periodLabel(period)}.${monitoring.lastRunAt ? ` Dernier passage de la veille : ${atParis(monitoring.lastRunAt)} (heure de Paris).` : ''}`

  const readCell = (site: SiteMonitoring, value: number) => (showReads && isRead(site) && site.reads.runs > 0
    ? value
    : <span style={muted} title={showReads && isRead(site) ? 'Aucun passage de la veille sur la période' : undefined}>—</span>)

  return (
    <ChartCard title="Par site source" note={note}>
      {error && <p role="alert" className="mb-4 text-sm" style={{ color: '#b91c1c' }}>{error}</p>}
      <Alerts monitoring={monitoring} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <caption className="sr-only">Offres reçues et état de lecture de chaque site source, {periodLabel(period)}</caption>
          <thead>
            <tr className="text-xs" style={muted}>
              {COLUMNS.map(c => (
                <th key={c.label} scope="col" title={c.title || undefined} className={`pb-2 pr-3 last:pr-0 font-medium align-bottom ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          {SITE_GROUPS.map(group => {
            const sites = shown.filter(s => group.kinds.includes(s.kind))
            if (!sites.length) return null
            return (
              <tbody key={group.label}>
                <tr>
                  <th scope="colgroup" colSpan={COLUMNS.length} className="pt-4 pb-1.5 text-left text-xs font-semibold" style={fg}>{group.label}</th>
                </tr>
                {sites.map(site => (
                  <tr key={site.id} className="align-top" style={{ borderTop: '1px solid var(--admin-line)' }}>
                    <th scope="row" className="py-2.5 pr-3 max-w-[20rem] text-left font-normal">
                      <span className="font-medium" style={fg}>{site.label}</span>
                      {site.kind === 'email' && <span className="block text-xs" style={muted}>Offres reçues par e-mail dans la boîte AO</span>}
                      {site.id === UNKNOWN_SOURCE_SITE.id && <span className="block text-xs" style={muted}>Offres de la veille reçues avant le suivi des sources</span>}
                      <Problem site={site} />
                      <Searches searches={site.searches} />
                    </th>
                    <td className="py-2.5 pr-3"><SiteHealth site={site} /></td>
                    <td className="py-2.5 pr-3 whitespace-nowrap" style={site.lastSuccessAt ? fg : muted}>{site.lastSuccessAt ? atParis(site.lastSuccessAt) : '—'}</td>
                    <td className="py-2.5 pr-3 text-right" style={numbers}>{readCell(site, site.reads.sent)}</td>
                    <td className="py-2.5 pr-3 text-right" style={numbers}>{readCell(site, site.reads.outOfScope)}</td>
                    <td className="py-2.5 pr-3 text-right" style={numbers}>{readCell(site, site.reads.outdated)}</td>
                    <td className="py-2.5 text-right"><Offers offers={site.offers} known={offersKnown} /></td>
                  </tr>
                ))}
              </tbody>
            )
          })}
          <tfoot>
            <tr className="align-top" style={{ borderTop: '1px solid var(--admin-line-strong)' }}>
              <th scope="row" className="py-2.5 pr-3 text-left font-semibold" style={fg}>
                Total{shown.length < monitoring.sites.length ? ` (${plural(shown.length, 'site')} sur ${monitoring.sites.length})` : ''}
              </th>
              <td className="py-2.5 pr-3" colSpan={2} />
              {(['sent', 'outOfScope', 'outdated'] as const).map(key => (
                <td key={key} className="py-2.5 pr-3 text-right font-semibold" style={numbers}>{showReads && readSites.length ? sum(key) : <span style={muted}>—</span>}</td>
              ))}
              <td className="py-2.5 text-right"><Offers offers={totalOffers} known={offersKnown} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="mt-4 space-y-1.5 text-xs" style={muted}>
        {showReads && firstRunDay && firstRunDay > period.from && (
          <p>Chiffres de lecture de la veille disponibles depuis le {frenchDay(firstRunDay)} : les passages plus anciens ne sont pas gardés.</p>
        )}
        <p>
          « Annonces envoyées » : envoyées par la veille à la boîte AO. « Offres AO créées » : offres enregistrées à partir de ces
          e-mails et des autres — une annonce déjà reçue par un autre canal, ou échue à son arrivée, n&apos;en crée pas de nouvelle.
        </p>
        <p>Recherches et organismes de chaque site : <Link href="/admin/veille" className="font-semibold underline" style={fg}>réglages de la veille</Link>.</p>
      </div>
    </ChartCard>
  )
}
