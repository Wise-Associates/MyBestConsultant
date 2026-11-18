import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cleanTitle, offerSearchQueries, poolFilter, preScore, rankHits } from './cv-search'

// Offre et CV fictifs.
const offer = { title: 'Chef de projet PMO (H/F) – Paris', skills: ['Jira', 'MS Project', 'SAFe', 'Power BI'], location: 'Paris' }

describe('préfiltre des CV avant l\'IA (ADR 0044, phase 2)', () => {
  it('nettoie le titre d\'une offre et en tire une requête par compétence', () => {
    assert.equal(cleanTitle('Chef de projet PMO (H/F) – Paris'), 'Chef de projet PMO')
    assert.equal(cleanTitle('Développeur Java F/H - CDI'), 'Développeur Java')
    const queries = offerSearchQueries({ ...offer, skills: [...offer.skills, 'Jira', ...Array.from({ length: 20 }, (_, i) => `Outil ${i}`)] }, 'f', 'cvs')
    assert.equal(queries[0].q, 'Chef de projet PMO')
    assert.equal(queries[0].limit, 100)
    assert.equal(queries.length, 13) // le titre et 12 compétences, sans doublon
    assert.ok(queries.every(q => q.indexUid === 'cvs' && q.filter === 'f' && !q.attributesToRetrieve.includes('summary')))
  })

  it('filtre la base candidats et n\'accepte que des identifiants Appwrite', () => {
    assert.equal(poolFilter([]), 'kind = "candidate" AND role = "candidate" AND optedOut = false')
    assert.equal(poolFilter(['abc123', 'x"] OR kind = "vivier', 'def-456']),
      'kind = "candidate" AND role = "candidate" AND optedOut = false AND sourceId NOT IN ["abc123", "def-456"]')
  })

  it('classe d\'abord le métier et les compétences de l\'offre', () => {
    const pmo = { id: 'c1', sourceId: 'u1', roles: ['Chef de projet', 'PMO'], skills: ['JIRA', 'MS Project', 'SAFe 6'], city: 'Paris' }
    const po = { id: 'c2', sourceId: 'u2', roles: ['Product Owner'], skills: ['Jira', 'Scrum'], city: 'Paris' }
    const dev = { id: 'c3', sourceId: 'u3', roles: ['Développeur Java'], skills: ['Java'], city: 'Lyon' }
    assert.ok(preScore(offer, pmo) > preScore(offer, po))
    assert.ok(preScore(offer, po) > preScore(offer, dev))
    assert.equal(preScore(offer, { id: 'c4', sourceId: 'u4' }), 0.45 * 0 + 0.45 * 0 + 0.1 * 0.5)
    // Un CV présent dans plusieurs requêtes ne compte qu'une fois ; `keep` borne la liste.
    assert.deepEqual(rankHits(offer, [[dev, pmo], [po, pmo]], 2), ['u1', 'u2'])
  })

  it('reste neutre sur ce que l\'offre ne précise pas', () => {
    const cv = { id: 'c1', sourceId: 'u1', roles: ['Chef de projet'], skills: [], city: 'Lille' }
    assert.equal(preScore({ title: '', skills: [] }, cv), 0.45 * 0.5 + 0.45 * 0.5 + 0.1 * 0.5)
  })
})
