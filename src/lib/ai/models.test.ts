import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pickPrimary, type RoutingView } from './models'

const cfg = (over: Partial<RoutingView> = {}): RoutingView => ({ provider: 'teckia', moduleRouting: {}, openSourceModels: [], ...over })

describe('choix du premier modèle appelé', () => {
  it('module sans modèle choisi : modèle de l\'appelant (Claude pour le vivier général), sinon modèle par défaut', () => {
    assert.equal(pickPrimary(cfg(), { module: 'matching', moduleDefault: 'claude' }), 'claude')
    assert.equal(pickPrimary(cfg(), { module: 'matching' }), 'teckia')
  })

  it('le modèle choisi pour le module dans Config IA l\'emporte sur celui de l\'appelant', () => {
    assert.equal(pickPrimary(cfg({ moduleRouting: { matching: 'gpt4o' } }), { module: 'matching', moduleDefault: 'claude' }), 'gpt4o')
  })

  it('un modèle forcé l\'emporte sur tout', () => {
    assert.equal(pickPrimary(cfg({ moduleRouting: { matching: 'gpt4o' } }), { provider: 'teckia', module: 'matching', moduleDefault: 'claude' }), 'teckia')
  })

  it('un modèle de l\'appelant inconnu est ignoré', () => {
    assert.equal(pickPrimary(cfg(), { module: 'matching', moduleDefault: 'os-retire' }), 'teckia')
  })
})
