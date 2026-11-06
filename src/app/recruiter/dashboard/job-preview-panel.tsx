'use client'

import type { CSSProperties } from 'react'
import Link from 'next/link'
import { MapPin, Sparkles, Share2 } from 'lucide-react'
import { NETWORK_LABEL } from '@/lib/social-content'
import type { CandidateApp } from './applications-panel'
import type { DashboardJobRow } from './jobs-list-client'
import type { FunnelStage } from '@/types'

// Panneau d'aperçu de « Mes offres », à droite de la liste sur les écrans d'au moins 1800 px (dashboard-layout.ts) :
// l'offre choisie d'un clic sur sa ligne, sans quitter la liste. Lecture seule : les actions sur l'offre (modifier,
// diffuser, archiver) restent dans sa ligne.

const CONTRACT_LABELS: Record<string, string> = {
  cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission',
}
const STATE_BADGES = {
  online: { label: 'En ligne', style: { background: '#04785714', color: '#047857' } },
  expired: { label: 'Expirée', style: { background: '#b4530914', color: '#b45309' } },
  archived: { label: 'Archivée', style: { background: 'color-mix(in srgb, var(--color-text) 7%, transparent)', color: 'var(--color-text)' } },
} satisfies Record<DashboardJobRow['facts']['state'], { label: string; style: CSSProperties }>
/** Profils montrés : les mieux notés par l'IA. */
const TOP_PROFILES = 3

const muted: CSSProperties = { color: 'var(--color-text-muted)' }
const card = 'rounded-[20px] p-5 min-[112.5rem]:p-4'
const cardStyle: CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' }
const heading = 'font-semibold uppercase mb-2.5'
// En style : les règles h1–h6 de globals.css (hors couche Tailwind) l'emportent sur les classes de taille.
const headingStyle: CSSProperties = { ...muted, fontSize: 11, letterSpacing: '0.06em', lineHeight: 1.4 }
const button = 'h-10 px-3.5 rounded-[10px] inline-flex items-center justify-center gap-2 text-[13px] font-semibold no-underline cursor-pointer transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)'

