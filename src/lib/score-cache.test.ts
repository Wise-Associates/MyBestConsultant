import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  SCORE_CACHE_MAX_CHARS, SCORE_CACHE_TTL_DAYS, isFreshScore, parseCachedCriteriaScore, parseCachedScore, scoreCacheCutoff, scoreCacheId,
  serializeCachedScore, type CachedCriteriaScore, type CachedScore,
} from './score-cache'

// Notation fictive.
const entry: CachedScore = {
  score: 72,
  reason: 'Poste : Chef de projet oui · Techno : 3 sur 4 — Expérience bancaire solide.',
  judgements: {
    scale: 'matching', roles: [{ title: 'Chef de projet', fit: 'oui' }], requirements: ['oui', 'partiel'], requirementsListed: true,
    skills: ['oui', 'oui', 'oui', 'non'], skillsListed: true, fits: { localisation: 'oui', tjm: 'non précisé' },
  },
  notes: { reason: 'Peu de SAFe.', summary: 'Profil de chef de projet bancaire.', strengths: ['Banque'], concerns: [], namedSkills: [] },
  provider: 'claude',
  answer: { poste: [{ intitule: 'Chef de projet' }] },
}
const input = { model: 'claude:claude-sonnet-4-6', scale: 'matching' as const, system: 'Consignes fictives', user: '=== OFFRE ===\nPoste : PMO\n\n=== CV DU CANDIDAT ===\nCV fictif' }

describe('cache des notations (ADR 0044)', () => {
  it('donne le même identifiant pour la même notation, un autre dès qu\'un élément change', () => {
    const id = scoreCacheId(input)
    assert.match(id, /^sc[0-9a-f]{34}$/)
    assert.equal(scoreCacheId({ ...input }), id)
    for (const changed of [
      { ...input, model: 'claude:claude-opus-5-5' }, { ...input, scale: 'final' as const },
      { ...input, system: 'Consignes fictives modifiées' }, { ...input, user: `${input.user}.` },
    ]) assert.notEqual(scoreCacheId(changed), id)
  })

  it('relit une notation gardée pour son barème seulement', () => {
    const text = serializeCachedScore(entry)
    assert.ok(text)
    assert.deepEqual(parseCachedScore(text, 'matching'), entry)
    assert.equal(parseCachedScore(text, 'final'), null)
  })

  it('notation sur les critères d’une offre (ADR 0061) : relue pour la même empreinte de libellés seulement', () => {
    const criteria: CachedCriteriaScore = {
      ...entry, reason: 'Critères v1#0a1b2c3d · o · op — Expérience bancaire solide.',
      judgements: {
        fingerprint: '0a1b2c3d', roles: [{ title: 'Chef de projet', fit: 'oui', cited: 'Chef de projet senior' }],
        criteria: [{ id: 'poste', values: ['oui'] }, { id: 'competences', values: ['oui', 'partiel'] }],
      },
    }
    const text = serializeCachedScore(criteria)
    assert.deepEqual(parseCachedCriteriaScore(text, '0a1b2c3d'), criteria)
    assert.equal(parseCachedCriteriaScore(text, 'ffffffff'), null)
    // Jamais confondue avec une notation du barème, ni l'inverse.
    assert.equal(parseCachedScore(text, 'matching'), null)
    assert.equal(parseCachedCriteriaScore(serializeCachedScore(entry), '0a1b2c3d'), null)
  })

  it('traite comme absente une valeur abîmée, incomplète ou trop longue', () => {
    for (const raw of [undefined, '', '{abîmé', JSON.stringify({ ...entry, score: 140 }), JSON.stringify({ ...entry, notes: undefined }),
      JSON.stringify({ ...entry, judgements: { ...entry.judgements, skills: ['peut-être'] } })]) {
      assert.equal(parseCachedScore(raw, 'matching'), null, String(raw).slice(0, 40))
    }
    assert.equal(serializeCachedScore({ ...entry, answer: 'x'.repeat(SCORE_CACHE_MAX_CHARS) }), null)
  })

  it(`ne garde une notation que ${SCORE_CACHE_TTL_DAYS} jours`, () => {
    const now = new Date('2026-11-18T12:00:00.000Z')
    assert.ok(isFreshScore('2026-11-01T12:00:00.000Z', now))
    assert.ok(!isFreshScore('2026-10-19T11:59:59.000Z', now))
    assert.ok(!isFreshScore('pas une date', now))
    assert.equal(scoreCacheCutoff(now), '2026-10-19T12:00:00.000Z')
  })
})
