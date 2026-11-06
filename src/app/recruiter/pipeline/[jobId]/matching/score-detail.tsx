import type { CSSProperties } from 'react'
import { ChevronDown, Info } from 'lucide-react'
import { HoverCard } from '@/components/ui/hover-card'
import { CRITERIA, CRITERION_HELP, scoreAdjustment, type ScoreBreakdown } from '@/lib/score-breakdown'
import { DOMAIN_CAP, ROLE_CAP } from '@/lib/match-scoring'
import { SOURCING_MIN_SCORE } from '@/lib/sourcing-rules'
import type { JobMatchResult } from '@/lib/matching-core'

// Détail d'un score sur une carte du Matching IA (demande du 2026-11-05) : la part de chaque critère en pourcentage, ses
// points sur son poids, puis le total, le plafond qui l'abaisse et l'écart dû aux recommandations ; ce que mesure chaque
// critère au survol ou au toucher de son nom, et le mode de calcul complet au-dessus de la liste (ScoringGuide). Calcul
// et textes : src/lib/score-breakdown.ts.

const muted: CSSProperties = { color: 'var(--color-text-muted)' }
const strong: CSSProperties = { color: 'var(--color-text)' }

/** Couleur de la barre, mêmes seuils que les pastilles de score de la page. */
const barColor = (percent: number) => (percent >= 85 ? '#10b981' : percent >= 70 ? '#3b82f6' : percent >= 55 ? '#f59e0b' : '#ef4444')
const pts = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })

