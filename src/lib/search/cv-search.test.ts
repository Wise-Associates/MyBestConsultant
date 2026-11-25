import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CLASSIFICATION_BONUS, cleanTitle, offerSearchQueries, poolFilter, preScore, rankHits } from './cv-search'

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

describe('préfiltre avec le classement de l\'offre (ADR 0061)', () => {
  // Titre d'un lot d'appel d'offres, loin du métier demandé : le classement en donne les métiers usuels.
  const tender = {
    title: 'Lot 2. Expert données fiscales', skills: ['SQL', 'Reporting'], location: 'Paris',
    classification: { jobFamily: 'data_ia', sectors: ['secteur_public'], roles: ['Data analyst', 'Expert données fiscales'] },
  }

  it('cherche aussi les métiers du classement et le titre parmi les CV de la même famille', () => {
    const queries = offerSearchQueries(tender, 'f', 'cvs')
    assert.deepEqual(queries.map(q => [q.q, q.filter, q.limit]), [
      ['Lot 2. Expert données fiscales', 'f', 100],
      ['Data analyst', 'f', 50],
      ['Expert données fiscales', 'f', 50],
      ['SQL', 'f', 50],
      ['Reporting', 'f', 50],
      ['Lot 2. Expert données fiscales', 'f AND jobFamily = "data_ia"', 100],
    ])
    assert.ok(queries.every(q => q.attributesToRetrieve.includes('sectors')))
  })

  it('n\'ajoute au filtre qu\'une famille de la liste fermée, jamais « autre »', () => {
    const injected = offerSearchQueries({ ...tender, classification: { ...tender.classification, jobFamily: 'x" OR kind = "vivier' } }, 'f', 'cvs')
    const other = offerSearchQueries({ ...tender, classification: { ...tender.classification, jobFamily: 'autre' } }, 'f', 'cvs')
    for (const queries of [injected, other]) assert.ok(queries.every(q => q.filter === 'f'), JSON.stringify(queries))
  })

  it('sans classement, mêmes requêtes et même pré-score qu\'avant', () => {
    const { classification, ...plain } = tender
    assert.ok(classification)
    assert.deepEqual(offerSearchQueries(plain, 'f', 'cvs').map(q => q.q), ['Lot 2. Expert données fiscales', 'SQL', 'Reporting'])
    const cv = { id: 'c1', sourceId: 'u1', roles: ['Data analyst'], skills: ['SQL'], city: 'Paris', jobFamily: 'data_ia', sectors: ['secteur_public'] }
    assert.equal(preScore(plain, cv), 0.45 * 0 + 0.45 * 0.5 + 0.1 * 1)
  })

  it('reconnaît le métier par le classement et ajoute le bonus de la famille et d\'un secteur commun', () => {
    const analyst = { id: 'c1', sourceId: 'u1', roles: ['Data analyst'], skills: ['SQL'], city: 'Paris', jobFamily: 'data_ia', sectors: ['secteur_public', 'banque'] }
    assert.equal(preScore(tender, analyst), 0.45 * 1 + 0.45 * 0.5 + 0.1 * 1 + CLASSIFICATION_BONUS.family + CLASSIFICATION_BONUS.sector)
    // Même métier et mêmes compétences, autre famille et autre secteur : classé après.
    const elsewhere = { ...analyst, sourceId: 'u2', jobFamily: 'developpement', sectors: ['industrie'] }
    assert.equal(preScore(tender, elsewhere), 0.45 * 1 + 0.45 * 0.5 + 0.1 * 1)
    assert.deepEqual(rankHits(tender, [[elsewhere, analyst]], 2), ['u1', 'u2'])
    // Famille « autre » : pas de bonus, elle ne départage rien.
    const vague = { ...tender, classification: { ...tender.classification, jobFamily: 'autre' } }
    assert.equal(preScore(vague, { ...analyst, jobFamily: 'autre', sectors: [] }), 0.45 * 1 + 0.45 * 0.5 + 0.1 * 1)
  })
})
