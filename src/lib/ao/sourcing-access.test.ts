import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AO_SOURCING_DAILY_LIMITS, SOURCING_QUOTA_MESSAGE, sourcingDenial } from './sourcing-access'

describe('« Trouver des candidats » depuis un appel d\'offres, côté recruteur', () => {
  const allowed = { tenantId: 'tenant-acme', subscriptionStatus: 'active', emailVerified: true }

  it('est permis à une organisation abonnée, essai compris, à l\'adresse vérifiée', () => {
    assert.equal(sourcingDenial(allowed), null)
    assert.equal(sourcingDenial({ ...allowed, subscriptionStatus: 'trialing' }), null)
  })

  it('est refusé sans abonnement actif ou sans adresse vérifiée, avec un message pour le recruteur', () => {
    for (const status of ['canceled', 'past_due', '', null, undefined]) {
      assert.match(sourcingDenial({ ...allowed, subscriptionStatus: status }) ?? '', /abonnement/, String(status))
    }
    assert.match(sourcingDenial({ ...allowed, emailVerified: false }) ?? '', /adresse e-mail/)
  })

  it('annonce les plafonds du jour dans ses messages', () => {
    assert.ok(AO_SOURCING_DAILY_LIMITS.perOrganisation < AO_SOURCING_DAILY_LIMITS.allOrganisations)
    assert.match(SOURCING_QUOTA_MESSAGE.organisation, new RegExp(`${AO_SOURCING_DAILY_LIMITS.perOrganisation} recherches`))
    assert.match(SOURCING_QUOTA_MESSAGE.platform, /demain/)
  })
})
