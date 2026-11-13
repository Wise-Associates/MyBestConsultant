import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { checkoutStep, isAdminHold, tenantPatchFor, type SubscriptionSnapshot } from './billing'

const NOW = new Date('2026-11-13T10:00:00.000Z')
const sub = (patch: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot => ({
  id: 'sub_new', status: 'active', planId: 'pro', interval: 'month', unitAmountCents: 19900, ...patch,
})

describe('choix d\'une formule payante', () => {
  it('crée un abonnement quand aucun n\'est en cours', () => {
    assert.deepEqual(checkoutStep(null, 'essentiel'), { step: 'create' })
    assert.deepEqual(checkoutStep({ status: 'canceled', planId: 'pro' }, 'pro'), { step: 'create' })
    assert.deepEqual(checkoutStep({ status: 'incomplete_expired', planId: 'pro' }, 'pro'), { step: 'create' })
  })

  it('remplace un abonnement jamais payé au lieu d\'en ouvrir un second', () => {
    assert.deepEqual(checkoutStep({ status: 'incomplete', planId: 'pro' }, 'essentiel'), { step: 'replace' })
  })

  it('change la formule de l\'abonnement en cours au lieu de facturer deux abonnements', () => {
    assert.deepEqual(checkoutStep({ status: 'active', planId: 'essentiel' }, 'pro'), { step: 'update' })
    assert.deepEqual(checkoutStep({ status: 'trialing', planId: 'essentiel' }, 'pro'), { step: 'update' })
  })

  it('refuse la formule déjà en cours, un paiement en retard et un état inconnu', () => {
    assert.match((checkoutStep({ status: 'active', planId: 'pro' }, 'pro') as { error: string }).error, /déjà la formule Pro/)
    for (const status of ['past_due', 'unpaid', 'paused']) {
      assert.match((checkoutStep({ status, planId: 'essentiel' }, 'pro') as { error: string }).error, /Factures et moyen de paiement/)
    }
    assert.ok('error' in checkoutStep({ status: 'bizarre', planId: 'pro' }, 'pro'))
  })
})

describe('évènements Stripe appliqués à l\'organisation', () => {
  const tenant = { stripeSubscriptionId: 'sub_new', subscriptionStartedAt: null, subscriptionStatus: 'active' }
  const none = { stripeSubscriptionId: null, subscriptionStartedAt: null, subscriptionStatus: 'active' }

  it('ignore les évènements d\'un autre abonnement que celui de l\'organisation (ancien, remplacé)', () => {
    for (const event of ['payment_succeeded', 'payment_failed', 'invoice_overdue', 'subscription_deleted', 'subscription_updated'] as const) {
      assert.equal(tenantPatchFor(event, sub({ id: 'sub_old' }), tenant, NOW), null)
    }
  })

  it('active la formule payée sans effacer la date de début', () => {
    assert.deepEqual(tenantPatchFor('payment_succeeded', sub(), tenant, NOW), {
      plan: 'pro', subscriptionStatus: 'active', subscriptionPeriod: 'monthly', subscriptionAmount: 199, subscriptionStartedAt: NOW.toISOString(),
    })
    const started = tenantPatchFor('payment_succeeded', sub({ interval: 'year', unitAmountCents: 240000 }), { ...tenant, subscriptionStartedAt: '2026-01-02T00:00:00.000Z' }, NOW)
    assert.equal(started?.subscriptionStartedAt, undefined)
    assert.equal(started?.subscriptionPeriod, 'annual')
    assert.equal(started?.subscriptionAmount, 2400)
    assert.equal('plan' in (tenantPatchFor('payment_succeeded', sub({ planId: null }), tenant, NOW) ?? {}), false)
  })

  it('rattache un abonnement payé à l\'organisation qui n\'en avait pas encore d\'enregistré', () => {
    assert.equal(tenantPatchFor('payment_succeeded', sub(), none, NOW)?.stripeSubscriptionId, 'sub_new')
    // Un refus ou une résiliation ne rattache jamais un abonnement inconnu.
    assert.equal(tenantPatchFor('subscription_deleted', sub({ status: 'canceled' }), none, NOW), null)
  })

  it('adopte un abonnement payé quand celui enregistré n\'est plus en cours, jamais à côté d\'un abonnement en cours', () => {
    const paidOther = sub({ id: 'sub_paid' })
    assert.equal(tenantPatchFor('payment_succeeded', paidOther, tenant, NOW, { invoicePaid: true, recordedOpen: false })?.stripeSubscriptionId, 'sub_paid')
    assert.equal(tenantPatchFor('payment_succeeded', paidOther, tenant, NOW, { invoicePaid: true, recordedOpen: true }), null)
    assert.equal(tenantPatchFor('payment_succeeded', paidOther, tenant, NOW), null)
    assert.equal(tenantPatchFor('payment_succeeded', sub({ id: 'sub_paid', status: 'canceled' }), tenant, NOW, { invoicePaid: true, recordedOpen: false }), null)
  })

  it('ignore un « paiement échoué » traité après le paiement de la facture', () => {
    assert.equal(tenantPatchFor('payment_failed', sub(), tenant, NOW, { invoicePaid: true, recordedOpen: null }), null)
    assert.equal(tenantPatchFor('invoice_overdue', sub(), tenant, NOW, { invoicePaid: true, recordedOpen: null }), null)
  })

  it('ne remplace jamais un état posé par l\'admin (suspendu, remboursé)', () => {
    assert.ok(isAdminHold('suspended') && isAdminHold('refunded') && !isAdminHold('active'))
    const suspended = { ...tenant, subscriptionStatus: 'suspended' }
    assert.deepEqual(tenantPatchFor('subscription_updated', sub(), suspended, NOW), { plan: 'pro', subscriptionPeriod: 'monthly', subscriptionAmount: 199 })
    assert.equal(tenantPatchFor('payment_succeeded', sub(), suspended, NOW)?.subscriptionStatus, undefined)
    assert.equal(tenantPatchFor('payment_failed', sub({ status: 'past_due' }), suspended, NOW), null)
    assert.equal(tenantPatchFor('subscription_deleted', sub({ status: 'canceled' }), suspended, NOW), null)
  })

  it('ne coupe pas l\'accès pour un premier paiement refusé ou un paiement abandonné', () => {
    assert.equal(tenantPatchFor('payment_failed', sub({ status: 'incomplete' }), tenant, NOW), null)
    assert.deepEqual(tenantPatchFor('subscription_deleted', sub({ status: 'incomplete_expired' }), tenant, NOW), { stripeSubscriptionId: null })
  })

  it('passe en retard de paiement, puis résilié', () => {
    assert.deepEqual(tenantPatchFor('payment_failed', sub({ status: 'past_due' }), tenant, NOW), { subscriptionStatus: 'past_due' })
    assert.deepEqual(tenantPatchFor('invoice_overdue', sub(), tenant, NOW), { subscriptionStatus: 'past_due' })
    assert.deepEqual(tenantPatchFor('subscription_deleted', sub({ status: 'canceled' }), tenant, NOW), { subscriptionStatus: 'cancelled' })
  })

  it('ne rouvre pas un abonnement résilié quand un « paiement réussi » arrive en retard ou est rejoué', () => {
    for (const status of ['canceled', 'incomplete_expired', 'incomplete', 'past_due', 'unpaid']) {
      assert.equal(tenantPatchFor('payment_succeeded', sub({ status }), tenant, NOW), null, status)
    }
  })

  it('reprend un changement de formule et l\'état en cours', () => {
    assert.deepEqual(tenantPatchFor('subscription_updated', sub({ planId: 'essentiel', unitAmountCents: 9900 }), tenant, NOW), {
      plan: 'essentiel', subscriptionPeriod: 'monthly', subscriptionAmount: 99, subscriptionStatus: 'active',
    })
    assert.equal(tenantPatchFor('subscription_updated', sub({ status: 'incomplete' }), tenant, NOW), null)
    assert.equal(tenantPatchFor('subscription_updated', sub({ status: 'canceled' }), tenant, NOW), null)
  })
})
