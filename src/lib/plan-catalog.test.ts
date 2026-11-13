import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { COMPARISON_COLUMNS, COMPARISON_ROWS, PAID_PLAN_CARDS, PLAN_CARDS, PRICING_FAQ, checkoutLabel } from './plan-catalog'
import { PLAN_PRICE_CENTS } from './plans'

describe('formules présentées', () => {
  it('affiche les prix que Stripe facture', () => {
    for (const card of PAID_PLAN_CARDS) assert.equal(card.priceLabel, `${PLAN_PRICE_CENTS[card.id] / 100} €`)
    assert.equal(checkoutLabel('pro'), 'Pro — 199 €/mois')
    assert.equal(COMPARISON_COLUMNS[1].sub, `${PLAN_PRICE_CENTS.essentiel / 100} € / mois`)
  })

  it('présente l\'essai puis les formules payées', () => {
    assert.deepEqual(PLAN_CARDS.map(c => c.id), ['essai', 'essentiel', 'pro'])
    assert.deepEqual(PAID_PLAN_CARDS.map(c => c.id), ['essentiel', 'pro'])
  })

  it('remplit chaque case du tableau de comparaison, sans texte à compléter', () => {
    for (const row of COMPARISON_ROWS) {
      assert.equal(row.cells.length, COMPARISON_COLUMNS.length, row.label)
      for (const cell of row.cells) if (typeof cell === 'string') assert.doesNotMatch(cell, /\[|à confirmer/i, row.label)
    }
    for (const { answer } of PRICING_FAQ) assert.doesNotMatch(answer, /\[|à rédiger/i)
  })
})
