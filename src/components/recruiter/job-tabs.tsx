import Link from 'next/link'
import type { ReactNode } from 'react'
import { Brain, Kanban, Send } from 'lucide-react'
import { formatDateFr } from '@/lib/format-date'
import type { Job } from '@/types'

// Onglets d'une offre, en bas du bandeau de ses pages : Matching IA | Funnel | Réponse client (demande du 2026-11-17 ;
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

/**
 * Bandeau d'une offre (demandes du 2026-11-17 : le sous-menu à la place du titre, le titre dans un bouton « i »,
 * JobInfoButton). Dès 1024 px : retour puis sous-menu à gauche (le sous-menu en bas, sur la bordure du bandeau), actions à
 * droite, sur la ligne du sous-menu. Plus étroit : retour, actions, puis sous-menu. À placer seul dans le conteneur du
 * bandeau, sans marge basse.
 */
export function JobHeaderGrid({ back, main, tabs }: { back: ReactNode; main: ReactNode; tabs: ReactNode }) {
  return (
    <div className="flex flex-col lg:grid lg:grid-cols-[auto_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-10">
      <div className="lg:col-start-1 lg:row-start-1">{back}</div>
      <div className="min-w-0 flex flex-col gap-3 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:self-end lg:items-end lg:pb-2.5">{main}</div>
      <div className="min-w-0 lg:col-start-1 lg:row-start-2 lg:self-end">{tabs}</div>
    </div>
  )
}

/**
 * Sous-menu de l'offre, en bas de son bandeau : onglets classiques soulignés (demande du 2026-11-17 : le sélecteur en
 * pastilles ne se remarquait pas). À placer en dernier dans le conteneur du bandeau, sans marge basse : le soulignement
 * de l'onglet actif recouvre la bordure du bandeau (-mb-px). `counts` : candidats du funnel et envoyés au client.
 */
export function JobTabs({ jobId, current, counts }: { jobId: string; current: JobTab; counts?: { funnel?: number; client?: number } }) {
  const tabs = [
    { key: 'matching', label: 'Matching IA', href: `/recruiter/pipeline/${jobId}/matching`, Icon: Brain, count: undefined },
    { key: 'pipeline', label: 'Funnel', href: `/recruiter/pipeline/${jobId}`, Icon: Kanban, count: counts?.funnel },
    { key: 'client', label: 'Réponse client', href: `/recruiter/pipeline/${jobId}/client`, Icon: Send, count: counts?.client },
  ] as const
  return (
    // Couleurs du bandeau (--hero-*, globals.css) : clair dans l'espace recruteur (2026-11-13).
    <nav aria-label="Vues de l’offre" className="flex gap-5 sm:gap-7 mt-4 -mb-px max-w-full overflow-x-auto">
      {tabs.map(({ key, label, href, Icon, count }) => {
        const on = key === current
        return (
          <Link key={key} href={href} aria-current={on ? 'page' : undefined}
            className={`inline-flex items-center gap-2 pt-1 pb-3 border-b-[3px] text-sm whitespace-nowrap no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--hero-fg) ${
              on ? 'font-bold text-(--hero-fg) border-(--color-primary)' : 'font-semibold text-(--hero-fg-muted) border-transparent hover:text-(--hero-fg) hover:border-(--hero-line)'}`}>
            <Icon className="hidden sm:block h-4 w-4" aria-hidden />{label}
            {count !== undefined && (
              <span className="min-w-5 px-1.5 rounded-full text-[11px] font-semibold tabular-nums text-center"
                style={on ? { background: 'var(--color-primary)', color: 'var(--color-primary-fg)' } : { background: 'color-mix(in srgb, currentColor 12%, transparent)' }}>
                {count}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
