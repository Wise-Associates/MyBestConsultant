import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SOURCING_MIN_SCORE, SOURCING_TOP_N, bestMatches } from './sourcing-rules'

describe('candidats retenus par le sourcing', () => {
  it('garde les 5 meilleurs à 65 ou plus, les mieux notés d\'abord', () => {
    const scores = [40, 90, 65, 64, 70, null, 88, 99, 66, 80]
    const kept = bestMatches(scores.map((score, i) => ({ id: String(i), score })))
    assert.equal(SOURCING_TOP_N, 5)
    assert.equal(SOURCING_MIN_SCORE, 65)
    assert.deepEqual(kept.map(k => k.score), [99, 90, 88, 80, 70])
  })

  it('ne garde personne sous le seuil', () => {
    assert.deepEqual(bestMatches([{ score: 64 }, { score: null }, { score: 10 }]), [])
  })
})
