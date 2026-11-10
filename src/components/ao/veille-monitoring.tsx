import Link from 'next/link'
import { ChartCard } from './stats-charts'
import { MONITORING_WINDOW_DAYS, STALE_AFTER_HOURS, type SourceHealth, type SourceMonitoring, type VeilleMonitoring } from '@/lib/veille/monitoring'

// Suivi des sources de la veille (ADR 0030), en bas de /admin/candidats/statistiques : état de chaque source des
// réglages d'après les rapports de passage du scanner, et offres AO qu'elle a apportées. Affichage seulement.

const muted = { color: 'var(--admin-fg-muted)' } as const
const fg = { color: 'var(--admin-fg)' } as const

const HEALTH: Record<SourceHealth, { label: string; color: string }> = {
  ok: { label: 'OK', color: '#047857' },
  warning: { label: 'À vérifier', color: '#b45309' },
  error: { label: 'En échec', color: '#b91c1c' },
  skipped: { label: 'Non lue au dernier passage', color: '#b45309' },
  never: { label: 'Jamais lue', color: '#1d4ed8' },
  disabled: { label: 'Désactivée', color: '#6B6B70' },
  removed: { label: 'Retirée des réglages', color: '#6B6B70' },
}

const PARIS = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
/** Date et heure de Paris (« 10/11/2026 10:00 ») ; les passages sont planifiés en UTC. */
const atParis = (iso: string) => PARIS.format(new Date(iso)).replace(',', '')

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`

function HealthBadge({ source }: { source: SourceMonitoring }) {
  const { label, color } = HEALTH[source.health]
  const since = source.health === 'error' && source.consecutiveFailures > 1 ? ` (${source.consecutiveFailures} passages)` : ''
  return (
    <span className="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color, background: `${color}18` }}>
      {label}{since}
    </span>
  )
}

function Problem({ source }: { source: SourceMonitoring }) {
  const run = source.lastRun
  if (!run) return null
  const text = run.error ?? run.warnings[0]
  if (!text) return null
  const more = run.error ? run.warnings.length : run.warnings.length - 1
  return (
    <p className="mt-1 text-xs break-words" style={{ color: run.error ? '#b91c1c' : '#b45309' }}>
      {text}{more > 0 ? ` (+${more} autre${more > 1 ? 's' : ''})` : ''}
    </p>
  )
}

function Alerts({ monitoring }: { monitoring: VeilleMonitoring }) {
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

function Offers({ offers }: { offers: SourceMonitoring['offers'] }) {
  if (!offers.total) return <span style={muted}>—</span>
  const { published, to_review: toReview, ignored } = offers.byStatus
  return (
    <span title={`${published} publiée(s), ${toReview} à valider, ${ignored} ignorée(s)`}>
      <span className="font-semibold" style={fg}>{offers.recent}</span>
      <span style={muted}> / {offers.total}</span>
      <span className="block text-xs" style={muted}>{published} publ. · {toReview} à val. · {ignored} ign.</span>
    </span>
  )
}

interface Props {
  monitoring: VeilleMonitoring | null
  /** Suivi indisponible (collection absente, lecture impossible) : message à afficher à la place. */
  error: string
}

export function VeilleMonitoringSection({ monitoring, error }: Props) {
  const note = monitoring?.lastRunAt
    ? `Dernier passage : ${atParis(monitoring.lastRunAt)} (heure de Paris). Totaux sur ${MONITORING_WINDOW_DAYS} jours.`
    : `Totaux sur ${MONITORING_WINDOW_DAYS} jours.`
  return (
    <ChartCard title="Veille : suivi des sources" note={note}>
      {error ? (
        <p role="alert" className="text-sm" style={{ color: '#b91c1c' }}>{error}</p>
      ) : monitoring && (
        <>
          <Alerts monitoring={monitoring} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <caption className="sr-only">État de chaque source de la veille et offres apportées</caption>
              <thead>
                <tr className="text-left text-xs" style={muted}>
                  <th scope="col" className="pb-2 pr-3 font-medium">Source</th>
                  <th scope="col" className="pb-2 pr-3 font-medium">État</th>
                  <th scope="col" className="pb-2 pr-3 font-medium">Dernière lecture réussie</th>
                  <th scope="col" className="pb-2 pr-3 font-medium text-right" title="Annonces lues (déjà vues comprises) / nouvelles / envoyées à la boîte AO">Dernier passage<br />lues · nouv. · env.</th>
                  <th scope="col" className="pb-2 pr-3 font-medium text-right" title="Annonces envoyées à la boîte AO, écartées hors informatique, échues (chacune comptée une fois)">{MONITORING_WINDOW_DAYS} jours<br />env. · hors info · échues</th>
                  <th scope="col" className="pb-2 font-medium text-right" title="Offres AO créées dans la boîte : 30 derniers jours / total conservé">Offres AO<br />30 j / total</th>
                </tr>
              </thead>
              <tbody>
                {monitoring.sources.map(source => (
                  <tr key={source.id} className="align-top" style={{ borderTop: '1px solid var(--admin-line)' }}>
                    <td className="py-2.5 pr-3 max-w-[18rem]">
                      <span className="font-medium" style={fg}>{source.label}</span>
                      <span className="block text-xs" style={muted}>
                        {source.kind === 'tender' ? 'Appels d\'offres' : 'Offres d\'emploi'}{source.organisation ? ` · ${source.organisation}` : ''}
                      </span>
                      <Problem source={source} />
                    </td>
                    <td className="py-2.5 pr-3"><HealthBadge source={source} /></td>
                    <td className="py-2.5 pr-3 whitespace-nowrap" style={source.lastSuccessAt ? fg : muted}>{source.lastSuccessAt ? atParis(source.lastSuccessAt) : '—'}</td>
                    <td className="py-2.5 pr-3 text-right whitespace-nowrap" style={{ ...fg, fontVariantNumeric: 'tabular-nums' }}>
                      {source.lastRun?.ok ? `${source.lastRun.listed} · ${source.lastRun.new} · ${source.lastRun.sent}` : <span style={muted}>—</span>}
                      {source.lastRun && source.lastRun.pending > 0 && <span className="block text-xs" style={muted}>{source.lastRun.pending} en attente</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-right whitespace-nowrap" style={{ ...fg, fontVariantNumeric: 'tabular-nums' }}
                      title={`${plural(source.window.runs, 'passage')} sur ${MONITORING_WINDOW_DAYS} jours`}>
                      {source.window.runs ? `${source.window.sent} · ${source.window.outOfScope} · ${source.window.outdated}` : <span style={muted}>—</span>}
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}><Offers offers={source.offers} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {monitoring.unknownOffers.total > 0 && (
            <p className="mt-3 text-xs" style={muted}>
              {plural(monitoring.unknownOffers.total, 'offre')} de la veille sans source connue (reçues avant le suivi des sources).
            </p>
          )}
          <p className="mt-3 text-xs" style={muted}>
            Sources et organismes : <Link href="/admin/veille" className="font-semibold underline" style={fg}>réglages de la veille</Link>.
          </p>
        </>
      )}
    </ChartCard>
  )
}
