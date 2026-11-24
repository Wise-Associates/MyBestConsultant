import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { criteriaSummary, type CriteriaJudgements } from './criteria-scoring'
import { extraFingerprints, judgementKey, needsJudging, rescoreOnCriteria, rescoredStored, rowCriteria, type CriteriaContext } from './criteria-view'
import { criteriaFingerprint, type OfferCriteriaSet } from './offer-criteria'

// Critères et candidats fictifs.
const GENERAL: OfferCriteriaSet = {
  version: 1,
  criteria: [
    { id: 'poste', name: 'Poste', weight: 60, labels: [{ label: 'Développeur Java', weight: 70, required: true }, { label: 'Développeur Angular', weight: 30, required: false }] },
    { id: 'competences', name: 'Techno', weight: 40, labels: [{ label: 'Java', weight: 50, required: true }, { label: 'Kafka', weight: 50, required: false }] },
  ],
  alternativeTitles: [],
}
const OWN_WEIGHTS: OfferCriteriaSet = { ...GENERAL, criteria: [{ ...GENERAL.criteria[0], labels: [{ ...GENERAL.criteria[0].labels[0], weight: 50 }, { ...GENERAL.criteria[0].labels[1], weight: 50 }] }, GENERAL.criteria[1]] }
const OWN_LABELS: OfferCriteriaSet = { ...GENERAL, criteria: [GENERAL.criteria[0], { ...GENERAL.criteria[1], labels: [{ label: 'Java', weight: 50, required: true }, { label: 'RabbitMQ', weight: 50, required: false }] }] }

const reasonOf = (set: OfferCriteriaSet, poste: ('oui' | 'non')[], techno: ('oui' | 'partiel' | 'non')[]) => {
  const j: CriteriaJudgements = {
    fingerprint: criteriaFingerprint(set), roles: set.criteria[0].labels.map((l, i) => ({ title: l.label, fit: poste[i] })),
    criteria: [{ id: 'poste', values: poste }, { id: 'competences', values: techno }],
  }
  return `${criteriaSummary(j)} — Phrase fictive.`
}
// Java oui, Angular non ; Java oui, Kafka partiel : 60 × 0,7 + 40 × 0,75 = 72.
const pool = { source: 'pool' as const, id: 'row1', candidateId: 'cand1', cvFileId: 'cv1', score: 72, reason: reasonOf(GENERAL, ['oui', 'non'], ['oui', 'partiel']) }
const ctx = (over: Partial<CriteriaContext> = {}): CriteriaContext => ({ general: GENERAL, own: null, candidates: {}, judgements: new Map(), ...over })

