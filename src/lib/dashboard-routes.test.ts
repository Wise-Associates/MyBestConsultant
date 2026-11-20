import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { afterAuthPath, dashboardPathFor, offerReturnPath } from './dashboard-routes'

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

describe('retour à l\'offre après connexion ou inscription', () => {
  it('ramène sur la page de l\'offre d\'où vient le candidat', () => {
    assert.equal(afterAuthPath('candidate', '/jobs/6b000c5a000be9fde91f'), '/jobs/6b000c5a000be9fde91f')
    assert.equal(afterAuthPath('hunter', '/jobs/ao123'), '/jobs/ao123')
  })

  it('va au tableau de bord sans adresse de retour, ou pour une autre page', () => {
    assert.equal(afterAuthPath('candidate', null), '/candidate/dashboard')
    assert.equal(afterAuthPath('candidate', ''), '/candidate/dashboard')
    assert.equal(afterAuthPath('recruiter', '/recruiter/dashboard'), '/recruiter/mbc-search')
    assert.equal(afterAuthPath('candidate', '/jobs'), '/candidate/dashboard')
  })

  it('refuse toute adresse qui sortirait du site ou d\'une page d\'offre', () => {
    for (const raw of ['//exemple.test/jobs/abc', 'https://exemple.test/jobs/abc', '/\exemple.test', '/jobs/abc/../../admin',
      '/jobs/abc?x=1', '/jobs/abc#x', '/jobs/', '/jobs/' + 'a'.repeat(37), ['/jobs/abc']]) {
      assert.equal(offerReturnPath(raw), null, String(raw))
    }
  })
})
