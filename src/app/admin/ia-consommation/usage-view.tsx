import { featureLabel, outcomeLabel } from '@/lib/ai/usage-labels'
import type { UsageDay, UsageGroup, UsageSummary, UsageTotals } from '@/lib/ai/usage-stats'

// Affichage de la page « Consommation IA » (composant serveur, sans code dans le navigateur). Couleurs du back-office
// sombre écrites dans la page, comme les autres pages admin ; texte à 0,6 d'opacité au moins pour rester lisible.

const CARD = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }
const MUTED = 'rgba(255,255,255,0.65)'
const LINE = '1px solid rgba(255,255,255,0.06)'
// Taille écrite en style : la règle globale `h2` de globals.css (hors couche) l'emporte sur les classes Tailwind.
const H2 = { fontSize: '0.875rem', lineHeight: '1.25rem', fontWeight: 600 }

const int = new Intl.NumberFormat('fr-FR')
const pct = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 })

// Espace insécable avant l'unité : « 1,80 $ » ne se coupe pas dans une colonne étroite (mobile).
const NBSP = '\u00a0'

/** Coût en dollars : 4 décimales sous 1 $, 2 au-delà. */
export function usd(value: number): string {
  return `${value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: value < 1 ? 4 : 2 })}${NBSP}$`
}

const seconds = (ms: number) => `${(ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}${NBSP}s`

