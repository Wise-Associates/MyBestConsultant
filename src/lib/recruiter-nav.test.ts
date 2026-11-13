import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RECRUITER_SECTIONS, recruiterAccountSections, recruiterNavGroups, recruiterSectionOf } from './recruiter-nav'

describe('menu latéral de l\'espace recruteur', () => {
  it('range les rubriques en trois groupes, MBC Search en premier', () => {
    assert.deepEqual(recruiterNavGroups().map(g => [g.label, g.sections.map(s => s.label)]), [
      ['Recherche', ['MBC Search', 'CV Thèque', 'Mon vivier']],
      ['Recrutement', ['Job board', 'Pipelines', 'Appels d’offres', 'Entretiens IA']],
      ['Pilotage', ['Reporting', 'Mon équipe']],
    ])
  })

  it('met utilisateurs, abonnement et organisation en bas du menu', () => {
    assert.deepEqual(recruiterAccountSections().map(s => s.label), ['Organisation', 'Utilisateurs', 'Abonnement'])
    assert.equal(recruiterSectionOf('/recruiter/utilisateurs'), 'utilisateurs')
    assert.equal(recruiterSectionOf('/recruiter/abonnement'), 'abonnement')
    assert.equal(recruiterSectionOf('/recruiter/organisation'), 'organisation')
  })

  it('n\'oublie aucune rubrique : groupes du haut puis bas du menu', () => {
    const shown = [...recruiterNavGroups().flatMap(g => g.sections), ...recruiterAccountSections()].map(s => s.key)
    assert.deepEqual(shown, RECRUITER_SECTIONS.map(s => s.key))
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
