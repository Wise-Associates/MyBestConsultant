import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RECRUITER_SECTIONS, recruiterNavGroups, recruiterSectionOf } from './recruiter-nav'

describe('menu latéral de l\'espace recruteur', () => {
  it('range les rubriques en trois groupes, MBC Search en premier', () => {
    assert.deepEqual(recruiterNavGroups().map(g => [g.label, g.sections.map(s => s.label)]), [
      ['Recherche', ['MBC Search', 'CV Thèque', 'Mon vivier']],
      ['Recrutement', ['Tableau de bord', 'Pipelines', 'Appels d’offres', 'Entretiens IA']],
      ['Pilotage', ['Reporting', 'Mon équipe']],
    ])
  })

  it('n\'oublie aucune rubrique dans les groupes', () => {
    const grouped = recruiterNavGroups().flatMap(g => g.sections.map(s => s.key))
    assert.deepEqual(grouped, RECRUITER_SECTIONS.map(s => s.key))
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
