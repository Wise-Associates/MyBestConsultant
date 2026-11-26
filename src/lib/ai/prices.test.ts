import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { builtinPrice, costUsd, openSourcePrice } from './prices'

const tokens = (inputTokens: number, outputTokens: number, cacheReadTokens = 0, cacheWriteTokens = 0) =>
  ({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens })

describe("coût estimé d'un appel d'IA", () => {
  it('compte entrée, sortie, lecture et écriture du cache de Claude', () => {
    const price = builtinPrice('claude', 'claude-sonnet-5-5', 1000)
    assert.deepEqual(price, { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 })
    // 1 M d'entrée (2 $), 1 M de sortie (10 $), 1 M lu (0,10 $), 1 M écrit (2,50 $).
    assert.equal(costUsd(tokens(1e6, 1e6, 1e6, 1e6), price), 14.6)
  })

  it('reconnaît une version datée, jamais un autre modèle de même début', () => {
    assert.equal(builtinPrice('claude', 'claude-haiku-4-5-20251001', 10)?.input, 1)
    assert.equal(builtinPrice('gpt4o', 'gpt-4o-2024-08-06', 10)?.input, 2.5)
    assert.equal(builtinPrice('claude', 'claude-opus-5', 10)?.input, 5)
    assert.equal(builtinPrice('claude', 'claude-opus-5-5', 10)?.input, 4)
    assert.equal(builtinPrice('gpt4o', 'gpt-4o-mini', 10)?.input, 0.15)
    assert.equal(builtinPrice('claude', 'claude-opus-5-5-preview', 10), null)
  })

  it('applique le palier de Claude Haiku 5.5 au-delà de 100 000 jetons d’entrée', () => {
    assert.equal(builtinPrice('claude', 'claude-haiku-5-5', 100_000)?.input, 0.1)
    assert.equal(builtinPrice('claude', 'claude-haiku-5-5', 100_001)?.input, 0.5)
  })

  it('ne devine jamais : modèle ou fournisseur inconnu sans coût', () => {
    assert.equal(builtinPrice('claude', 'claude-inconnu-9', 10), null)
    assert.equal(builtinPrice('teckia', 'qwen3:14b', 10), null)
    assert.equal(costUsd(tokens(1000, 1000), null), null)
  })

  it('prend les prix de Config IA pour un modèle open source, cache au prix de l’entrée', () => {
    assert.equal(costUsd(tokens(500_000, 100_000, 500_000), openSourcePrice(0.2, 0.6)), 0.26)
    assert.equal(costUsd(tokens(500_000, 100_000), openSourcePrice(0, 0)), 0)
  })
})
