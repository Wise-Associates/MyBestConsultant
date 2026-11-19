import { useState, useTransition, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Loader2, SlidersHorizontal } from 'lucide-react'
import type { ScaleWeights } from '@/lib/scoring-weights'
import type { ActiveScale } from '@/lib/match-scoring'
import { WeightsFields, draftTotal, readDraft, toDraft } from './scoring-weights-dialog'
import { saveCandidateScoringWeightsAction, saveJobScoringWeightsAction } from './matching-actions'

// Poids qui remplacent ceux du niveau au-dessus (demande du 2026-11-19, ADR 0049), propres au recruteur connecté :
// - d'une offre (JobWeightsPanel, colonne de droite du Matching IA) : remplacent ses poids globaux pour l'offre ;
// - d'un candidat pour une offre (CandidateWeightsPanel, détail du candidat au Matching IA, fenêtre « Modifier » de sa
//   carte au pipeline) : remplacent ceux de l'offre pour ce candidat, dans le barème de son score.
// Les scores sont recalculés d'après les jugements enregistrés, sans nouvel appel d'IA.
// Sans « use client » : module importé seulement par des composants clients (matching-client.tsx, pipeline-client.tsx),
// dont il fait partie ; ses props sont des fonctions, qu'une page serveur ne pourrait pas lui passer.

const muted: CSSProperties = { color: 'var(--color-text-muted)' }
const strong: CSSProperties = { color: 'var(--color-text)' }
const button = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)'

interface Copy {
  title: string
  description: string
  /** Nom des poids du niveau au-dessus : rappel à côté de chaque champ (« global 35 ») et pastille sans poids propres. */
  referenceLabel: string
  referenceBadge: string
  ownBadge: string
  saveLabel: string
  revertLabel: string
  legend: string
}

/**
 * Section repliable : un champ par critère du barème `scale`, total de 100 exigé. `reference` : poids qui s'appliquent
 * sans poids propres ; `own` : poids propres enregistrés (null : aucun). `save(null)` les retire.
 */
function WeightsOverridePanel({ scale, reference, own, copy, unreadable, save, onSaved, className = '' }: {
  scale: ActiveScale; reference: ScaleWeights; own: ScaleWeights | null; copy: Copy; unreadable?: string
  save: (weights: ScaleWeights | null) => Promise<{ error?: string }>
  onSaved: (weights: ScaleWeights | null) => void
  className?: string
}) {
  const current = own ?? reference
  const [draft, setDraft] = useState(() => toDraft(current))
  const [error, setError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()
  // Poids enregistrés changés ailleurs (l'autre exemplaire du panneau, au Matching IA : colonne de droite et carte sous
  // 90rem) : la saisie repart d'eux, sinon un « Enregistrer » renverrait des poids périmés.
  const currentKey = JSON.stringify(current)
  const [syncedKey, setSyncedKey] = useState(currentKey)
  if (currentKey !== syncedKey) {
    setSyncedKey(currentKey)
    setDraft(toDraft(current))
  }

  const read = readDraft(draft)
  const total = draftTotal(read)
  const changed = JSON.stringify(read) !== currentKey

  const submit = (weights: ScaleWeights | null) => startSaving(async () => {
    setError(null)
    let res: { error?: string }
    try {
      res = await save(weights)
    } catch (err) {
      // Refus d'accès (session expirée, offre retirée) ou serveur injoignable : message sur place, pas la page d'erreur.
      console.error('[poids] enregistrement des poids impossible', err)
      setError('Enregistrement impossible : rechargez la page, puis réessayez.')
      return
    }
    if (res.error) { setError(res.error); return }
    onSaved(weights)
  })

  return (
    <details className={`group rounded-2xl ${className}`} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer list-none rounded-2xl text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text) [&::-webkit-details-marker]:hidden"
        style={strong}>
        <span className="inline-flex items-center gap-2 min-w-0">
          <SlidersHorizontal className="h-4 w-4 shrink-0" style={muted} aria-hidden />
          <span>{copy.title}</span>
        </span>
        <span className="inline-flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-semibold rounded-full px-2 py-0.5"
            style={own ? { background: 'color-mix(in srgb, var(--color-brand-orange) 14%, transparent)', color: 'var(--color-text)' } : { background: 'color-mix(in srgb, var(--color-text) 6%, transparent)', ...muted }}>
            {own ? copy.ownBadge : copy.referenceBadge}
          </span>
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" style={muted} aria-hidden />
        </span>
      </summary>

      <div className="px-4 pb-4 flex flex-col gap-3">
        <p className="text-xs leading-relaxed" style={muted}>{copy.description}</p>
        {unreadable && (
          <p role="status" className="text-xs rounded-lg px-3 py-2" style={{ background: 'rgba(245,158,11,0.12)', color: '#b45309' }}>{unreadable}</p>
        )}

        <WeightsFields scale={scale} draft={draft} onChange={setDraft} reference={reference} referenceLabel={copy.referenceLabel} legend={copy.legend} />

        {error && <p role="alert" className="text-xs" style={{ color: '#b91c1c' }}>{error}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => submit(read)} disabled={total !== 100 || !changed || saving}
            className={`${button} font-bold`} style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} {copy.saveLabel}
          </button>
          {changed && (
            <button type="button" onClick={() => { setDraft(toDraft(current)); setError(null) }} disabled={saving}
              className={button} style={{ ...strong, border: '1px solid var(--color-border)' }}>
              Annuler
            </button>
          )}
        </div>
        {own && (
          <button type="button" onClick={() => submit(null)} disabled={saving}
            className="self-start text-xs font-semibold underline disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)" style={muted}>
            {copy.revertLabel}
          </button>
        )}
      </div>
    </details>
  )
}

