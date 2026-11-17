import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { Brain, ExternalLink, FileText, Kanban, Share2 } from 'lucide-react'
import { BackLink } from '@/components/recruiter/back-link'
import { jobMetaLine } from '@/components/recruiter/job-tabs'
import { JobDescription } from '@/components/shared/job-description'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getJobById, getApplicationsByJob, countMatchesByJob } from '@/lib/appwrite/jobs'
import { getStagesForJob } from '@/lib/appwrite/funnel'
import { resolveStatus, withOrphanStages } from '@/lib/funnel-stage-utils'
import { viewerCanOpenJob, viewerCanSeeApplication } from '@/lib/job-ownership'
import { loadOfferViewer } from '@/lib/offer-viewer'
import { jobState, type JobState } from '@/lib/recruiter-dashboard'
import { listTenantRecruiters } from '@/lib/recruiter-assignment'
import { diffusionText } from '@/lib/social-content'
import { parseClientSubmission } from '@/lib/client-response'
import { payText } from '@/lib/job-pay'
import { formatDateFr } from '@/lib/format-date'
import { EditJobButton } from './edit-job-button'

// Détail d'une offre (demande du 2026-11-17) : ouvert par le titre d'une offre dans « Mes offres ». Description, suivi
// (candidatures, correspondances IA, candidats par phase), informations clés et diffusion ; liens vers le Matching IA et
// le funnel de l'offre. Mêmes règles d'accès que le funnel : offre de l'organisation ou offre partagée de la plateforme,
// candidatures d'une autre organisation jamais comptées.

