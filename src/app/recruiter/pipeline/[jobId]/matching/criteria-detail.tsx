import { useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Scale, Star } from 'lucide-react'
import { CriteriaDrawer } from '@/components/ao/criteria-editor'
import type { CriteriaBreakdown } from '@/lib/criteria-scoring'
import type { OfferCriteriaSet } from '@/lib/offer-criteria'
import type { JobMatchResult } from '@/lib/matching-core'
import { scoreAdjustment } from '@/lib/score-breakdown'
import { judgeOwnCriteriaAction, saveCandidateCriteriaAction, saveOfferCriteriaAction, saveOwnCriteriaAction } from '../matching-actions'

// Détail d'un score noté sur les critères de l'offre (ADR 0061) : comme ScoreDetail (score-detail.tsx) pour le barème,
// mais critères et libellés sont ceux qui s'appliquent au candidat pour ce recruteur, relus dans ses critères
// (criteriaBreakdown). Et les critères eux-mêmes (phase 3) : ceux de l'offre — modifiables par qui peut modifier l'offre,
// en lecture sinon —, les miens pour l'offre et pour un candidat ; ils remplacent la pondération par offre de l'ADR 0049.
// Sans « use client » : importé seulement par matching-client.tsx, composant client.

const muted: CSSProperties = { color: 'var(--color-text-muted)' }
const strong: CSSProperties = { color: 'var(--color-text)' }
const barColor = (percent: number) => (percent >= 85 ? '#10b981' : percent >= 70 ? '#3b82f6' : percent >= 55 ? '#f59e0b' : '#ef4444')
const pts = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })

