import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SOURCING_MAX_CHARS, sourcingJson } from './sourcing-json'

// Sourcing fictif.
const record = (count: number, reasonLength: number) => ({
  at: '2026-11-24T10:00:00.000Z', scanned: 30,
  candidates: Array.from({ length: count }, (_, i) => ({ candidateId: `cand${i}`, score: 90 - i, reason: 'é'.repeat(reasonLength) })),
})

describe('JSON du sourcing d’un AO', () => {
  it('tel quel quand il tient', () => {
    const r = record(5, 100)
    assert.equal(sourcingJson(r), JSON.stringify(r))
  })

  it('trop long : raisons raccourcies, JSON toujours lisible et dans la limite (avant : coupé au milieu)', () => {
    const text = sourcingJson(record(5, 1200))
    assert.ok(text.length <= SOURCING_MAX_CHARS)
    const parsed = JSON.parse(text)
    assert.equal(parsed.candidates.length, 5)
    assert.equal(parsed.candidates[0].reason.length, 600)
    assert.equal(parsed.candidates[4].score, 86)
  })

  it('même sans raison trop long : les derniers candidats retirés', () => {
    const text = sourcingJson(record(400, 50), 2000)
    assert.ok(text.length <= 2000)
    const parsed = JSON.parse(text)
    assert.ok(parsed.candidates.length > 0 && parsed.candidates.length < 400)
    assert.equal(parsed.candidates[0].candidateId, 'cand0')
  })
})
