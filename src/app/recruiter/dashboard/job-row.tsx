'use client'

import { useId, useState, type MouseEvent, type Ref } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { MapPin, Clock, Sparkles, PanelRight, ChevronDown } from 'lucide-react'
import { JobActions } from './job-actions'
import { SocialStatus, usePublish } from './social-status'
import { JobAssigneeSelect } from './job-assignee-select'
import type { CandidateApp } from './applications-panel'
import type { DashboardJobRow } from './jobs-list-client'
import type { FunnelStage } from '@/types'
import type { RecruiterOption } from '@/lib/recruiter-assignment'
import { startNavigationProgress } from '@/components/shared/navigation-progress'
import { PREVIEW_MEDIA } from './dashboard-layout'

const CONTRACT_LABELS: Record<string, string> = {
  cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission',
}

/**
 * Colonnes de « Mes offres » à partir de 1024 px ; en dessous, la ligne passe sur deux colonnes (carte). À partir de
 * 1440 px (rail de filtres, dashboard-layout.ts) la colonne « Candidatures » s'élargit pour que « 30 correspondances IA »
 * tienne sur une ligne ; à partir de 1800 px (panneau d'aperçu) les actions gagnent le bouton « Aperçu ».
 */
export const ROW_GRID = 'grid grid-cols-2 lg:grid-cols-[minmax(0,1fr)_124px_200px_180px_88px] min-[90rem]:grid-cols-[minmax(0,1fr)_156px_176px_200px_88px] min-[112.5rem]:grid-cols-[minmax(0,1fr)_156px_176px_200px_132px] gap-x-5'

const badge = 'inline-flex items-center gap-1 text-[11px] font-semibold rounded-md px-[7px] py-0.5'
const neutralBadge = { background: 'color-mix(in srgb, var(--color-text) 7%, transparent)', color: 'var(--color-text)' }
const amberBadge = { background: '#b4530914', color: '#b45309' }