/** `list` : un critère par ligne (panneau du candidat) ; `card` : grille sous la ligne du tableau. */
export function CriteriaScoreDetail({ breakdown, match, variant }: { breakdown: CriteriaBreakdown; match: JobMatchResult & { score: number }; variant: 'card' | 'list' }) {
  const adjustment = scoreAdjustment(match.source, match.score, breakdown.score, !!match.recommendation)
  const card = variant === 'card'
  return (
    <div className={card ? 'mt-2.5 rounded-xl px-3 py-2.5' : ''} style={card ? { background: 'color-mix(in srgb, var(--color-text) 3%, transparent)', border: '1px solid var(--color-border)' } : undefined}>
      <ul aria-label="Détail du score sur les critères de l’offre" className={card ? 'grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2.5' : 'flex flex-col gap-2'}>
        {breakdown.parts.map(p => (
          <li key={p.id} className="min-w-0" title={`${p.name} : ${p.detail}`}>
            <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
              <span className="font-semibold truncate" style={strong}>{p.name}</span>
              <span className="font-bold tabular-nums shrink-0" style={strong}>{pts(p.points)}/{p.weight}</span>
            </div>
            <div aria-hidden className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--color-text) 10%, transparent)' }}>
              <div className="h-full rounded-full" style={{ width: `${p.percent}%`, background: barColor(p.percent) }} />
            </div>
            <p className={`mt-1 text-[10.5px] ${card ? 'truncate' : ''}`} style={muted}>{p.detail}</p>
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

/** Critères de l'offre, pour tous ses recruteurs (pondération générale), en lecture. */
export function OfferCriteriaCard({ criteria, className = '' }: { criteria: OfferCriteriaSet; className?: string }) {
  return (
    <section aria-labelledby="offer-criteria-title" className={`rounded-[20px] p-4 ${className}`} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <h2 id="offer-criteria-title" className="flex items-center gap-2 font-semibold text-[13px]" style={strong}>
        <Scale className="h-4 w-4" aria-hidden />Critères de l’offre
      </h2>
      <p className="mt-1 text-[11.5px] leading-snug" style={muted}>
        Pondération générale de l’offre, réglée avant sa publication : les CV sont notés sur ces critères, pour tous ses
        recruteurs. ★ requis : s’il manque, le score reste sous 65.
      </p>
      <ul className="mt-3 flex flex-col gap-2.5">
        {criteria.criteria.map(c => (
          <li key={c.id} className="text-[12.5px]">
            <p className="flex items-baseline justify-between gap-2">
              <span className="font-semibold" style={strong}>{c.name}</span>
              <span className="tabular-nums font-semibold" style={strong}>{c.weight}</span>
            </p>
            {c.labels.length > 0 ? (
              <p className="mt-0.5 leading-snug" style={muted}>
                {c.labels.map((l, i) => (
                  <span key={l.label}>
                    {i > 0 && ' · '}
                    {l.required && <Star className="inline h-3 w-3 -mt-0.5 mr-0.5" fill="#c2410c" color="#c2410c" aria-label="requis" />}
                    {l.label} <span className="tabular-nums">{l.weight}</span>
                  </span>
                ))}
              </p>
            ) : (
              <p className="mt-0.5" style={muted}>Jugé d’après l’offre dans son ensemble.</p>
            )}
          </li>
        ))}
      </ul>
      {criteria.alternativeTitles.length > 0 && (
        <p className="mt-3 text-[11.5px]" style={muted}>Autres intitulés cherchés : {criteria.alternativeTitles.join(', ')}</p>
      )}
    </section>
  )
}

/** Les critères qui s'appliquent sur l'offre pour ce recruteur ; null : offre notée sur le barème. */
export interface MatchingCriteria {
  general: OfferCriteriaSet
  own: OfferCriteriaSet | null
  candidates: Record<string, OfferCriteriaSet>
}

/**
 * Critères de l'offre et les miens, dans la colonne de droite du Matching IA (ADR 0061 phase 3) : un résumé de chacun et
 * « Configurer », qui ouvre l'éditeur dans un panneau à droite. `criteria` null : offre encore notée sur le barème ;
 * `canEdit` lui donne alors ses premiers critères (`start`, critères par défaut de l'offre). Un enregistrement relit la
 * page (scores recalculés par le serveur) ; une notation par l'IA tourne en arrière-plan.
 */
export function CriteriaPanel({ jobId, criteria, start, canEdit, pending, className = '' }: {
  jobId: string; criteria: MatchingCriteria | null; start: OfferCriteriaSet; canEdit: boolean
  /** Candidats dont le score attend un jugement sur mes libellés. */
  pending: number
  className?: string
}) {
  const router = useRouter()
  const [general, setGeneral] = useState(criteria?.general ?? start)
  const [own, setOwn] = useState(criteria?.own ?? criteria?.general ?? start)
  const [judging, setJudging] = useState(false)
  const [judgeNote, setJudgeNote] = useState('')
  if (!criteria && !canEdit) return null

  async function saveGeneral(set: OfferCriteriaSet) {
    const res = await saveOfferCriteriaAction(jobId, set)
    if (!res.error) router.refresh()
    return {
      error: res.error,
      message: res.rescoring
        ? 'Critères enregistrés : les candidats de l’offre sont renotés en arrière-plan (quelques minutes). Rechargez la page pour voir leurs scores.'
        : 'Critères enregistrés : scores recalculés.',
    }
  }

  async function saveOwn(set: OfferCriteriaSet | null) {
    const res = await saveOwnCriteriaAction(jobId, set)
    if (!res.error) router.refresh()
    return {
      error: res.error,
      message: !set ? 'Critères de l’offre de nouveau appliqués.' : res.judging
        ? 'Vos critères sont enregistrés : vos candidats sont notés sur vos libellés en arrière-plan (quelques minutes).'
        : 'Vos critères sont enregistrés : scores recalculés.',
    }
  }

  async function judgeMore() {
    setJudging(true)
    setJudgeNote('')
    const res = await judgeOwnCriteriaAction(jobId).catch(() => ({ error: 'Notation interrompue : réessayez.', outcome: undefined }))
    setJudging(false)
    if (res.error || !res.outcome) return setJudgeNote(res.error ?? 'Notation interrompue : réessayez.')
    const { judged, failed, remaining } = res.outcome
    setJudgeNote(`${judged} candidat${judged > 1 ? 's' : ''} noté${judged > 1 ? 's' : ''}${failed ? `, ${failed} en échec` : ''}${remaining ? `, ${remaining} restant${remaining > 1 ? 's' : ''}` : ''}.`)
    router.refresh()
  }

  return (
    <section aria-label="Critères de matching" className={`rounded-[20px] p-4 ${className}`} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      {pending > 0 && (
        <div role="status" className="mb-3 rounded-xl px-3 py-2 text-[12px]" style={{ background: 'rgba(180,83,9,0.08)', color: '#b45309' }}>
          {pending} candidat{pending > 1 ? 's' : ''} pas encore noté{pending > 1 ? 's' : ''} sur vos critères : leur score est celui de l’offre.
          <button type="button" onClick={() => router.refresh()} className="ml-2 font-semibold underline">Actualiser</button>
          {criteria?.own && (
            <button type="button" onClick={judgeMore} disabled={judging} className="ml-2 inline-flex items-center gap-1 font-semibold underline disabled:opacity-50">
              {judging && <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden />}Noter la suite
            </button>
          )}
          {judgeNote && <span className="block mt-1">{judgeNote}</span>}
        </div>
      )}
      {canEdit ? (
        <CriteriaDrawer criteria={general} onChange={setGeneral} save={saveGeneral} source={criteria ? undefined : 'default'}
          title={criteria ? 'Critères de l’offre' : 'Critères de l’offre (aucun pour l’instant)'} openLabel={criteria ? 'Configurer' : 'Régler les critères'}
          intro={criteria
            ? 'Pour tous les recruteurs de l’offre. Changer un libellé fait renoter ses candidats en arrière-plan (quota du jour de l’organisation) ; changer un poids ou ★ recalcule leurs scores aussitôt.'
            : 'Cette offre est notée sur le barème par défaut. Réglez ses critères : ses candidats seront renotés sur eux.'} />
      ) : criteria && <OfferCriteriaCard criteria={criteria.general} />}
      {criteria && (
        <CriteriaDrawer className="mt-4 border-t pt-4" style={{ borderColor: 'var(--color-border)' }} criteria={own} onChange={setOwn} save={saveOwn}
          title="Mes critères pour cette offre" badge={criteria.own ? 'Propres' : 'Ceux de l’offre'} openLabel="Configurer"
          intro="Les vôtres seulement : poids, ★ et libellés. Vos propres libellés font noter vos candidats par l’IA en arrière-plan (quota du jour de l’organisation)."
          reset={criteria.own ? { label: 'Revenir aux critères de l’offre', to: criteria.general, run: () => saveOwn(null) } : undefined} />
      )}
    </section>
  )
}

/** « Critères pour ce candidat » (détail d'un candidat du Matching IA) : les miens pour lui seul. */
export function CandidateCriteriaEditor({ jobId, candidateKey, criteria }: { jobId: string; candidateKey: string; criteria: MatchingCriteria }) {
  const router = useRouter()
  const own = criteria.candidates[candidateKey]
  const [set, setSet] = useState(own ?? criteria.own ?? criteria.general)
  async function save(next: OfferCriteriaSet | null) {
    const res = await saveCandidateCriteriaAction(jobId, candidateKey, next)
    if (!res.error) router.refresh()
    return {
      error: res.error,
      message: !next ? 'Critères de l’offre de nouveau appliqués.' : res.judging ? 'Enregistrés : ce candidat est noté sur ces libellés en arrière-plan.' : 'Enregistrés : score recalculé.',
    }
  }
  return (
    <CriteriaDrawer compact className="mt-3" criteria={set} onChange={setSet} save={save} title="Critères pour ce candidat"
      badge={own ? 'Propres' : undefined} openLabel="Configurer"
      intro="Pour ce candidat seulement, à vos yeux : poids, ★ et libellés (de nouveaux libellés le font noter par l’IA)."
      reset={own ? { label: 'Revenir à mes critères de l’offre', to: criteria.own ?? criteria.general, run: () => save(null) } : undefined} />
  )
}
