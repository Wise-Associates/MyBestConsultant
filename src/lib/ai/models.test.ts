import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AI_MODULES, CLASSIFICATION_AI, fallbackOrder, pickPrimary, requestedModel, sanitizeRouting, type RoutingView } from './models'

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

describe('classification des CV (ADR 0044)', () => {
  const haikuAndMini = { claude: 'claude-haiku-5-5', gpt4o: 'gpt-4o-mini' }

  it('a sa ligne dans Config IA : Claude par défaut, sinon le modèle choisi', () => {
    assert.ok(AI_MODULES.some(m => m.id === 'classification' && m.moduleDefault === 'claude'))
    assert.equal(pickPrimary(cfg(), CLASSIFICATION_AI), 'claude')
    assert.equal(pickPrimary(cfg({ moduleRouting: { classification: 'gpt4o' } }), CLASSIFICATION_AI), 'gpt4o')
    assert.deepEqual(sanitizeRouting({ classification: 'teckia', inconnu: 'gpt4o' }, new Set(['teckia', 'gpt4o'])), { classification: 'teckia' })
  })

  it('suit la chaîne de repli de la plateforme : modèle par défaut, TeckiA, GPT, modèles open source', () => {
    const view = cfg({ provider: 'claude', openSourceModels: [{ id: 'os-llama', enabled: true } as RoutingView['openSourceModels'][number]] })
    assert.deepEqual(fallbackOrder(view, 'claude', () => true), ['teckia', 'gpt4o', 'os-llama'])
    assert.deepEqual(fallbackOrder(view, 'claude', id => id !== 'teckia'), ['gpt4o', 'os-llama'])
  })

  it('demande Claude Haiku et GPT-4o mini, au premier essai comme en repli ; les autres gardent leur modèle', () => {
    assert.equal(requestedModel('claude', 'claude', { providerModels: haikuAndMini }), 'claude-haiku-5-5')
    assert.equal(requestedModel('gpt4o', 'claude', { providerModels: haikuAndMini }), 'gpt-4o-mini')
    assert.equal(requestedModel('teckia', 'claude', { providerModels: haikuAndMini }), undefined)
    assert.equal(requestedModel('os-llama', 'claude', { providerModels: haikuAndMini }), undefined)
    // Modèle choisi pour la ligne dans Config IA : GPT en premier, toujours en GPT-4o mini.
    assert.equal(requestedModel('gpt4o', 'gpt4o', { providerModels: haikuAndMini }), 'gpt-4o-mini')
  })

  it('garde la règle d\'avant pour `model` : premier essai seulement', () => {
    assert.equal(requestedModel('claude', 'claude', { model: 'claude-x' }), 'claude-x')
    assert.equal(requestedModel('gpt4o', 'claude', { model: 'claude-x' }), undefined)
    assert.equal(requestedModel('claude', 'claude', { model: 'claude-x', providerModels: haikuAndMini }), 'claude-haiku-5-5')
  })
})
