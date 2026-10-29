import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PUBLICATION_STOP_TTL_MS, STOPPED_DIFFUSION_ERROR, diffusionStopOutcome, isStoppedDiffusion, stopIsActive, stopsDelivery } from './publication-stop'

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

  it('dernière diffusion : arrêtée si automatique et pas encore remise à Make ; une relance ou une diffusion manuelle continue', () => {
    assert.equal(diffusionStopOutcome({ status: 'queued', trigger: 'auto', attempts: 0 }), 'stopped')
    assert.equal(diffusionStopOutcome({ status: 'queued', trigger: 'auto', attempts: 1 }), 'running')
    assert.equal(diffusionStopOutcome({ status: 'queued', trigger: 'manual', attempts: 0 }), 'running')
  })

  it('dernière diffusion déjà remise à Make, terminée en échec, ou absente', () => {
    for (const status of ['sent', 'images_ready', 'published', 'partial']) assert.equal(diffusionStopOutcome({ status, trigger: 'auto', attempts: 1 }), 'sent')
    assert.equal(diffusionStopOutcome({ status: 'failed', trigger: 'auto', attempts: 1 }), 'none')
    assert.equal(diffusionStopOutcome(null), 'none')
  })

  it('diffusion arrêtée reconnue à son message, distincte d’un échec', () => {
    assert.equal(isStoppedDiffusion('failed', STOPPED_DIFFUSION_ERROR), true)
    assert.equal(isStoppedDiffusion('failed', 'Make a refusé la publication'), false)
    assert.equal(isStoppedDiffusion('queued', STOPPED_DIFFUSION_ERROR), false)
  })
})