export function ScoreDetail({ breakdown, match }: { breakdown: ScoreBreakdown; match: JobMatchResult & { score: number } }) {
  const adjustment = scoreAdjustment(match.source, match.score, breakdown.score, !!match.recommendation)
  return (
    <div className="mt-2.5 rounded-xl px-3 py-2.5" style={{ background: 'color-mix(in srgb, var(--color-text) 3%, transparent)', border: '1px solid var(--color-border)' }}>
      <ul aria-label="Détail du score" className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-2.5">
        {breakdown.parts.map(p => (
          <li key={p.key} className="min-w-0">
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <HoverCard bare ariaLabel={`${p.label} : ce que mesure ce critère`}
                label={<span className="inline-flex items-center gap-1 font-semibold" style={strong}>{p.label}<Info className="h-3 w-3" style={muted} aria-hidden /></span>}>
                <span className="block font-semibold mb-1">{p.label} · {p.max} points</span>
                {CRITERION_HELP[p.key]}
              </HoverCard>
              <span className="font-bold tabular-nums" style={strong}>{p.percent} %</span>
            </div>
            <div aria-hidden className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--color-text) 10%, transparent)' }}>
              <div className="h-full rounded-full" style={{ width: `${p.percent}%`, background: barColor(p.percent) }} />
            </div>
            <p className="mt-1 text-[10px] truncate" style={muted} title={`${p.label} : ${p.detail}`}>
              <span className="tabular-nums">{pts(p.points)}/{p.max} pts</span> · {p.detail}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-snug" style={muted}>
        Total des critères <b className="tabular-nums" style={strong}>{breakdown.total}</b>
        {breakdown.cap && <> · plafonné à <b className="tabular-nums" style={strong}>{breakdown.cap.value}</b> : {breakdown.cap.reason}</>}
        {adjustment && <> · {adjustment.label} <b className="tabular-nums" style={strong}>{adjustment.value > 0 ? '+' : '−'}{Math.abs(adjustment.value)}</b></>}
        {' '}→ score <b className="tabular-nums" style={strong}>{match.score}/100</b>
      </p>
    </div>
  )
}

/**
 * Même détail en colonne, pour le panneau du candidat sur grand écran (dès 1440 px) : un critère par ligne, sa barre, ses
 * points ; jugements résumés au survol de la ligne.
 */
export function ScoreCriteriaList({ breakdown, match }: { breakdown: ScoreBreakdown; match: JobMatchResult & { score: number } }) {
  const adjustment = scoreAdjustment(match.source, match.score, breakdown.score, !!match.recommendation)
  return (
    <div>
      <ul aria-label="Détail du score" className="flex flex-col gap-2">
        {breakdown.parts.map(p => (
          <li key={p.key} className="grid grid-cols-[96px_minmax(0,1fr)_52px] items-center gap-2.5 text-[12.5px]" title={`${p.label} : ${p.detail}`}>
            <HoverCard bare ariaLabel={`${p.label} : ce que mesure ce critère`}
              label={<span className="inline-flex items-center gap-1 font-medium" style={strong}>{p.label}<Info className="h-3 w-3" style={muted} aria-hidden /></span>}>
              <span className="block font-semibold mb-1">{p.label} · {p.max} points</span>
              {CRITERION_HELP[p.key]}
            </HoverCard>
            <span aria-hidden className="h-1.5 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--color-text) 8%, transparent)' }}>
              <span className="block h-full rounded-full" style={{ width: `${p.percent}%`, background: barColor(p.percent) }} />
            </span>
            <span className="text-right font-semibold tabular-nums" style={strong}>{pts(p.points)}/{p.max}</span>
          </li>
        ))}
      </ul>
      {(breakdown.cap || adjustment) && (
        <p className="mt-2.5 text-[11.5px] leading-snug" style={muted}>
          Total des critères <b className="tabular-nums" style={strong}>{breakdown.total}</b>
          {breakdown.cap && <> · plafonné à <b className="tabular-nums" style={strong}>{breakdown.cap.value}</b> : {breakdown.cap.reason}</>}
          {adjustment && <> · {adjustment.label} <b className="tabular-nums" style={strong}>{adjustment.value > 0 ? '+' : '−'}{Math.abs(adjustment.value)}</b></>}
        </p>
      )}
    </div>
  )
}

/** Couleur d'un critère en pastille dans le tableau : oui (vert), partiel (orange), non (rouge). */
export const criterionTone = (percent: number) => (percent >= 85 ? '#10b981' : percent >= 35 ? '#f59e0b' : '#ef4444')

/** Mode de calcul des scores, replié au-dessus de la liste : critères, preuves, plafonds, recommandations, seuils. */
export function ScoringGuide({ className = 'mb-6' }: { className?: string }) {
  return (
    <details className={`group ${className} rounded-2xl`} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer list-none rounded-2xl text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text) [&::-webkit-details-marker]:hidden"
        style={strong}>
        <span className="inline-flex items-center gap-2"><Info className="h-4 w-4" style={muted} aria-hidden />Comment le score est calculé</span>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" style={muted} aria-hidden />
      </summary>
      <div className="px-4 pb-4 text-xs leading-relaxed space-y-3" style={muted}>
        <p>
          L’IA ne donne pas de note. Elle compare les expériences du CV (postes, missions, projets, employeurs, durées) à
          l’offre et juge cinq critères par oui, partiel ou non. Chaque « oui » doit citer une ligne d’expérience du CV,
          vérifiée par l’application : une compétence seulement listée dans le CV ne vaut que « partiel ». Le score est
          ensuite calculé à partir de ces jugements : oui donne toute la part du critère, partiel la moitié, non rien.
        </p>
        <ul className="space-y-2">
          {CRITERIA.map(c => (
            <li key={c.key}>
              <span className="font-semibold" style={strong}>{c.label} · {c.weight} points</span> — {c.help}
            </li>
          ))}
        </ul>
        <p>
          <span className="font-semibold" style={strong}>Plafonds.</span> Un métier du titre non exercé limite le score
          à {ROLE_CAP.non}, un métier seulement voisin à {ROLE_CAP.partiel} ; un domaine exigé absent du parcours le
          limite à {DOMAIN_CAP.non}, un domaine voisin à {DOMAIN_CAP.partiel}. Le plus bas s’applique : un critère
          essentiel qui manque ne se compense pas par les autres.
        </p>
        <p>
          <span className="font-semibold" style={strong}>Recommandations.</span> Les recommandations reçues par le
          candidat sur des expertises de l’offre ajustent le score, sans faire passer le seuil de {SOURCING_MIN_SCORE} à
          un candidat noté en dessous.
        </p>
        <p>
          <span className="font-semibold" style={strong}>Seuil.</span> À {SOURCING_MIN_SCORE} et plus, le candidat
          correspond à l’offre (filtre « Correspond », vivier, sourcing).
        </p>
      </div>
    </details>
  )
}