const ESSENTIAL = 'Total de 100 points ; un critère essentiel qui manque plafonne toujours le score.'

/** Poids du matching de l'offre (colonne de droite du Matching IA). `job` null : les poids globaux `global` s'appliquent. */
export function JobWeightsPanel({ jobId, global, job, unreadable, className }: {
  jobId: string; global: ScaleWeights; job: ScaleWeights | null; unreadable: boolean; className?: string
}) {
  const router = useRouter()
  return (
    <WeightsOverridePanel scale="matching" reference={global} own={job} className={className}
      unreadable={unreadable ? 'Les poids de cette offre n’ont pas pu être lus : vos poids globaux s’appliquent.' : undefined}
      copy={{
        title: 'Pondération de l’offre', referenceLabel: 'global', referenceBadge: 'Poids globaux', ownBadge: 'Propre à l’offre',
        saveLabel: 'Enregistrer pour cette offre', revertLabel: 'Revenir à mes poids globaux pour cette offre',
        legend: 'Poids du matching de cette offre',
        description: `Vos poids pour le matching de cette offre seulement : ils remplacent vos poids globaux ici, et les scores de la page sont recalculés sans nouvelle analyse. ${ESSENTIAL}`,
      }}
      save={weights => saveJobScoringWeightsAction(jobId, weights)}
      // Les scores de toute la page changent : le serveur les recalcule.
      onSaved={() => router.refresh()} />
  )
}

/**
 * Poids d'un candidat pour l'offre, dans le barème de son score (`scale`). `reference` : poids de l'offre pour ce barème ;
 * `own` : ceux du candidat (null : aucun). `onSaved` : la page met à jour le score du candidat.
 */
export function CandidateWeightsPanel({ jobId, candidateKey, scale, reference, own, onSaved, className }: {
  jobId: string; candidateKey: string; scale: ActiveScale; reference: ScaleWeights; own: ScaleWeights | null
  onSaved: (weights: ScaleWeights | null) => void; className?: string
}) {
  return (
    <WeightsOverridePanel scale={scale} reference={reference} own={own} className={className}
      copy={{
        title: 'Pondération de ce candidat', referenceLabel: 'offre', referenceBadge: 'Poids de l’offre', ownBadge: 'Pondération propre',
        saveLabel: 'Enregistrer pour ce candidat', revertLabel: 'Revenir aux poids de l’offre',
        legend: `Poids du ${scale === 'final' ? 'score final' : 'matching'} de ce candidat`,
        description: `Vos poids pour ce candidat sur cette offre seulement (${scale === 'final' ? 'score final' : 'matching'}) : ils remplacent ceux de l’offre pour lui, sans nouvelle analyse. Son score n’est alors plus calculé comme celui des autres candidats. ${ESSENTIAL}`,
      }}
      save={weights => saveCandidateScoringWeightsAction(jobId, candidateKey, scale, weights)}
      onSaved={onSaved} />
  )
}