export function JobRow({ row, apps, stages, canPublish, recruiters, first, focused, focusRef, onOpenApplications, previewed, onPreview }: {
  row: DashboardJobRow; apps: CandidateApp[]; stages: FunnelStage[]; canPublish: boolean
  recruiters: RecruiterOption[] | null; first: boolean
  focused: boolean; focusRef?: Ref<HTMLElement>; onOpenApplications: () => void
  /** Offre affichée dans le panneau d'aperçu (écrans d'au moins 1800 px). */
  previewed: boolean; onPreview: () => void
}) {
  const router = useRouter()
  const { job, facts } = row
  const publish = usePublish(job.$id)
  const matchingHref = `/recruiter/pipeline/${job.$id}/matching`
  const allStageCounts = stages.map(stage => ({ stage, count: apps.filter(a => a.status === stage.slug).length }))
  const stageCounts = allStageCounts.filter(s => s.count > 0)
  const peak = Math.max(1, ...stageCounts.map(s => s.count))
  // Détail du pipeline (toutes les phases, même vides), replié par défaut : la colonne n'en montre qu'un résumé.
  const [pipelineOpen, setPipelineOpen] = useState(false)
  const pipelineId = useId()
  const working = !!row.social && ['queued', 'sent', 'images_ready'].includes(row.social.status) && !row.social.stale
  const ownOnline = !row.shared && facts.state === 'online'

  // Toute la ligne ouvre le matching de l'offre (comme avant) ; le titre est le lien pour le clavier et les lecteurs
  // d'écran, les boutons et liens de la ligne gardent leur propre action. Sur un écran assez large pour le panneau
  // d'aperçu, le clic sur la ligne l'affiche dans ce panneau (le titre ouvre toujours le matching).
  function openFromRow(e: MouseEvent<HTMLElement>) {
    if ((e.target as HTMLElement).closest('a, button, select, label, [role="menu"], [data-row-details]')) return
    if (window.matchMedia(PREVIEW_MEDIA).matches) {
      onPreview()
      return
    }
    startNavigationProgress()
    router.push(matchingHref)
  }

  return (
    <article ref={focusRef} tabIndex={focused ? -1 : undefined} onClick={openFromRow} data-previewed={previewed || undefined}
      className={`group ${ROW_GRID} gap-y-4 items-center px-4 sm:px-6 py-4 lg:py-4.5 min-[90rem]:px-5 min-[90rem]:py-2.5 cursor-pointer transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_2.5%,transparent)] min-[112.5rem]:data-previewed:bg-[color-mix(in_srgb,var(--color-primary)_6%,transparent)] min-[112.5rem]:data-previewed:shadow-[inset_3px_0_0_var(--color-primary)] focus:outline-none`}
      style={{
        borderTop: first ? undefined : '1px solid var(--color-border)',
        background: focused ? 'color-mix(in srgb, var(--color-primary) 7%, transparent)' : undefined,
        boxShadow: focused ? 'inset 3px 0 0 var(--color-primary)' : undefined,
      }}>
      <div className="col-span-2 lg:col-span-1 min-w-0 flex flex-col gap-1.5 min-[90rem]:gap-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={matchingHref} className="text-[15px] min-[90rem]:text-sm font-semibold leading-snug no-underline group-hover:underline underline-offset-[3px] rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)"
            style={{ color: 'var(--color-text)' }}>
            {job.title}
          </Link>
          {facts.state === 'archived' && <span className={badge} style={neutralBadge}>Archivée</span>}
          {facts.state === 'expired' && <span className={badge} style={amberBadge}>Expirée</span>}
          {facts.expiresInDays !== null && (
            <span className={badge} style={amberBadge}><Clock className="h-2.75 w-2.75" strokeWidth={2.4} aria-hidden />Expire dans {facts.expiresInDays} j</span>
          )}
          {row.shared && <span className={badge} style={neutralBadge}>Offre de la plateforme</span>}
        </div>
        {/* Écran large : lieu, contrat, date et recruteur sur une seule ligne, pour des lignes moins hautes. */}
        <div className="flex flex-col gap-1.5 min-[90rem]:flex-row min-[90rem]:flex-wrap min-[90rem]:items-center min-[90rem]:gap-x-3 min-[90rem]:gap-y-0.5">
          <p className="flex items-center gap-1.5 flex-wrap text-[13px] min-[90rem]:text-xs" style={{ color: 'var(--color-text-muted)' }}>
            <MapPin className="h-3.25 w-3.25" aria-hidden />
            <span>{job.location}</span>
            {job.contractType && <><span aria-hidden>·</span><span>{CONTRACT_LABELS[job.contractType]}</span></>}
            <span aria-hidden>·</span><span>Publiée le {row.publishedOn}</span>
          </p>
          {!row.shared && recruiters && (
            <JobAssigneeSelect jobId={job.$id} jobTitle={job.title} assigneeId={job.recruiterId ?? ''} recruiters={recruiters} />
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1 min-w-0">
        <button type="button" onClick={onOpenApplications} title="Voir les candidatures"
          className="self-start inline-flex items-baseline gap-1.5 bg-transparent border-0 p-0 cursor-pointer rounded-sm hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)">
          <span className="text-xl min-[90rem]:text-base font-semibold tabular-nums" style={{ color: facts.applications > 0 ? 'var(--color-text)' : 'var(--color-text-muted)' }}>{facts.applications}</span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{facts.applications > 1 ? 'candidatures' : 'candidature'}</span>
        </button>
        {facts.newApplications > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
            <span aria-hidden className="w-1.75 h-1.75 rounded-full" style={{ background: 'var(--color-primary)' }} />
            +{facts.newApplications} {facts.newApplications > 1 ? 'nouvelles' : 'nouvelle'}
          </span>
        )}
        {facts.applications === 0 && row.matches > 0 && (
          <Link href={matchingHref} className="inline-flex items-center gap-1 text-xs font-semibold no-underline hover:underline min-[90rem]:whitespace-nowrap" style={{ color: 'var(--color-primary)' }}>
            <Sparkles className="h-3 w-3" aria-hidden />{row.matches} correspondance{row.matches > 1 ? 's' : ''} IA
          </Link>
        )}
      </div>

      <div className="min-w-0 flex flex-col gap-2">
        {stageCounts.length > 0 ? (
          <>
            <div aria-hidden className="flex gap-0.5 h-1.5">
              {stageCounts.map(({ stage, count }) => (
                <span key={stage.slug} className="h-1.5 min-w-1.5 rounded-full" style={{ flex: `${count} 1 0`, background: stage.color }} />
              ))}
            </div>
            <ul aria-label="Pipeline" className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {stageCounts.map(({ stage, count }) => (
                <li key={stage.slug} className="inline-flex items-center gap-1">
                  <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: stage.color }} />
                  {count} {stage.label.toLowerCase()}
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setPipelineOpen(o => !o)} aria-expanded={pipelineOpen} aria-controls={pipelineId}
              className="self-start inline-flex items-center gap-1 bg-transparent border-0 p-0 text-xs font-semibold cursor-pointer rounded-sm hover:underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)"
              style={{ color: 'var(--color-text)' }}>
              {pipelineOpen ? 'Masquer le détail' : 'Voir le détail'}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${pipelineOpen ? 'rotate-180' : ''}`} aria-hidden />
            </button>
          </>
        ) : (
          <>
            <div aria-hidden className="h-1 rounded-full" style={{ border: '1px dashed var(--color-border)' }} />
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Aucun candidat dans le pipeline</span>
          </>
        )}
      </div>

      <SocialStatus info={row.social} state={facts.state} shared={row.shared} canPublish={canPublish} publish={publish} />

      <div className="flex justify-end">
        <button type="button" onClick={onPreview} aria-pressed={previewed} title="Afficher dans l’aperçu"
          className="hidden min-[112.5rem]:flex w-10 h-10 rounded-[10px] items-center justify-center cursor-pointer bg-transparent border-0 transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_7%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)"
          style={{ color: previewed ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
          <PanelRight className="h-4 w-4" aria-hidden /><span className="sr-only">Aperçu de {job.title}</span>
        </button>
        <JobActions job={job} state={facts.state} shared={row.shared} matchingHref={matchingHref}
          canRepublish={canPublish && ownOnline && !!row.social && !working && !publish.pending}
          onRepublish={() => publish.run(true)} />
      </div>

      {pipelineOpen && (
        <div id={pipelineId} data-row-details className="col-span-full cursor-default rounded-xl px-4 py-3.5"
          style={{ background: 'color-mix(in srgb, var(--color-text) 3%, transparent)' }}>
          <div className="flex items-center justify-between gap-3 mb-2.5">
            <h3 className="font-semibold uppercase" style={{ color: 'var(--color-text-muted)', fontSize: 11, letterSpacing: '0.06em', lineHeight: 1.4 }}>
              Pipeline · {facts.applications} {facts.applications > 1 ? 'candidatures' : 'candidature'}
            </h3>
            <Link href={`/recruiter/pipeline/${job.$id}`} className="text-xs font-semibold no-underline hover:underline" style={{ color: 'var(--color-primary)' }}>
              Ouvrir le pipeline
            </Link>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2">
            {allStageCounts.map(({ stage, count }) => (
              <li key={stage.slug} className="flex items-center gap-3 text-[13px]" style={{ color: count > 0 ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                <span className="w-36 shrink-0">{stage.label}</span>
                <span aria-hidden className="flex-1 h-1.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--color-text) 6%, transparent)' }}>
                  {count > 0 && <span className="block h-1.5 rounded-full" style={{ width: `${(count / peak) * 100}%`, background: stage.color }} />}
                </span>
                <span className="w-6 text-right font-semibold tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  )
}