describe('critères d’un recruteur pour une offre et pour un candidat (ADR 0061, phase 3)', () => {
  it('candidat, sinon offre du recruteur, sinon offre', () => {
    assert.equal(rowCriteria(ctx(), pool), GENERAL)
    assert.equal(rowCriteria(ctx({ own: OWN_WEIGHTS }), pool), OWN_WEIGHTS)
    assert.equal(rowCriteria(ctx({ own: OWN_WEIGHTS, candidates: { 'p:cand1': OWN_LABELS } }), pool), OWN_LABELS)
  })

  it('mêmes libellés : score recalculé sans IA ; bonus des recommandations gardé', () => {
    // Java 50 / Angular 50 : 60 × 0,5 + 30 = 60.
    assert.equal(rescoreOnCriteria([pool], ctx({ own: OWN_WEIGHTS }))[0].score, 60)
    assert.equal(rescoreOnCriteria([{ ...pool, score: 75 }], ctx())[0].score, 75)
    assert.deepEqual(extraFingerprints(ctx({ own: OWN_WEIGHTS })), [])
  })

  it('autres libellés : le jugement enregistré pour eux, sinon le score de l’offre marqué « en cours »', () => {
    const own = ctx({ own: OWN_LABELS })
    assert.deepEqual(extraFingerprints(own), [criteriaFingerprint(OWN_LABELS)])
    const pending = rescoreOnCriteria([pool], own)[0]
    assert.equal(pending.criteriaPending, true)
    assert.equal(pending.score, 72)
    const judged = reasonOf(OWN_LABELS, ['oui', 'non'], ['oui', 'oui'])
    const done = rescoreOnCriteria([pool], { ...own, judgements: new Map([[judgementKey(criteriaFingerprint(OWN_LABELS), 'p:cand1'), judged]]) })[0]
    assert.equal(done.score, 82)
    assert.equal(done.reason, judged)
    assert.equal(done.criteriaPending, undefined)
  })

  it('mes poids et un bonus de recommandations : bonus gardé sur mon score', () => {
    // Stocké 75 = 72 + 3 de recommandations ; mes poids donnent 60 → 63.
    assert.equal(rescoreOnCriteria([{ ...pool, score: 75 }], ctx({ own: OWN_WEIGHTS }))[0].score, 63)
  })

  it('libellés de l’offre changés depuis le score (renotation pas faite) : score gardé, « à renoter »', () => {
    const relabelled: OfferCriteriaSet = { ...GENERAL, alternativeTitles: [], criteria: [GENERAL.criteria[0], { ...GENERAL.criteria[1], labels: [{ label: 'Java', weight: 100, required: true }] }] }
    const row = rescoreOnCriteria([pool], ctx({ general: relabelled }))[0]
    assert.equal(row.criteriaStale, true)
    assert.equal(row.criteriaPending, undefined)
    assert.equal(row.score, 72)
    // Mes libellés jugés, mais score de l'offre noté sur ses anciens libellés : bonus = points des recommandations.
    const judged = reasonOf(OWN_LABELS, ['oui', 'non'], ['oui', 'oui'])
    const mine = rescoreOnCriteria([{ ...pool, score: 75, recommendation: { points: 3 } }], ctx({
      general: relabelled, own: OWN_LABELS, judgements: new Map([[judgementKey(criteriaFingerprint(OWN_LABELS), 'p:cand1'), judged]]),
    }))[0]
    assert.equal(mine.score, 85)
  })

  it('candidat de la base sans CV : jamais jugé, ni « en cours »', () => {
    const noCv = { ...pool, cvFileId: undefined }
    assert.deepEqual(rescoreOnCriteria([noCv], ctx({ own: OWN_LABELS })), [noCv])
  })

  it('place du quota : seulement pour des libellés nouveaux pour ce recruteur', () => {
    assert.equal(needsJudging(OWN_WEIGHTS, GENERAL, []), false)
    assert.equal(needsJudging(OWN_LABELS, GENERAL, []), true)
    assert.equal(needsJudging(OWN_LABELS, GENERAL, [null, OWN_LABELS]), false)
    const reweighted = { ...OWN_LABELS, criteria: [{ ...OWN_LABELS.criteria[0], weight: 50 }, { ...OWN_LABELS.criteria[1], weight: 50 }] }
    assert.equal(needsJudging(reweighted, GENERAL, [OWN_LABELS]), false)
  })

  it('lignes du barème ou sans score : inchangées', () => {
    const v2 = { source: 'application' as const, id: 'app1', score: 70, reason: 'Poids v2 · Poste : oui — Bon profil.' }
    const none = { ...pool, score: null }
    assert.deepEqual(rescoreOnCriteria([v2, none], ctx({ own: OWN_LABELS })), [v2, none])
  })

  it('scores enregistrés à réécrire après un changement des seuls poids', () => {
    assert.deepEqual(rescoredStored([{ id: 'row1', score: 72, reason: pool.reason }], OWN_WEIGHTS), [{ id: 'row1', score: 60 }])
    assert.deepEqual(rescoredStored([{ id: 'row1', score: 72, reason: pool.reason }], GENERAL), [])
    assert.deepEqual(rescoredStored([{ id: 'row2', score: 50, reason: 'Poids v2 · Poste : non' }], GENERAL), [])
  })
})
