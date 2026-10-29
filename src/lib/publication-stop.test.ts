import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PUBLICATION_STOP_TTL_MS, stopIsActive, stopsDelivery } from './publication-stop'

const NOW = Date.parse('2026-10-29T10:00:00.000Z')

describe('arrêt des tâches automatiques d’une publication', () => {
  it('arrêt en vigueur jusqu’à son expiration, puis plus rien', () => {
    assert.equal(stopIsActive(new Date(NOW + PUBLICATION_STOP_TTL_MS).toISOString(), NOW), true)
    assert.equal(stopIsActive(new Date(NOW - 1).toISOString(), NOW), false)
  })

  it('marqueur absent ou illisible : aucun arrêt', () => {
    assert.equal(stopIsActive(undefined, NOW), false)
    assert.equal(stopIsActive(null, NOW), false)
    assert.equal(stopIsActive('pas une date', NOW), false)
  })

  it('arrête le premier envoi d’une diffusion automatique', () => {
    assert.equal(stopsDelivery({ trigger: 'auto', attempts: 0 }, true), true)
  })

  it('n’arrête ni une relance, ni une diffusion manuelle, ni sans arrêt demandé', () => {
    assert.equal(stopsDelivery({ trigger: 'auto', attempts: 1 }, true), false)
    assert.equal(stopsDelivery({ trigger: 'manual', attempts: 0 }, true), false)
    assert.equal(stopsDelivery({ trigger: 'auto', attempts: 0 }, false), false)
  })
})
