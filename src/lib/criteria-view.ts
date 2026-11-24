import { criteriaBreakdown, isCriteriaSummary } from './criteria-scoring'
import { withBonus } from './match-scoring'
import { criteriaFingerprint, type OfferCriteriaSet } from './offer-criteria'
import { candidateWeightsKey, type WeightedCandidate } from './scoring-weights'

// Critères qui s'appliquent à un candidat d'une offre pour un recruteur (ADR 0061 phase 3, demande du 2026-11-24 :
// « si un recruteur les change pour lui, nouvelle pondération par offre et par recruteur ; puis par candidat ») : ceux
// du recruteur pour ce candidat, sinon les siens pour l'offre, sinon ceux de l'offre. Poids et libellés : à libellés
// égaux (même empreinte), le score se recalcule sur le jugement enregistré ; à libellés différents, il faut un jugement
// de l'IA pour ces libellés (criteria_judgements, partagé par les recruteurs qui ont les mêmes libellés), sinon le score
// de l'offre reste affiché, marqué « en cours de notation ». Pur, testé (criteria-view.test.ts).

export interface CriteriaContext {
  /** Critères généraux de l'offre (ses scores enregistrés sont notés sur eux). */
  general: OfferCriteriaSet
  /** Critères du recruteur pour l'offre ; null : ceux de l'offre. */
  own: OfferCriteriaSet | null
  /** Critères du recruteur pour un candidat, par clé candidateWeightsKey. */
  candidates: Record<string, OfferCriteriaSet>
  /** Jugements enregistrés pour d'autres libellés que ceux de l'offre : judgementKey(empreinte, clé) → raison (résumé v3 — phrase). */
  judgements: Map<string, string>
}

export const judgementKey = (fingerprint: string, candidate: string) => `${fingerprint}:${candidate}`

/** Critères d'un candidat pour ce recruteur : les siens pour ce candidat, sinon les siens pour l'offre, sinon ceux de l'offre. */
export function rowCriteria(ctx: Pick<CriteriaContext, 'general' | 'own' | 'candidates'>, row: WeightedCandidate): OfferCriteriaSet {
  return ctx.candidates[candidateWeightsKey(row)] ?? ctx.own ?? ctx.general
}

/** Empreintes de libellés à juger en plus de ceux de l'offre (critères du recruteur et de ses candidats), sans doublon. */
export function extraFingerprints(ctx: Pick<CriteriaContext, 'general' | 'own' | 'candidates'>): string[] {
  const general = criteriaFingerprint(ctx.general)
  return [...new Set([ctx.own, ...Object.values(ctx.candidates)].flatMap(set => (set ? [criteriaFingerprint(set)] : [])))]
    .filter(fp => fp !== general)
}

/**
 * Libellés à faire juger par l'IA (une place du quota) : ni ceux de l'offre, ni ceux que ce recruteur a déjà enregistrés
 * à cet endroit ou au-dessus (`known` : ses critères d'avant pour ce candidat, ses critères pour l'offre). Changer un poids
 * ou ★ de ses propres libellés ne coûte rien (revue de code du 2026-11-24 : chaque enregistrement prenait une place).
 */
export function needsJudging(next: OfferCriteriaSet, general: OfferCriteriaSet, known: (OfferCriteriaSet | null | undefined)[]): boolean {
  const fp = criteriaFingerprint(next)
  return fp !== criteriaFingerprint(general) && !known.some(set => set && criteriaFingerprint(set) === fp)
}

/**
 * Scores d'une liste aux critères du recruteur. Seules les lignes notées sur les critères de l'offre (résumé v3) changent :
 * candidatures (score final) et vivier général (barème) gardent les leurs. Une ligne dont les critères ont d'autres
 * libellés prend le jugement enregistré pour eux (sa raison remplace celle de l'offre, pour son détail), sinon garde son
 * score, `criteriaPending` (« notation sur vos critères en cours ») ; une ligne notée sur d'anciens libellés de l'offre
 * (renotation pas encore faite) garde aussi son score, `criteriaStale` (« Rafraîchir »). Un candidat de la base sans CV
 * ne sera jamais jugé : inchangé. L'écart des recommandations (bonus) est gardé. Ordre inchangé.
 */
export function rescoreOnCriteria<M extends WeightedCandidate & { score: number | null; reason: string; cvFileId?: string; recommendation?: { points: number } }>(
  rows: M[], ctx: CriteriaContext,
): (M & { criteriaPending?: boolean; criteriaStale?: boolean })[] {
  const generalFp = criteriaFingerprint(ctx.general)
  return rows.map(m => {
    if (m.score === null || !isCriteriaSummary(m.reason) || (m.source === 'pool' && !m.cvFileId)) return m
    const set = rowCriteria(ctx, m)
    const fp = criteriaFingerprint(set)
    const base = criteriaBreakdown(m.reason, ctx.general)
    // Bonus des recommandations : l'écart au score des jugements, sinon (score noté sur d'anciens libellés) ses points.
    const bonus = base ? m.score - base.score : m.recommendation?.points ?? 0
    if (fp === generalFp) {
      const own = criteriaBreakdown(m.reason, set)
      return own ? { ...m, score: withBonus(own.score, bonus) } : { ...m, criteriaStale: true }
    }
    const reason = ctx.judgements.get(judgementKey(fp, candidateWeightsKey(m)))
    const own = reason ? criteriaBreakdown(reason, set) : null
    return reason && own ? { ...m, score: withBonus(own.score, bonus), reason } : { ...m, criteriaPending: true }
  })
}

/**
 * Scores enregistrés d'une offre à réécrire après un changement des seuls poids ou ★ de ses critères (mêmes libellés : sans
 * IA) : les seuils automatiques (65, 70) lisent les scores enregistrés. Seulement ceux qui changent.
 */
export function rescoredStored(rows: { id: string; score: number; reason: string }[], set: OfferCriteriaSet): { id: string; score: number }[] {
  return rows.flatMap(r => {
    const b = criteriaBreakdown(r.reason, set)
    return b && b.score !== r.score ? [{ id: r.id, score: b.score }] : []
  })
}