const CONTRACT: Record<string, string> = { cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission' }
const REMOTE: Record<string, string> = { onsite: 'Sur site', hybrid: 'Hybride', remote: 'Télétravail' }
const STATE_BADGES: Record<JobState, { label: string; style: CSSProperties }> = {
  online: { label: 'En ligne', style: { background: '#04785714', color: '#047857' } },
  expired: { label: 'Expirée', style: { background: '#b4530914', color: '#b45309' } },
  archived: { label: 'Archivée', style: { background: 'color-mix(in srgb, var(--color-text) 7%, transparent)', color: 'var(--color-text)' } },
}

const muted: CSSProperties = { color: 'var(--color-text-muted)' }
const card = 'rounded-[20px] p-5 sm:p-6'
const cardStyle: CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' }
// En style : les règles h1–h6 de globals.css (hors couche Tailwind) l'emportent sur les classes de taille.
const headingStyle: CSSProperties = { ...muted, fontSize: 11, letterSpacing: '0.06em', lineHeight: 1.4 }
const heroButton = 'h-10 px-3.5 rounded-[10px] inline-flex items-center justify-center gap-2 text-[13px] font-semibold no-underline cursor-pointer transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--hero-fg)'
const heroButtonStyle: CSSProperties = { background: 'var(--hero-control)', color: 'var(--hero-fg)', border: '1px solid var(--hero-line)' }
const primaryStyle: CSSProperties = { background: 'var(--color-primary)', color: 'var(--color-primary-fg)', border: '1px solid var(--color-primary)' }
const cardButton = 'h-10 px-3.5 rounded-[10px] inline-flex items-center justify-center gap-2 text-[13px] font-semibold no-underline transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)'

export default async function JobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')
  const tenantId = user.tenantId
  // Identifiant Appwrite seulement : l'adresse ne doit pas viser un autre chemin de l'API.
  if (!/^[\w-]{1,36}$/.test(jobId)) notFound()

  const job = await getJobById(jobId)
  if (!job) notFound()
  // Un membre : ses offres seulement (ADR 0043).
  const viewer = await loadOfferViewer(user)
  if (!viewerCanOpenJob(job, viewer)) redirect('/recruiter/dashboard')
  const shared = job.tenantId !== tenantId

  const { latestPostsByJob } = await import('@/lib/social')
  const [allApps, { stages }, matchCounts, posts, team] = await Promise.all([
    getApplicationsByJob(jobId),
    getStagesForJob(tenantId, jobId),
    countMatchesByJob(tenantId, jobId),
    // Illisible (undefined) : la carte « Diffusion » le dit, plutôt qu'une offre affichée comme jamais diffusée.
    shared ? null : latestPostsByJob(tenantId).catch((e: unknown) => {
      console.error('[offre] diffusions non lues', jobId, e instanceof Error ? e.message : e)
      return undefined
    }),
    job.recruiterId ? listTenantRecruiters(tenantId).catch((e: unknown) => {
      console.error('[offre] recruteurs de l’organisation non lus', jobId, e instanceof Error ? e.message : e)
      return null
    }) : null,
  ])

  const apps = allApps.filter(a => viewerCanSeeApplication(job, a.tenantId ?? '', viewer))
  const statuses = apps.map(a => resolveStatus(stages, a.status))
  // Toutes les phases du funnel de l'offre, dans l'ordre ; une candidature dont la phase n'existe plus garde la sienne.
  const stageCounts = withOrphanStages(stages, statuses).map(stage => ({ stage, count: statuses.filter(s => s === stage.slug).length }))
  const peak = Math.max(1, ...stageCounts.map(s => s.count))

  const state = jobState(job, new Date())
  const badge = STATE_BADGES[state]
  const post = posts?.[jobId]
  const diffusion = posts === undefined ? 'État de la diffusion illisible : rechargez la page dans quelques instants.'
    : diffusionText(post && { status: post.status, results: post.results, stale: post.stale, sentOn: formatDateFr(post.sentAt ?? post.createdAt) }, shared, state)
  const recruiter = !job.recruiterId ? 'Non affecté'
    : team === null ? 'Équipe illisible' : team.find(r => r.id === job.recruiterId)?.name ?? 'Non affecté'

  const facts: { label: string; value: string }[] = [
    { label: 'Contrat', value: job.contractType ? CONTRACT[job.contractType] : 'Non précisé' },
    { label: 'Lieu', value: [job.location, job.remote && REMOTE[job.remote]].filter(Boolean).join(' · ') },
    ...(job.salary ? [{ label: 'Rémunération', value: payText(job.salary, job.contractType) }] : []),
    ...(shared ? [] : [{ label: 'Recruteur', value: recruiter }]),
    { label: 'Publiée le', value: formatDateFr(job.createdAt) },
    ...(job.expiresAt ? [{ label: state === 'expired' ? 'Expirée le' : 'Expire le', value: formatDateFr(job.expiresAt) }] : []),
  ]
  const pipelineHref = `/recruiter/pipeline/${jobId}`
  const matchingHref = `/recruiter/pipeline/${jobId}/matching`
  const matches = matchCounts[jobId] ?? 0
  const sentToClient = apps.filter(a => parseClientSubmission(a.clientJson)).length

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <header style={{ background: 'var(--hero-bg)', borderBottom: '1px solid var(--hero-line)' }}>
        <div className="max-w-[1400px] min-[90rem]:max-w-[1920px] mx-auto px-4 sm:px-6 min-[90rem]:px-8 py-4">
          <BackLink fallbackHref="/recruiter/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-semibold mb-2 no-underline transition-opacity hover:opacity-80"
            style={{ color: 'var(--hero-fg-muted)' }} />
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--hero-fg-muted)' }}>
                <FileText className="h-3.5 w-3.5" aria-hidden />Détail de l’offre
              </p>
              <h1 style={{ color: 'var(--hero-fg)', fontWeight: 300, fontSize: '1.375rem', lineHeight: 1.3 }}>{job.title}</h1>
              <p className="text-xs mt-0.5" style={{ color: 'var(--hero-fg-muted)' }}>{jobMetaLine(job)}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="h-7 px-2.5 rounded-full inline-flex items-center gap-1.5 text-xs font-semibold" style={badge.style}>
                <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />{badge.label}
              </span>
              <a href={`/jobs/${jobId}`} target="_blank" rel="noopener noreferrer" className={heroButton} style={heroButtonStyle}>
                <ExternalLink className="h-4 w-4" aria-hidden />Voir l’offre publiée<span className="sr-only"> (nouvel onglet)</span>
              </a>
              {!shared && <EditJobButton job={job} className={heroButton} style={heroButtonStyle} />}
              <Link href={matchingHref} className={heroButton} style={heroButtonStyle}><Brain className="h-4 w-4" aria-hidden />Matching IA</Link>
              <Link href={pipelineHref} className={heroButton} style={primaryStyle}><Kanban className="h-4 w-4" aria-hidden />Voir pipeline</Link>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-[1400px] min-[90rem]:max-w-[1920px] mx-auto px-4 sm:px-6 min-[90rem]:px-8 py-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] min-[90rem]:grid-cols-[minmax(0,1fr)_400px] items-start">
        <article aria-label="Description de l’offre" className={card} style={cardStyle}>
          <JobDescription description={job.description} />
          {job.skills.length > 0 && (
            <section aria-labelledby="competences" className="mt-6 pt-5" style={{ borderTop: '1px solid var(--color-border)' }}>
              <h2 id="competences" className="font-bold mb-3" style={{ color: 'var(--color-text)', fontSize: 16 }}>Compétences</h2>
              <ul className="flex flex-wrap gap-2">
                {job.skills.map(skill => (
                  <li key={skill} className="text-[13px] rounded-lg px-2.5 py-1" style={{ background: 'color-mix(in srgb, var(--color-text) 5%, transparent)', color: 'var(--color-text)' }}>{skill}</li>
                ))}
              </ul>
            </section>
          )}
        </article>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-[84px]">
          <section aria-labelledby="suivi" className={card} style={cardStyle}>
            <h2 id="suivi" className="font-semibold uppercase mb-3" style={headingStyle}>Suivi de l’offre</h2>
            <dl className="grid grid-cols-3 gap-2 mb-4">
              {[
                { label: apps.length > 1 ? 'candidatures' : 'candidature', value: apps.length },
                { label: matches > 1 ? 'correspondances IA' : 'correspondance IA', value: matches },
                { label: 'envoyés au client', value: sentToClient },
              ].map(item => (
                <div key={item.label} className="rounded-xl px-3 py-2.5 flex flex-col-reverse" style={{ background: 'color-mix(in srgb, var(--color-text) 3%, transparent)' }}>
                  <dt className="text-[11px] leading-tight" style={muted}>{item.label}</dt>
                  <dd className="text-xl font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{item.value}</dd>
                </div>
              ))}
            </dl>
            {stageCounts.length === 0 ? (
              <p className="text-[13px]" style={muted}>Aucune phase définie.</p>
            ) : (
              <ul aria-label="Candidats par phase" className="flex flex-col gap-2">
                {stageCounts.map(({ stage, count }) => (
                  <li key={stage.slug} className="flex items-center gap-3 text-[13px]" style={{ color: count > 0 ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                    <span className="flex-1 min-w-0 truncate">{stage.label}</span>
                    <span aria-hidden className="w-24 shrink-0 h-1.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--color-text) 6%, transparent)' }}>
                      {count > 0 && <span className="block h-1.5 rounded-full" style={{ width: `${(count / peak) * 100}%`, background: stage.color }} />}
                    </span>
                    <span className="w-6 text-right font-semibold tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-2 gap-2 mt-4">
              <Link href={pipelineHref} className={cardButton} style={primaryStyle}><Kanban className="h-4 w-4" aria-hidden />Voir pipeline</Link>
              <Link href={matchingHref} className={cardButton} style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                <Brain className="h-4 w-4" aria-hidden />Matching IA
              </Link>
            </div>
          </section>

          <section aria-labelledby="informations" className={card} style={cardStyle}>
            <h2 id="informations" className="font-semibold uppercase mb-3" style={headingStyle}>Informations clés</h2>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-[13px]">
              {facts.map(f => (
                <div key={f.label} className="contents">
                  <dt style={muted}>{f.label}</dt>
                  <dd className="font-medium" style={{ color: 'var(--color-text)' }}>{f.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="diffusion" className={card} style={cardStyle}>
            <h2 id="diffusion" className="font-semibold uppercase mb-2.5" style={headingStyle}>Diffusion</h2>
            <p className="flex items-center gap-2.5 text-[13px]" style={{ color: 'var(--color-text)' }}>
              <Share2 className="h-3.5 w-3.5 shrink-0" aria-hidden style={muted} />
              <span>{diffusion}</span>
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}
