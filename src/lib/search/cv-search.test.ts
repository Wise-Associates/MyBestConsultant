import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cleanTitle, poolFilter, preScore } from './cv-search'

// Offre et CV fictifs.
const offer = { title: 'Chef de projet PMO (H/F) – Paris', skills: ['Jira', 'MS Project', 'SAFe', 'Power BI'], location: 'Paris' }

describe('préfiltre des CV avant l\'IA (ADR 0044, phase 2)', () => {
  it('nettoie le titre d\'une offre (recherches : offer-filter.test.ts)', () => {
    assert.equal(cleanTitle('Chef de projet PMO (H/F) – Paris'), 'Chef de projet PMO')
    assert.equal(cleanTitle('Développeur Java F/H - CDI'), 'Développeur Java')
    assert.equal(cleanTitle('Consultant(e) Cybersécurité (H/F)'), 'Consultant Cybersécurité')
    assert.equal(cleanTitle('Développeur·se Full Stack · Lyon'), 'Développeur Full Stack · Lyon')
    assert.equal(cleanTitle('Chef(fe) de projet'), 'Chef de projet')
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
  })

  it('reste neutre sur ce que l\'offre ne précise pas', () => {
    const cv = { id: 'c1', sourceId: 'u1', roles: ['Chef de projet'], skills: [], city: 'Lille' }
    assert.equal(preScore({ title: '', skills: [] }, cv), 0.45 * 0.5 + 0.45 * 0.5 + 0.1 * 0.5)
  })
})
