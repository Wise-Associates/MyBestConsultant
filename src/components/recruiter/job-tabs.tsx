import Link from 'next/link'
import { Brain, Kanban } from 'lucide-react'
import { formatDateFr } from '@/lib/format-date'
import type { Job } from '@/types'

// Pipeline et Matching IA d'une offre sur grand écran (demande du 2026-11-06) : deux onglets dans le bandeau de chaque
// page pour passer de l'une à l'autre, et une ligne qui rappelle l'offre (lieu, contrat, date de publication). Affichés
// à partir de 1440 px (`min-[90rem]:`, comme le tableau de bord) ; en dessous, les pages gardent leurs liens d'avant.

const CONTRACT_LABELS: Record<NonNullable<Job['contractType']>, string> = {
  cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission',
}

/** « Paris · CDI · Publiée le 3 nov. 2026 ». */
export function jobMetaLine(job: Pick<Job, 'location' | 'contractType' | 'createdAt'>): string {
  return [job.location, job.contractType && CONTRACT_LABELS[job.contractType], `Publiée le ${formatDateFr(job.createdAt)}`]
    .filter(Boolean).join(' · ')
}

export function JobTabs({ jobId, current }: { jobId: string; current: 'pipeline' | 'matching' }) {
  const tabs = [
    { key: 'pipeline', label: 'Pipeline', href: `/recruiter/pipeline/${jobId}`, Icon: Kanban },
    { key: 'matching', label: 'Matching IA', href: `/recruiter/pipeline/${jobId}/matching`, Icon: Brain },
  ] as const
  return (
    <nav aria-label="Vues de l’offre" className="hidden min-[90rem]:flex gap-0.5 p-0.75 rounded-xl shrink-0 mr-auto" style={{ background: 'rgba(255,255,255,0.08)' }}>
      {tabs.map(({ key, label, href, Icon }) => {
        const on = key === current
        return (
          <Link key={key} href={href} aria-current={on ? 'page' : undefined}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-semibold no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            style={on ? { background: 'white', color: '#1c1c1e' } : { color: 'rgba(255,255,255,0.7)' }}>
            <Icon className="h-3.5 w-3.5" aria-hidden />{label}
          </Link>
        )
      })}
    </nav>
  )
}
