'use client'

import Link from 'next/link'
import { ClipboardCheck, ExternalLink, Globe, Share2, Users, type LucideIcon } from 'lucide-react'
import { HoverCard } from '@/components/ui/hover-card'
import type { TrackingStep, TrackingStepKey, TrackingTone } from '@/lib/ao/tracking'
import { fieldLabel } from '@/app/admin/candidats/labels'

// Suivi d'une offre, de la validation au sourcing (règles : src/lib/ao/tracking.ts) : icônes de la colonne « Suivi »
// du tableau et section « Suivi de la publication » du panneau. Mêmes icônes et mêmes couleurs aux deux endroits ;
// l'état est aussi écrit (infobulle, panneau), jamais porté par la couleur seule.

const ICON: Record<TrackingStepKey, LucideIcon> = { review: ClipboardCheck, job: Globe, social: Share2, sourcing: Users }

/** Couleurs d'état sur fond blanc : nuances 700 (AGENTS.md) ; « pas encore » en gris des icônes inactives. */
const TONE_COLOR: Record<TrackingTone, string> = {
  done: '#047857', working: '#1d4ed8', warning: '#b45309', error: '#b91c1c', todo: 'var(--admin-fg-subtle)',
}
/** Teinte de fond (couleurs hexadécimales seulement : « pas encore » reste sans fond). */
const tint = (tone: TrackingTone) => (tone === 'todo' ? 'transparent' : `${TONE_COLOR[tone]}18`)
const pulse = (tone: TrackingTone) => (tone === 'working' ? 'animate-pulse motion-reduce:animate-none' : '')

/**
 * Colonne « Suivi » d'une offre publiée : offre en ligne, LinkedIn, sourcing (avec le nombre de candidats retenus).
 * Détail au survol, au focus ou au toucher ; liens dans le panneau de l'offre. Hauteur de 16 px : sous le statut, la
 * ligne garde la hauteur des autres (titre et client).
 */
export function TrackingIcons({ steps }: { steps: TrackingStep[] }) {
  const shown = steps.filter(s => s.key !== 'review')
  return (
    <HoverCard bare ariaLabel={`Suivi de la publication : ${shown.map(s => `${s.label}, ${s.text}`).join(' ; ')}`}
      label={
        <span className="flex items-center gap-1">
          {shown.map(s => {
            const Icon = ICON[s.key]
            return (
              <span key={s.key} className="inline-flex items-center gap-0.5 h-4 px-1 rounded" style={{ color: TONE_COLOR[s.tone], background: tint(s.tone) }}>
                <Icon size={11} strokeWidth={2.25} className={pulse(s.tone)} aria-hidden />
                {s.count ? <span className="text-[10px] font-semibold leading-none tabular-nums">{s.count}</span> : null}
              </span>
            )
          })}
        </span>
      }>
      <span className="block font-semibold mb-2">Suivi de la publication</span>
      <span className="block space-y-1.5">
        {shown.map(s => {
          const Icon = ICON[s.key]
          return (
            <span key={s.key} className="flex items-start gap-2">
              <Icon size={13} className="shrink-0 mt-px" style={{ color: TONE_COLOR[s.tone] }} aria-hidden />
              <span><span className="font-medium">{s.label}</span> : {s.text}</span>
            </span>
          )
        })}
      </span>
      <span className="block mt-2" style={{ color: 'var(--admin-fg-muted)' }}>Liens et candidats : ouvrez l’offre.</span>
    </HoverCard>
  )
}

const LEGEND: Record<Exclude<TrackingStepKey, 'review'>, string> = { job: 'Offre en ligne', social: 'LinkedIn', sourcing: 'Candidats de la base retenus' }
const TONE_LABEL: Record<Exclude<TrackingTone, 'todo'>, string> = { done: 'fait', working: 'en cours', warning: 'à vérifier', error: 'échec' }

/**
 * Légende de la colonne « Suivi », dans l'en-tête du tableau : les icônes sur grand écran, les couleurs en plus sur les
 * plus larges (sur une ligne avec le titre et le nombre de résultats).
 */
