import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { planPoolRows, poolRowId } from './pool-matching'

const row = (id: string, candidateId: string) => ({ id, candidateId })
const score = (candidateId: string, value = 70) => ({ candidateId, score: value, reason: 'Raison fictive' })

describe('notes de la base candidats d\'une offre (job_matches)', () => {
  it('met à jour la note d\'un candidat déjà noté, crée celle d\'un nouveau', () => {
    const plan = planPoolRows([row('r1', 'c1')], [score('c1', 80), score('c2')], new Set(), new Set(['c1', 'c2']))
    assert.deepEqual(plan.update, [['r1', score('c1', 80)]])
    assert.deepEqual(plan.create, [score('c2')])
    assert.deepEqual(plan.remove, [])
  })

  it('« Rafraîchir » ne retire aucune note (rien dans son périmètre)', () => {
    const plan = planPoolRows([row('r1', 'c1'), row('r2', 'c2')], [score('c3')], new Set(), new Set(['c3']))
    assert.deepEqual(plan.remove, [])
  })

  it('le recalcul des candidats déjà notés garde la note d\'un candidat dont le nouveau calcul a échoué', () => {
    // c1 noté de nouveau, c2 en échec (IA indisponible) : sa note d'avant reste.
    const plan = planPoolRows([row('r1', 'c1'), row('r2', 'c2')], [score('c1')], new Set(['c1', 'c2']), new Set(['c1', 'c2']))
    assert.deepEqual(plan.remove, [])
    assert.deepEqual(plan.update.map(([id]) => id), ['r1'])
  })

  it('le recalcul des candidats déjà notés retire seulement les candidats qui ne sont plus à noter (désinscrits, CV retiré, candidature envoyée)', () => {
    const plan = planPoolRows([row('r1', 'c1'), row('r2', 'c2'), row('r3', 'c9')], [score('c1')], new Set(['c1', 'c2']), new Set(['c1']))
    assert.deepEqual(plan.remove, ['r2'], 'c9, hors du périmètre de ce passage, garde sa note')
  })

  it('supprime les doublons d\'un même candidat (deux passages simultanés avant les identifiants fixes)', () => {
    const plan = planPoolRows([row('r1', 'c1'), row('r1bis', 'c1')], [score('c1')], new Set(), new Set(['c1']))
    assert.deepEqual(plan.remove, ['r1bis'])
    assert.deepEqual(plan.update.map(([id]) => id), ['r1'])
  })

  it('identifiant fixe par offre et candidat : deux passages simultanés écrivent la même ligne', () => {
    assert.equal(poolRowId('ao6ae0953500168aad7a8a', 'cand1'), poolRowId('ao6ae0953500168aad7a8a', 'cand1'))
    assert.notEqual(poolRowId('ao6ae0953500168aad7a8a', 'cand1'), poolRowId('ao6ae0953500168aad7a8b', 'cand1'))
    assert.match(poolRowId('ao6ae0953500168aad7a8a', 'cand1'), /^p[0-9a-f]{32}$/)
  })
})
