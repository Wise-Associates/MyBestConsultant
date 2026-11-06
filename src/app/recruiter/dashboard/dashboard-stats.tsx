import type { CSSProperties } from 'react'
import { WEEKS_SHOWN, type DashboardSummary } from '@/lib/recruiter-dashboard'

// Indicateurs du haut du tableau de bord : quatre chiffres séparés par un filet, calculés sur toutes les offres et
// candidatures de l'organisation (recruiter-dashboard.ts).

const cellStyle: CSSProperties = { background: 'var(--color-surface)' }
const muted: CSSProperties = { color: 'var(--color-text-muted)' }
const cell = 'flex flex-col gap-1.5 px-4 py-4 sm:px-6 sm:py-5 min-[1440px]:py-4 min-w-0'
const label = 'text-xs sm:text-[13px] font-medium'
const value = 'text-[26px] sm:text-[32px] min-[1440px]:text-[28px] leading-[1.1] font-semibold tracking-[-0.02em] tabular-nums'
const note = 'text-xs sm:text-[13px]'

const count = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

export function DashboardStats({ summary }: { summary: DashboardSummary }) {
  const { jobs, applications: apps } = summary
  const lastWeek = apps.weekly[apps.weekly.length - 1]
  const peak = Math.max(1, ...apps.weekly)
  return (
    <section aria-label="Indicateurs clés" className="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-[20px] overflow-hidden"
      style={{ background: 'var(--color-border)', border: '1px solid var(--color-border)' }}>
      <div className={cell} style={cellStyle}>
        <p className={label} style={muted}>Offres en ligne</p>
        <p className={value} style={{ color: 'var(--color-text)' }}>{jobs.online}</p>
        <p className={note} style={muted}>sur {count(jobs.total, 'offre', 'offres')} · {count(jobs.offline, 'archivée', 'archivées')}</p>
      </div>

      <div className={`${cell} sm:flex-row sm:items-end sm:justify-between sm:gap-3`} style={cellStyle}>
        <div className="flex flex-col gap-1.5 min-w-0">
          <p className={label} style={muted}>Candidatures</p>
          <p className={value} style={{ color: 'var(--color-text)' }}>{apps.total}</p>
          <p className={note} style={muted}>
            <span className="font-semibold" style={lastWeek > 0 ? { color: '#047857' } : undefined}>+{lastWeek}</span> sur 7 jours
          </p>
        </div>
        <div role="img" aria-label={`Candidatures par semaine, des ${WEEKS_SHOWN} dernières semaines à celle-ci : ${apps.weekly.join(', ')}`}
          className="hidden sm:flex items-end gap-[3px] h-8 pb-1 shrink-0">
          {apps.weekly.map((n, i) => {
            const current = i === apps.weekly.length - 1
            return <span key={i} className="w-1.5 rounded-t-[2px]"
              style={{ height: Math.max(2, Math.round((n / peak) * 28)), background: current ? 'var(--color-primary)' : 'var(--color-text-muted)', opacity: current ? 1 : 0.35 }} />
          })}
        </div>
      </div>

      <div className={cell} style={cellStyle}>
        <p className={label} style={muted}>Score moyen IA</p>
        <p className={value} style={{ color: 'var(--color-text)' }}>
          {apps.avgScore ?? '—'}{apps.avgScore !== null && <span className="text-sm sm:text-base font-medium" style={muted}>/100</span>}
        </p>
        {apps.avgScore !== null && (
          <div aria-hidden className="h-1.5 rounded-full my-0.5" style={{ background: 'color-mix(in srgb, var(--color-primary) 18%, transparent)' }}>
            <div className="h-1.5 rounded-full" style={{ width: `${apps.avgScore}%`, background: 'var(--color-primary)' }} />
          </div>
        )}
        <p className={note} style={muted}>
          {apps.scored > 0 ? `sur ${count(apps.scored, 'candidature analysée', 'candidatures analysées')}` : 'Aucune candidature analysée'}
        </p>
      </div>

      <div className={cell} style={cellStyle}>
        <p className={label} style={muted}>Taux de sélection</p>
        <p className={value} style={{ color: 'var(--color-text)' }}>
          {apps.selectionRate ?? '—'}{apps.selectionRate !== null && <span className="text-sm sm:text-base font-medium" style={muted}> %</span>}
        </p>
        <p className={note} style={muted}>{count(apps.accepted, 'embauché', 'embauchés')} sur {count(apps.total, 'candidature', 'candidatures')}</p>
      </div>
    </section>
  )
}
