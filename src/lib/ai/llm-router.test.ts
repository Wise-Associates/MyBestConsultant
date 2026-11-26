import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { callWithConfig, LLMChainError, LLMHttpError, type AttemptOutput, type CallDeps, type RuntimeConfig } from './llm-router'
import type { LlmUsageRecord } from './usage'

// Configuration fictive : Claude par défaut, GPT en repli ; aucune clé réelle, aucun appel réseau.
const cfg = (over: Partial<RuntimeConfig> = {}): RuntimeConfig => ({
  provider: 'claude', claudeModel: 'claude-sonnet-5-5', claudeApiKey: 'k', gpt4oModel: 'gpt-4o-mini', openaiApiKey: 'k',
  teckiaModel: 'qwen3:14b', teckiaApiUrl: '', teckiaApiKey: '', openSourceModels: [], moduleRouting: {}, loaded: true, ...over,
})

/** Essais simulés : chaque fournisseur répond ou échoue comme indiqué, 100 ms par essai. */
function deps(answers: Record<string, AttemptOutput | Error>) {
  const records: LlmUsageRecord[] = []
  let clock = 0
  const d: CallDeps = {
    attempt: async provider => {
      clock += 100
      const answer = answers[provider]
      if (!answer || answer instanceof Error) throw answer ?? new Error('non prévu')
      return answer
    },
    record: r => records.push(r),
    now: () => clock,
  }
  return { d, records }
}

const ok = (content: string, inputTokens = 1000, outputTokens = 100): AttemptOutput =>
  ({ content, truncated: false, tokens: { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 } })

describe('journal de consommation de chaque appel d’IA', () => {
  it('note un appel réussi avec sa fonction, son organisation, ses jetons, sa durée et son coût', async () => {
    const { d, records } = deps({ claude: ok('réponse') })
    const res = await callWithConfig(cfg(), { module: 'matching', usage: { feature: 'scoring-matching', tenantId: 'org1' } }, d)
    assert.deepEqual(res, { content: 'réponse', provider: 'claude' })
    assert.equal(records.length, 1)
    assert.deepEqual(records[0], {
      feature: 'scoring-matching', module: 'matching', tenantId: 'org1', provider: 'claude', model: 'claude-sonnet-5-5',
      outcome: 'ok', attempt: 0, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0,
      durationMs: 100, costUsd: 0.003, truncated: false,
    })
  })

  it('note chaque essai : le modèle choisi en échec, puis le repli qui répond', async () => {
    const { d, records } = deps({ claude: new LLMHttpError(529, 'surchargé'), gpt4o: ok('repli', 2000, 500) })
    const res = await callWithConfig(cfg(), { usage: { feature: 'ao-extract', tenantId: 'admin' } }, d)
    assert.equal(res.provider, 'gpt4o')
    assert.deepEqual(records.map(r => [r.attempt, r.provider, r.model, r.outcome, r.inputTokens, r.costUsd]), [
      [0, 'claude', 'claude-sonnet-5-5', 'http-529', null, null],
      [1, 'gpt4o', 'gpt-4o-mini', 'ok', 2000, 0.0006],
    ])
  })

  it('note tous les essais quand aucun modèle ne répond', async () => {
    const { d, records } = deps({ claude: new LLMHttpError(400, 'x'), gpt4o: new LLMHttpError(401, 'y') })
    await assert.rejects(callWithConfig(cfg(), {}, d), LLMChainError)
    assert.deepEqual(records.map(r => [r.provider, r.outcome, r.feature]), [['claude', 'http-400', 'unlabelled'], ['gpt4o', 'http-401', 'unlabelled']])
  })

  it('appel strict : un seul essai, et une ligne même refusé avant tout essai', async () => {
    const failing = deps({ claude: new LLMHttpError(500, 'x'), gpt4o: ok('jamais') })
    await assert.rejects(callWithConfig(cfg(), { module: 'assistant', strict: true, usage: { feature: 'assistant' } }, failing.d))
    assert.deepEqual(failing.records.map(r => [r.provider, r.outcome]), [['claude', 'http-500']])

    const refused = deps({ claude: ok('jamais') })
    await assert.rejects(callWithConfig(cfg({ loaded: false }), { module: 'assistant', strict: true, usage: { feature: 'assistant' } }, refused.d))
    assert.deepEqual(refused.records.map(r => [r.feature, r.outcome, r.attempt]), [['assistant', 'not-configured', 0]])
  })

  it('un journal en panne ne fait pas échouer l’appel', async () => {
    const { d } = deps({ claude: ok('réponse') })
    const res = await callWithConfig(cfg(), {}, { ...d, record: () => { throw new Error('journal en panne') } })
    assert.equal(res.content, 'réponse')
  })
})
