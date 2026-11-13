import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { subscriptionView } from './subscription-view'

describe('abonnement affiché à l\'organisation', () => {
  it('lit une formule payée par carte', () => {
    assert.deepEqual(subscriptionView({ plan: 'pro', subscriptionStatus: 'active', subscriptionAmount: 199, subscriptionPeriod: 'monthly', stripeCustomerId: 'cus_demo' }), {
      planLabel: 'Pro', statusLabel: 'Actif', tone: 'ok', entitled: true, amountText: '199 € / mois', billedByStripe: true,
    })
  })

  it('lit une formule de l\'admin, annuelle, sans Stripe', () => {
    const v = subscriptionView({ plan: 'gold', subscriptionStatus: 'trialing', subscriptionAmount: 1200, subscriptionPeriod: 'annual' })
    assert.equal(v.planLabel, 'Gold')
    assert.equal(v.entitled, true)
    // Séparateur des milliers français : espace fine insécable (U+202F), comme l'affiche le navigateur.
    assert.equal(v.amountText, '1\u202f200 € / an')
    assert.equal(v.billedByStripe, false)
  })

  it('ne compte pas comme payé par carte un client Stripe qui n\'a jamais payé, ni une formule de l\'admin', () => {
    assert.equal(subscriptionView({ stripeCustomerId: 'cus_demo' }).billedByStripe, false)
    assert.equal(subscriptionView({ stripeCustomerId: 'cus_demo', plan: 'gold', subscriptionStatus: 'active' }).billedByStripe, false)
    assert.equal(subscriptionView({ stripeCustomerId: 'cus_demo', plan: 'essentiel', subscriptionStatus: 'cancelled' }).billedByStripe, true)
  })

  it('ferme les fonctions réservées hors abonnement actif ou en essai', () => {
    for (const status of ['past_due', 'suspended', 'cancelled', 'refunded', '']) {
      assert.equal(subscriptionView({ subscriptionStatus: status }).entitled, false, status)
    }
    assert.equal(subscriptionView({ subscriptionStatus: 'past_due' }).tone, 'warn')
  })

  it('montre un abonnement absent sans inventer de montant', () => {
    assert.deepEqual(subscriptionView({}), {
      planLabel: 'Aucune formule', statusLabel: 'Aucun abonnement', tone: 'muted', entitled: false, amountText: null, billedByStripe: false,
    })
  })
})
