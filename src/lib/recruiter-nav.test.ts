import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RECRUITER_SECTIONS, isWideRecruiterPage, recruiterSectionOf } from './recruiter-nav'

describe('sous-menu de l\'espace recruteur', () => {
  it('garde les rubriques dans l\'ordre demandé', () => {
    assert.deepEqual(RECRUITER_SECTIONS.map(s => s.label), [
      'Tableau de bord', 'Pipelines', 'Appels d’offres', 'Reporting', 'Mon vivier', 'CV Thèque', 'MBC Search', 'Mon équipe', 'Entretiens IA',
    ])
  })

  it('met en surbrillance la rubrique de la page et de ses sous-pages', () => {
    assert.equal(recruiterSectionOf('/recruiter/dashboard'), 'dashboard')
    assert.equal(recruiterSectionOf('/recruiter/parametres/boites-ao/abc123'), 'ao')
    assert.equal(recruiterSectionOf('/recruiter/vivier/job42'), 'vivier')
    assert.equal(recruiterSectionOf('/recruiter/interviews/new'), 'interviews')
    assert.equal(recruiterSectionOf('/recruiter/reporting/'), 'reporting')
    assert.equal(recruiterSectionOf('/recruiter/funnel'), 'funnel')
    assert.equal(recruiterSectionOf('/recruiter/mbc-search'), 'mbcsearch')
  })

  it('range les pages sans rubrique propre sous la rubrique d\'où elles partent', () => {
    assert.equal(recruiterSectionOf('/recruiter/pipeline/job42'), 'dashboard')
    assert.equal(recruiterSectionOf('/recruiter/candidates/app7'), 'dashboard')
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

describe('pages en pleine largeur à partir de 1440 px (le sous-menu s\'aligne sur elles)', () => {
  it('tableau de bord, pipeline et Matching IA d\'une offre', () => {
    assert.equal(isWideRecruiterPage('/recruiter/dashboard'), true)
    assert.equal(isWideRecruiterPage('/recruiter/pipeline/ao123'), true)
    assert.equal(isWideRecruiterPage('/recruiter/pipeline/ao123/matching'), true)
  })

  it('les autres pages gardent leur largeur', () => {
    for (const path of ['/recruiter/vivier', '/recruiter/pipeline', '/recruiter/dashboardx', '/recruiter/funnel', '/recruiter/candidates/a1']) {
      assert.equal(isWideRecruiterPage(path), false, path)
    }
  })
})
