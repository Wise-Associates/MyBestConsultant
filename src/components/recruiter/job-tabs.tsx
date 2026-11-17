import Link from 'next/link'
import { Brain, Kanban, Send } from 'lucide-react'
import { formatDateFr } from '@/lib/format-date'
import type { Job } from '@/types'

// Onglets d'une offre, dans le bandeau de ses pages : Matching IA | Funnel | Réponse client (demande du 2026-11-17 ;
// avant, Matching IA et Pipeline, dès 1440 px seulement). Affichés à toutes les largeurs : « Réponse client » n'a pas
// d'autre lien. « Funnel » est le pipeline de l'offre (/recruiter/pipeline/<id>). Et une ligne qui rappelle l'offre (lieu,
// contrat, date de publication).

const CONTRACT_LABELS: Record<NonNullable<Job['contractType']>, string> = {
  cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission',
}

/** « Paris · CDI · Publiée le 3 nov. 2026 ». */
export function jobMetaLine(job: Pick<Job, 'location' | 'contractType' | 'createdAt'>): string {
  return [job.location, job.contractType && CONTRACT_LABELS[job.contractType], `Publiée le ${formatDateFr(job.createdAt)}`]
    .filter(Boolean).join(' · ')
}

export type JobTab = 'matching' | 'pipeline' | 'client'

/** `counts` : candidats du funnel et candidats envoyés au client, quand la page les connaît. */
export function JobTabs({ jobId, current, counts }: { jobId: string; current: JobTab; counts?: { funnel?: number; client?: number } }) {
  const tabs = [
    { key: 'matching', label: 'Matching IA', href: `/recruiter/pipeline/${jobId}/matching`, Icon: Brain, count: undefined },
    { key: 'pipeline', label: 'Funnel', href: `/recruiter/pipeline/${jobId}`, Icon: Kanban, count: counts?.funnel },
    { key: 'client', label: 'Réponse client', href: `/recruiter/pipeline/${jobId}/client`, Icon: Send, count: counts?.client },
  ] as const
  return (
    // Couleurs du bandeau (--hero-*, globals.css) : clair dans l'espace recruteur (2026-11-13).
    <nav aria-label="Vues de l’offre" className="flex gap-0.5 p-0.75 rounded-xl shrink-0 max-w-full overflow-x-auto min-[90rem]:mr-auto"
      style={{ background: 'var(--hero-control)', border: '1px solid var(--hero-line)' }}>
      {tabs.map(({ key, label, href, Icon, count }) => {
        const on = key === current
        return (
          <Link key={key} href={href} aria-current={on ? 'page' : undefined}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hero-fg)]"
            style={on ? { background: 'var(--color-surface)', color: 'var(--color-text)', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' } : { color: 'var(--hero-fg-muted)' }}>
            <Icon className="h-3.5 w-3.5" aria-hidden />{label}
            {count !== undefined && (
              <span className="min-w-5 px-1.5 rounded-full text-[11px] tabular-nums text-center"
                style={{ background: 'color-mix(in srgb, currentColor 12%, transparent)' }}>
                {count}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
