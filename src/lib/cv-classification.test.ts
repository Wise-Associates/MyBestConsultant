import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CLASSIFICATION_LIMITS, CLASSIFICATION_VERSION, classificationSourceKey, parseClassification, seniorityOf } from './cv-classification'

// Réponse fictive du modèle.
const answer = {
  roles: ['Chef de projet', 'PMO', 'chef de projet'],
  famille: 'pilotage_projet',
  annees_experience: 9.4,
  competences: ['Jira', 'MS Project', 'SAFe', 'jira', '  Power   BI '],
  secteurs: ['banque', 'assurance', 'aerospatial', 'banque'],
  clients: ['Banque fictive', 'Assureur fictif'],
  langues: [{ langue: 'anglais', niveau: 'courant' }, { langue: 'Espagnol', niveau: 'B2' }, { niveau: 'natif' }],
  ville: 'Lyon', pays: 'France', tjm: 650, disponibilite: 'Immédiate', niveau_etudes: 'bac+5',
  certifications: ['PMP'],
  resume: 'Chef de projet en banque depuis 9 ans. Joignable au 06 12 34 56 78 ou camille@exemple.fr.',
}

describe('classification d\'un CV (ADR 0044)', () => {
  it('lit la réponse du modèle en champs normalisés', () => {
    const c = parseClassification(`Voici : ${JSON.stringify(answer)}`)
    assert.ok(c)
    assert.equal(c.version, CLASSIFICATION_VERSION)
    assert.deepEqual(c.roles, ['Chef de projet', 'PMO'])
    assert.equal(c.jobFamily, 'pilotage_projet')
    assert.equal(c.yearsOfExperience, 9)
    assert.equal(c.seniority, 'senior')
    assert.deepEqual(c.skills, ['Jira', 'MS Project', 'SAFe', 'Power BI'])
    assert.deepEqual(c.sectors, ['banque', 'assurance'])
    assert.deepEqual(c.languages, [{ name: 'Anglais', level: 'courant' }, { name: 'Espagnol', level: 'non_precise' }])
    assert.deepEqual([c.city, c.country, c.dailyRate, c.availability, c.educationLevel], ['Lyon', 'France', 650, 'Immédiate', 'bac+5'])
    assert.ok(!/06 12|camille@/.test(c.summary), c.summary)
  })

  it('ramène une valeur hors liste ou abîmée à sa valeur neutre, sans rien inventer', () => {
    const c = parseClassification(JSON.stringify({ famille: 'astronaute', annees_experience: 'dix', tjm: -3, niveau_etudes: 'master', competences: 'Java' }))
    assert.ok(c)
    assert.deepEqual([c.jobFamily, c.yearsOfExperience, c.seniority, c.dailyRate, c.educationLevel], ['autre', null, null, null, 'non_precise'])
    assert.deepEqual([c.roles, c.skills, c.sectors, c.languages], [[], [], [], []])
    assert.equal(parseClassification('pas de JSON'), null)
    assert.equal(parseClassification('{abîmé'), null)
  })

  it('borne les listes', () => {
    const c = parseClassification(JSON.stringify({ competences: Array.from({ length: 50 }, (_, i) => `Outil ${i}`), resume: 'x'.repeat(5000) }))
    assert.equal(c?.skills.length, CLASSIFICATION_LIMITS.skills)
    assert.equal(c?.summary.length, CLASSIFICATION_LIMITS.summary)
  })

  it('classe la séniorité d\'après les années, et repère la version d\'un CV', () => {
    assert.deepEqual([0, 2, 3, 7, 8, 14, 15, 30].map(seniorityOf), ['junior', 'junior', 'confirme', 'confirme', 'senior', 'senior', 'expert', 'expert'])
    assert.equal(seniorityOf(null), null)
    assert.equal(classificationSourceKey('fichier123'), 'f:fichier123')
    assert.match(classificationSourceKey(null, 'profil A'), /^p:[0-9a-f]{24}$/)
    assert.notEqual(classificationSourceKey(null, 'profil A'), classificationSourceKey(null, 'profil B'))
  })
})
