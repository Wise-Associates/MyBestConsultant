import type { LabelCount, MonthCount } from '@/lib/ao/stats'

// Graphiques des statistiques AO, en HTML et CSS (aucune bibliothèque) : barres fines aux extrémités arrondies, 2 px
// d'espace entre segments, axes discrets, infobulle sur chaque marque (title) et tableau des données pour les lecteurs
// d'écran. Couleurs : une seule teinte pour les grandeurs ; les statuts gardent leurs couleurs de la page AO Offers,
// dans l'ordre validé (vert, orange, gris : jamais vert contre gris, indiscernables pour un daltonien).

/** Grandeurs (une seule série) : bleu 700 de la palette admin, distinct des couleurs de statut. */
const BAR = '#1d4ed8'
const STATUS_SERIES = [
  { key: 'published', label: 'Publiées', color: '#047857' },
  { key: 'to_review', label: 'À valider', color: '#c2410c' },
  { key: 'ignored', label: 'Ignorées', color: '#A1A1A6' },
] as const

const card = { background: 'var(--admin-panel)', border: '1px solid var(--admin-line)' } as const
const muted = { color: 'var(--admin-fg-muted)' } as const

export function ChartCard({ title, note, children, className = '' }: { title: string; note?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl p-5 ${className}`} style={card}>
      <h2 className="font-semibold" style={{ color: 'var(--admin-fg)', fontSize: '0.95rem' }}>{title}</h2>
      {note && <p className="text-xs mt-0.5" style={muted}>{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl p-5" style={card}>
      <p className="text-xs font-medium" style={muted}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: 'var(--admin-fg)', fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      {hint && <p className="text-xs mt-1" style={muted}>{hint}</p>}
    </div>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`

/** Barres horizontales d'une seule série (classement, répartition) ; valeur en clair au bout de chaque barre. */
export function BarList({ items, unit = 'offre', empty = 'Pas encore de données.' }: { items: LabelCount[]; unit?: string; empty?: string }) {
  const max = Math.max(1, ...items.map(i => i.count))
  if (!items.some(i => i.count > 0)) return <p className="text-sm" style={muted}>{empty}</p>
  return (
    <ul className="space-y-2.5">
      {items.map(item => (
        <li key={item.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm" title={`${item.label} : ${plural(item.count, unit)}`}>
          <span className="truncate" style={{ color: 'var(--admin-fg)' }}>{item.label}</span>
          <span className="h-2 rounded-full" style={{ background: 'var(--admin-panel-raised)' }}>
            <span className="block h-2 rounded-full" style={{ width: `${(item.count / max) * 100}%`, background: BAR, minWidth: item.count ? 4 : 0 }} />
          </span>
          <span className="text-xs w-8 text-right" style={{ ...muted, fontVariantNumeric: 'tabular-nums' }}>{item.count}</span>
        </li>
      ))}
    </ul>
  )
}

const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' })
const monthLong = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** Offres par mois de réception, empilées par statut (publiées en bas), avec légende et tableau des données. */
export function MonthlyBars({ months }: { months: MonthCount[] }) {
  const totals = months.map(m => m.published + m.to_review + m.ignored)
  const max = Math.max(1, ...totals)
  const HEIGHT = 160
  return (
    <div>
      <ul className="flex flex-wrap gap-4 mb-4 text-xs" aria-label="Légende">
        {STATUS_SERIES.map(s => (
          <li key={s.key} className="flex items-center gap-1.5" style={{ color: 'var(--admin-fg)' }}>
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />{s.label}
          </li>
        ))}
      </ul>
      <div className="relative" aria-hidden="true">
        <p className="absolute -top-1 left-0 text-[11px]" style={{ ...muted, fontVariantNumeric: 'tabular-nums' }}>{max}</p>
        <div className="flex items-end gap-1.5 sm:gap-3 pl-7" style={{ height: HEIGHT, borderBottom: '1px solid var(--admin-line)' }}>
          {months.map((m, i) => (
            <div key={m.month} className="flex-1 flex flex-col-reverse gap-[2px] min-w-0" style={{ height: HEIGHT }}
              title={`${monthLong(m.month)} : ${plural(totals[i], 'offre')} — ${m.published} publiée(s), ${m.to_review} à valider, ${m.ignored} ignorée(s)`}>
              {STATUS_SERIES.map((s, k) => {
                const value = m[s.key]
                if (!value) return null
                // Extrémité arrondie seulement en haut de la pile ; la base reste droite, posée sur l'axe.
                const isTop = STATUS_SERIES.slice(k + 1).every(next => !m[next.key])
                return <span key={s.key} className="block w-full" style={{ height: `${(value / max) * (HEIGHT - 4)}px`, background: s.color, borderRadius: isTop ? '4px 4px 0 0' : 0 }} />
              })}
            </div>
          ))}
        </div>
        <div className="flex gap-1.5 sm:gap-3 pl-7 mt-1.5">
          {months.map(m => <span key={m.month} className="flex-1 text-center text-[11px] min-w-0 truncate" style={muted}>{monthLabel(m.month)}</span>)}
        </div>
      </div>
      <details className="mt-4">
        <summary className="text-xs cursor-pointer" style={muted}>Voir les données</summary>
        <table className="w-full text-xs mt-2" style={{ fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr style={muted}><th className="text-left py-1 font-medium">Mois</th>{STATUS_SERIES.map(s => <th key={s.key} className="text-right py-1 font-medium">{s.label}</th>)}<th className="text-right py-1 font-medium">Total</th></tr>
          </thead>
          <tbody>
            {months.map((m, i) => (
              <tr key={m.month} style={{ borderTop: '1px solid var(--admin-line)', color: 'var(--admin-fg)' }}>
                <td className="py-1 capitalize">{monthLong(m.month)}</td>
                {STATUS_SERIES.map(s => <td key={s.key} className="text-right py-1">{m[s.key]}</td>)}
                <td className="text-right py-1 font-semibold">{totals[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
