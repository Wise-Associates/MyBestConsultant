import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RECRUITER_SECTIONS, recruiterSectionOf } from './recruiter-nav'

describe('sous-menu de l\'espace recruteur', () => {
  it('garde les rubriques dans l\'ordre demandé', () => {
    assert.deepEqual(RECRUITER_SECTIONS.map(s => s.label), [
      'Tableau de bord', 'Appels d’offres', 'Reporting', 'Mon vivier', 'CV Thèque', 'Mon équipe', 'Entretiens IA',
    ])
  })

  it('met en surbrillance la rubrique de la page et de ses sous-pages', () => {
    assert.equal(recruiterSectionOf('/recruiter/dashboard'), 'dashboard')
    assert.equal(recruiterSectionOf('/recruiter/parametres/boites-ao/abc123'), 'ao')
    assert.equal(recruiterSectionOf('/recruiter/vivier/job42'), 'vivier')
    assert.equal(recruiterSectionOf('/recruiter/interviews/new'), 'interviews')
    assert.equal(recruiterSectionOf('/recruiter/reporting/'), 'reporting')
  })

  it('range les pages sans rubrique propre sous la rubrique d\'où elles partent', () => {
    assert.equal(recruiterSectionOf('/recruiter/pipeline/job42'), 'dashboard')
    assert.equal(recruiterSectionOf('/recruiter/candidates/app7'), 'dashboard')
    assert.equal(recruiterSectionOf('/recruiter/funnel'), 'dashboard')
    assert.equal(recruiterSectionOf('/recruiter/annonces'), 'dashboard')
    assert.equal(recruiterSectionOf('/recruiter/screening/best'), 'interviews')
    assert.equal(recruiterSectionOf('/recruiter/marque-employeur'), 'equipe')
  })

  it('ne confond pas une rubrique avec une adresse qui commence pareil, et laisse les autres pages sans rubrique', () => {
    assert.equal(recruiterSectionOf('/recruiter/viviers'), null)
    assert.equal(recruiterSectionOf('/recruiter/support'), null)
    assert.equal(recruiterSectionOf('/recruiter/parametres'), null)
  })
})