export function TrackingLegend() {
  return (
    <p className="hidden lg:flex items-center gap-3 text-xs whitespace-nowrap" style={{ color: 'var(--admin-fg-muted)' }}>
      <span className="font-medium text-admin-fg">Suivi :</span>
      {(Object.keys(LEGEND) as (keyof typeof LEGEND)[]).map(key => {
        const Icon = ICON[key]
        return <span key={key} className="inline-flex items-center gap-1"><Icon size={12} aria-hidden />{LEGEND[key]}</span>
      })}
      <span className="hidden 2xl:inline-flex items-center gap-3">
        <span aria-hidden="true">·</span>
        {(Object.keys(TONE_LABEL) as (keyof typeof TONE_LABEL)[]).map(tone => (
          <span key={tone} className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="w-2 h-2 rounded-full" style={{ background: TONE_COLOR[tone] }} />{TONE_LABEL[tone]}
          </span>
        ))}
      </span>
    </p>
  )
}

/**
 * Section « Suivi de la publication » du panneau : les quatre étapes dans l'ordre, chacune avec son état et, quand il
 * existe, le lien vers son résultat. `social` : page où relancer une diffusion en échec ou sans confirmation.
 */
export function TrackingStepper({ steps, social, onShowCandidates }: {
  steps: TrackingStep[]
  social: { href: string; label: string }
  /** Amène à la section Sourcing du panneau (candidats, « Recalculer »). */
  onShowCandidates?: () => void
}) {
  return (
    <section aria-labelledby="ao-tracking-title">
      <p id="ao-tracking-title" style={{ ...fieldLabel, marginBottom: 8 }}>Suivi de la publication</p>
      <ol className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => {
          const Icon = ICON[s.key]
          return (
            <li key={s.key} className="rounded-xl p-3 min-w-0" style={{ background: 'var(--admin-panel-raised)', borderTop: `3px solid ${s.tone === 'todo' ? 'var(--admin-line)' : TONE_COLOR[s.tone]}` }}>
              <p className="flex items-center gap-2 text-xs font-semibold text-admin-fg">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full shrink-0" style={{ color: TONE_COLOR[s.tone], background: tint(s.tone), border: s.tone === 'todo' ? '1px dashed var(--admin-line-strong)' : 'none' }}>
                  <Icon size={13} strokeWidth={2.25} className={pulse(s.tone)} aria-hidden />
                </span>
                <span className="min-w-0 leading-tight">{i + 1}. {s.label}</span>
              </p>
              <p className="text-sm mt-2" style={{ color: s.tone === 'todo' ? 'var(--admin-fg-muted)' : TONE_COLOR[s.tone] }}>{s.text}</p>
              <StepLink step={s} social={social} onShowCandidates={onShowCandidates} />
            </li>
          )
        })}
      </ol>
    </section>
  )
}

const linkClass = 'inline-flex items-center gap-1 mt-1.5 text-xs font-medium underline decoration-dotted underline-offset-2 text-admin-fg hover:decoration-solid'

function StepLink({ step, social, onShowCandidates }: { step: TrackingStep; social: { href: string; label: string }; onShowCandidates?: () => void }) {
  if (step.key === 'job' && step.url) {
    return <a href={step.url} target="_blank" rel="noreferrer" className={linkClass}>Voir l’offre<ExternalLink size={11} aria-hidden /></a>
  }
  if (step.key === 'social' && step.url) {
    return <a href={step.url} target="_blank" rel="noopener noreferrer" className={linkClass}>Voir sur LinkedIn<ExternalLink size={11} aria-hidden /></a>
  }
  if (step.key === 'social' && (step.tone === 'warning' || step.tone === 'error')) {
    return <Link href={social.href} className={linkClass}>{social.label}</Link>
  }
  if (step.key === 'sourcing' && onShowCandidates && (step.count || step.tone === 'warning')) {
    return <button type="button" onClick={onShowCandidates} className={linkClass}>{step.count ? 'Voir les candidats' : 'Relancer le sourcing'}</button>
  }
  return null
}