/** Jetons en clair : « 1,2 M », « 34 k », « 512 ». */
function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}${NBSP}M`
  if (n >= 10_000) return `${Math.round(n / 1000).toLocaleString('fr-FR')}${NBSP}k`
  return int.format(n)
}

function Kpi({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl p-4 md:p-5" style={CARD}>
      <p className="text-xs" style={{ color: MUTED }}>{label}</p>
      <p className="text-2xl font-bold text-white mt-1 tabular-nums">{value}</p>
      {detail && <p className="text-xs mt-1" style={{ color: MUTED }}>{detail}</p>}
    </div>
  )
}

function Notes({ totals, capped, cap }: { totals: UsageTotals; capped: boolean; cap: number }) {
  const notes = [
    capped && `Période lue en partie : ${int.format(cap)} essais les plus récents seulement.`,
    totals.withoutTokens > 0 && `${int.format(totals.withoutTokens)} essai(s) réussi(s) sans compte de jetons renvoyé par le serveur : ni jetons ni coût comptés.`,
    totals.withoutPrice > 0 && `${int.format(totals.withoutPrice)} essai(s) d’un modèle sans prix connu : coût non compté (src/lib/ai/prices.ts).`,
    totals.truncated > 0 && `${int.format(totals.truncated)} réponse(s) coupée(s) à la longueur maximale demandée.`,
  ].filter((n): n is string => !!n)
  if (notes.length === 0) return null
  return (
    <ul className="text-xs space-y-1 list-disc pl-5" style={{ color: MUTED }}>
      {notes.map(n => <li key={n}>{n}</li>)}
    </ul>
  )
}

/** Requêtes par jour en barres CSS ; valeurs exactes au survol et dans la phrase lue par les lecteurs d'écran. */
function DayChart({ days }: { days: UsageDay[] }) {
  const max = Math.max(1, ...days.map(d => d.requests))
  const total = days.reduce((a, d) => a + d.requests, 0)
  const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return (
    <section className="rounded-2xl p-4 md:p-5" style={CARD} aria-labelledby="usage-days">
      <h2 id="usage-days" className="text-white" style={H2}>Requêtes par jour</h2>
      <p className="sr-only">{`${int.format(total)} requêtes sur ${days.length} jours, au plus ${int.format(max)} en un jour.`}</p>
      <div className="mt-4 flex items-end gap-px h-32" aria-hidden>
        {days.map(d => (
          <div key={d.day} className="flex-1 min-w-0 h-full flex flex-col justify-end"
            title={`${dayLabel(d.day)} : ${int.format(d.requests)} requête(s), ${int.format(d.failures)} échec(s), ${usd(d.costUsd)}`}>
            <div className="rounded-t-sm" style={{ height: `${(d.requests / max) * 100}%`, minHeight: d.requests ? 2 : 0, background: 'rgba(147,197,253,0.75)' }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs tabular-nums" style={{ color: MUTED }} aria-hidden>
        <span>{dayLabel(days[0]?.day ?? '')}</span>
        <span>{dayLabel(days[days.length - 1]?.day ?? '')}</span>
      </div>
    </section>
  )
}

function GroupTable({ title, groups, labelOf, empty }: { title: string; groups: UsageGroup[]; labelOf: (key: string) => string; empty: string }) {
  const id = `usage-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`
  return (
    <section className="rounded-2xl overflow-hidden" style={CARD} aria-labelledby={id}>
      <h2 id={id} className="px-4 md:px-5 py-3 text-white" style={{ ...H2, borderBottom: LINE }}>{title}</h2>
      {groups.length === 0 ? (
        <p className="px-5 py-8 text-sm text-center" style={{ color: MUTED }}>{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: LINE, color: MUTED }}>
                <th scope="col" className="text-left font-medium text-xs px-4 md:px-5 py-2">Nom</th>
                <th scope="col" className="text-right font-medium text-xs px-3 py-2">Requêtes</th>
                <th scope="col" className="text-right font-medium text-xs px-3 py-2">Échecs</th>
                <th scope="col" className="text-right font-medium text-xs px-3 py-2 hidden md:table-cell">Entrée</th>
                <th scope="col" className="text-right font-medium text-xs px-3 py-2 hidden md:table-cell">Sortie</th>
                <th scope="col" className="text-right font-medium text-xs px-3 py-2 hidden lg:table-cell">Cache lu</th>
                <th scope="col" className="text-right font-medium text-xs px-3 py-2 hidden lg:table-cell">Durée médiane</th>
                <th scope="col" className="text-right font-medium text-xs px-4 md:px-5 py-2">Coût</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.key} style={{ borderBottom: LINE }}>
                  <th scope="row" className="text-left font-normal px-4 md:px-5 py-2 text-white">
                    {labelOf(g.key)}
                    {g.fallbacks > 0 && <span className="block text-xs" style={{ color: MUTED }}>{int.format(g.fallbacks)} repli(s)</span>}
                  </th>
                  <td className="text-right px-3 py-2 tabular-nums">{int.format(g.requests)}</td>
                  <td className="text-right px-3 py-2 tabular-nums" style={{ color: g.failures ? '#fca5a5' : MUTED }}>{int.format(g.failures)}</td>
                  <td className="text-right px-3 py-2 tabular-nums hidden md:table-cell">{tokens(g.inputTokens)}</td>
                  <td className="text-right px-3 py-2 tabular-nums hidden md:table-cell">{tokens(g.outputTokens)}</td>
                  <td className="text-right px-3 py-2 tabular-nums hidden lg:table-cell">{tokens(g.cacheReadTokens)}</td>
                  <td className="text-right px-3 py-2 tabular-nums hidden lg:table-cell">{seconds(g.medianDurationMs)}</td>
                  <td className="text-right px-4 md:px-5 py-2 tabular-nums text-white">{usd(g.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Failures({ summary, names }: { summary: UsageSummary; names: Record<string, string> }) {
  if (summary.recentFailures.length === 0) return null
  return (
    <section className="rounded-2xl overflow-hidden" style={CARD} aria-labelledby="usage-failures">
      <h2 id="usage-failures" className="px-4 md:px-5 py-3 text-white" style={{ ...H2, borderBottom: LINE }}>Derniers échecs</h2>
      <ul>
        {summary.recentFailures.map((r, i) => (
          <li key={`${r.createdAt}-${i}`} className="px-4 md:px-5 py-2 text-sm flex flex-wrap gap-x-3 gap-y-0.5" style={{ borderBottom: LINE }}>
            <time dateTime={r.createdAt} className="tabular-nums" style={{ color: MUTED }}>
              {new Date(r.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' })}
            </time>
            <span className="text-white">{featureLabel(r.feature)}</span>
            <span style={{ color: '#fca5a5' }}>{outcomeLabel(r.outcome)}</span>
            <span style={{ color: MUTED }}>{r.model || r.provider}{r.attempt > 0 ? ` (repli ${r.attempt})` : ''}</span>
            <span style={{ color: MUTED }}>{names[r.tenantId] ?? r.tenantId}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function UsageView({ summary, names, capped, cap }: { summary: UsageSummary; names: Record<string, string>; capped: boolean; cap: number }) {
  const { totals } = summary
  if (totals.attempts === 0) {
    return <p className="rounded-2xl p-5 text-sm" style={{ ...CARD, color: MUTED }}>Aucun appel d’IA enregistré sur cette période.</p>
  }
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <Kpi label="Requêtes" value={int.format(totals.requests)}
          detail={totals.fallbacks ? `+ ${int.format(totals.fallbacks)} essai(s) d’un modèle de repli` : 'aucun repli'} />
        <Kpi label="Coût estimé" value={usd(totals.costUsd)} detail="tarifs publics, prix de Config IA" />
        <Kpi label="Jetons entrée / sortie" value={`${tokens(totals.inputTokens)} / ${tokens(totals.outputTokens)}`}
          detail={`cache : ${tokens(totals.cacheReadTokens)} lus, ${tokens(totals.cacheWriteTokens)} écrits`} />
        <Kpi label="Échecs" value={pct.format(totals.failures / totals.attempts)}
          detail={`${int.format(totals.failures)} sur ${int.format(totals.attempts)} essais · médiane ${seconds(totals.medianDurationMs)}`} />
      </div>
      <Notes totals={totals} capped={capped} cap={cap} />
      <DayChart days={summary.byDay} />
      <GroupTable title="Par fonction" groups={summary.byFeature} labelOf={featureLabel} empty="Aucune fonction." />
      <GroupTable title="Par modèle" groups={summary.byModel} labelOf={k => k} empty="Aucun modèle." />
      <GroupTable title="Par organisation" groups={summary.byTenant} labelOf={k => names[k] ?? k} empty="Aucune organisation." />
      <Failures summary={summary} names={names} />
    </>
  )
}