export function JobPreviewPanel({ row, apps, stages, onOpenApplications }: {
  row: DashboardJobRow
  apps: CandidateApp[]
  /** Phases du pipeline, dans l'ordre. */
  stages: FunnelStage[]
  onOpenApplications: () => void
}) {
  const { job, facts } = row
  const matchingHref = `/recruiter/pipeline/${job.$id}/matching`
  const stageCounts = stages.map(stage => ({ stage, count: apps.filter(a => a.status === stage.slug).length }))
  const peak = Math.max(1, ...stageCounts.map(s => s.count))
  const top = apps
    .filter((a): a is CandidateApp & { aiScore: number } => typeof a.aiScore === 'number')
    .sort((a, b) => b.aiScore - a.aiScore)
    .slice(0, TOP_PROFILES)
  const stageLabel = (slug: string) => stages.find(s => s.slug === slug)?.label ?? slug
  const badge = STATE_BADGES[facts.state]

  return (
    <section aria-label={`Aperçu de l’offre ${job.title}`} className="flex flex-col gap-3.5">
      <div className={card} style={cardStyle}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-bold" style={{ color: 'var(--color-text)', fontSize: 17, lineHeight: 1.35, letterSpacing: '-0.01em' }}>{job.title}</h2>
          <span className="shrink-0 text-[11px] font-semibold rounded-full px-2.5 py-0.5" style={badge.style}>{badge.label}</span>
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 flex-wrap text-[13px]" style={muted}>
          <MapPin className="h-3.25 w-3.25" aria-hidden />
          <span>{job.location}</span>
          {job.contractType && <><span aria-hidden>·</span><span>{CONTRACT_LABELS[job.contractType]}</span></>}
          <span aria-hidden>·</span><span>Publiée le {row.publishedOn}</span>
        </p>

        <dl className="grid grid-cols-3 gap-2 my-4">
          {[
            { label: facts.applications > 1 ? 'candidatures' : 'candidature', value: String(facts.applications) },
            { label: facts.newApplications > 1 ? 'nouvelles' : 'nouvelle', value: facts.newApplications > 0 ? `+${facts.newApplications}` : '0', accent: facts.newApplications > 0 },
            { label: row.matches > 1 ? 'correspondances IA' : 'correspondance IA', value: String(row.matches) },
          ].map(item => (
            <div key={item.label} className="rounded-xl px-3 py-2.5 flex flex-col-reverse" style={{ background: 'color-mix(in srgb, var(--color-text) 3%, transparent)' }}>
              <dt className="text-[11px] leading-tight" style={muted}>{item.label}</dt>
              <dd className="text-xl font-semibold tabular-nums" style={{ color: item.accent ? 'var(--color-primary)' : 'var(--color-text)' }}>{item.value}</dd>
            </div>
          ))}
        </dl>

        <h3 className={heading} style={headingStyle}>Pipeline</h3>
        {stageCounts.length === 0 ? (
          <p className="text-[13px]" style={muted}>Aucune phase définie.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {stageCounts.map(({ stage, count }) => (
              <li key={stage.slug} className="flex items-center gap-3 text-[13px]" style={{ color: 'var(--color-text)' }}>
                <span className="w-28 truncate">{stage.label}</span>
                <span aria-hidden className="flex-1 h-1.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--color-text) 6%, transparent)' }}>
                  {count > 0 && <span className="block h-1.5 rounded-full" style={{ width: `${(count / peak) * 100}%`, background: stage.color }} />}
                </span>
                <span className="w-6 text-right font-semibold tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-2 gap-2 mt-4">
          <Link href={`/recruiter/pipeline/${job.$id}`} className={button} style={{ background: 'var(--color-primary)', color: 'var(--color-primary-fg)' }}>Ouvrir le pipeline</Link>
          <Link href={matchingHref} className={button} style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            <Sparkles className="h-3.5 w-3.5" aria-hidden />Matching IA
          </Link>
        </div>
      </div>

      <div className={card} style={cardStyle}>
        <h3 className={heading} style={headingStyle}>Meilleurs profils</h3>
        {top.length === 0 ? (
          <p className="text-[13px]" style={muted}>
            {apps.length === 0 ? 'Aucune candidature pour le moment.' : 'Aucune candidature encore analysée par l’IA.'}
          </p>
        ) : (
          <ul>
            {top.map((app, i) => (
              <li key={app.appId} className="flex items-center gap-3 py-2" style={{ borderTop: i === 0 ? undefined : '1px solid var(--color-border)' }}>
                <div className="min-w-0 flex-1">
                  <Link href={`/recruiter/candidates/${app.appId}`} className="block truncate text-[13px] font-semibold no-underline hover:underline" style={{ color: 'var(--color-text)' }}>
                    {app.candidateName || app.candidateEmail}
                  </Link>
                  <p className="text-xs truncate" style={muted}>{stageLabel(app.status)}</p>
                </div>
                <span className="shrink-0 text-xs font-bold tabular-nums rounded-lg px-2 py-1"
                  style={{ background: 'color-mix(in srgb, var(--color-primary) 12%, transparent)', color: 'var(--color-text)' }}>
                  {app.aiScore}<span className="sr-only"> sur 100</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {apps.length > 0 && (
          <button type="button" onClick={onOpenApplications}
            className={`${button} w-full mt-3 bg-transparent`} style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            Voir {apps.length > 1 ? `les ${apps.length} candidatures` : 'la candidature'}
          </button>
        )}
      </div>

      <div className={card} style={cardStyle}>
        <h3 className={heading} style={headingStyle}>Diffusion</h3>
        <p className="flex items-center gap-2.5 text-[13px]" style={{ color: 'var(--color-text)' }}>
          <Share2 className="h-3.5 w-3.5 shrink-0" aria-hidden style={muted} />
          <span>{diffusionText(row)}</span>
        </p>
      </div>
    </section>
  )
}

/** État de la dernière diffusion, en une phrase (le bouton qui la lance ou la relance est dans la ligne de l'offre). */
function diffusionText(row: DashboardJobRow): string {
  const info = row.social
  if (row.shared) return 'Gérée par la plateforme'
  if (row.facts.state !== 'online') return 'Hors ligne'
  if (!info) return 'Pas encore diffusée'
  const networks = info.results
    .filter(r => r.status === 'published' || r.status === 'scheduled')
    .map(r => NETWORK_LABEL[r.network])
    .join(', ')
  switch (info.status) {
    case 'published': return `${networks || 'Réseaux sociaux'} : publiée le ${info.sentOn}`
    case 'partial': return `En partie publiée le ${info.sentOn}${networks ? ` (${networks})` : ''}`
    case 'failed': return 'Échec de la dernière diffusion : relancez-la depuis la ligne de l’offre'
    default: return info.stale ? 'Envoyée, sans confirmation' : 'Publication en cours…'
  }
}
