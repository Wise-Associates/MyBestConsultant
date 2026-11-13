import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PAID_PLAN_CARDS, PLAN_CARDS, checkoutLabel } from './plan-catalog'
import { PLAN_PRICE_CENTS } from './plans'

describe('formules présentées', () => {
  it('affiche les prix que Stripe facture', () => {
    for (const card of PAID_PLAN_CARDS) assert.equal(card.priceLabel, `${PLAN_PRICE_CENTS[card.id] / 100} €`)
    assert.equal(checkoutLabel('pro'), 'Pro — 199 €/mois')
  })

  it('présente l\'essai puis les formules payées', () => {
    assert.deepEqual(PLAN_CARDS.map(c => c.id), ['essai', 'essentiel', 'pro'])
    assert.deepEqual(PAID_PLAN_CARDS.map(c => c.id), ['essentiel', 'pro'])
  })
})
