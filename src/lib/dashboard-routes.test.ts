import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { dashboardPathFor } from './dashboard-routes'

describe('tableau de bord d\'arrivée après connexion', () => {
  it('envoie chaque rôle vers son propre espace', () => {
    assert.equal(dashboardPathFor('hunter'), '/hunter/dashboard')
    assert.equal(dashboardPathFor('recruiter'), '/recruiter/mbc-search')
    assert.equal(dashboardPathFor('admin'), '/admin/dashboard')
    assert.equal(dashboardPathFor('candidate'), '/candidate/dashboard')
  })

  it('envoie un rôle absent ou inconnu vers l\'espace candidat', () => {
    assert.equal(dashboardPathFor(null), '/candidate/dashboard')
    assert.equal(dashboardPathFor(undefined), '/candidate/dashboard')
    assert.equal(dashboardPathFor('toString'), '/candidate/dashboard')
  })
})
