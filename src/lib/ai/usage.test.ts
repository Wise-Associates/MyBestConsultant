import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { openSourcePrice } from './prices'
import { claudeTokens, directCallRecord, openAiTokens, organisationOf, outcomeOf, promptTokens, usageLogLine, usageRecord, type AttemptFacts } from './usage'

const facts = (over: Partial<AttemptFacts> = {}): AttemptFacts => ({
  provider: 'claude', model: 'claude-sonnet-5-5', attempt: 0, durationMs: 1234.4, truncated: false, outcome: 'ok',
  tokens: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
  price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 }, ...over,
})

describe('journal de consommation de l’IA', () => {
  it('lit les jetons de Claude, cache compris', () => {
    assert.deepEqual(claudeTokens({ input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 900, cache_creation_input_tokens: null }),
      { inputTokens: 120, outputTokens: 30, cacheReadTokens: 900, cacheWriteTokens: 0 })
    assert.equal(claudeTokens(undefined), null)
  })

  it('lit les jetons compatibles OpenAI en retirant de l’entrée ceux lus dans le cache', () => {
    assert.deepEqual(openAiTokens({ prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 600 } }),
      { inputTokens: 400, outputTokens: 50, cacheReadTokens: 600, cacheWriteTokens: 0 })
    assert.deepEqual(openAiTokens({ prompt_tokens: 10, completion_tokens: 2 }), { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 })
    assert.equal(openAiTokens({}), null)
    assert.equal(promptTokens({ inputTokens: 1, outputTokens: 9, cacheReadTokens: 2, cacheWriteTokens: 3 }), 6)
  })

  it('note la nature d’un échec, jamais son message', () => {
    assert.equal(outcomeOf({ status: 529, body: 'demande citée' }), 'http-529')
    assert.equal(outcomeOf({ timedOut: true }), 'timeout')
    assert.equal(outcomeOf({ timedOut: false }), 'unreachable')
    assert.equal(outcomeOf({ notConfigured: true }), 'not-configured')
    class APIConnectionTimeoutError extends Error {}
    assert.equal(outcomeOf(new APIConnectionTimeoutError('x')), 'timeout')
    assert.equal(outcomeOf(Object.assign(new Error('x'), { name: 'AbortError' })), 'timeout')
    assert.equal(outcomeOf(new Error('Le CV de Claire Morel…')), 'error')
    assert.equal(outcomeOf('texte'), 'error')
  })

  it('forme une ligne : fonction, organisation, jetons, durée, coût', () => {
    const r = usageRecord({ feature: 'cv-export-extract', tenantId: 'org1' }, 'cvExport', facts())
    assert.deepEqual(r, {
      feature: 'cv-export-extract', module: 'cvExport', tenantId: 'org1', provider: 'claude', model: 'claude-sonnet-5-5',
      outcome: 'ok', attempt: 0, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0,
      durationMs: 1234, costUsd: 0.004, truncated: false,
    })
  })

  it('sans fonction valable, prend le module ; sans jetons, ni jetons ni coût', () => {
    const r = usageRecord({ feature: 'Pas Valable', tenantId: null }, 'matching', facts({ tokens: null, outcome: 'http-429' }))
    assert.equal(r.feature, 'matching')
    assert.equal(r.tenantId, '')
    assert.equal(r.inputTokens, null)
    assert.equal(r.costUsd, null)
    assert.equal(usageRecord(undefined, undefined, facts()).feature, 'unlabelled')
  })

  it('modèle open source : coût d’après Config IA ; modèle sans prix : pas de coût', () => {
    assert.equal(usageRecord({}, undefined, facts({ provider: 'os-ministral', price: openSourcePrice(0, 0) })).costUsd, 0)
    assert.equal(usageRecord({}, undefined, facts({ provider: 'teckia', price: null })).costUsd, null)
  })

  it('appel direct : un seul essai, prix public du modèle', () => {
    const r = directCallRecord({ feature: 'ao-vision', tenantId: 'org1' }, {
      provider: 'claude', model: 'claude-opus-5-5', durationMs: 50, outcome: 'ok',
      tokens: { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })
    assert.deepEqual([r.attempt, r.module, r.costUsd, r.truncated], [0, '', 0.024, false])
    assert.equal(directCallRecord({}, { provider: 'claude', model: 'x', durationMs: 1, outcome: 'timeout', tokens: null }).costUsd, null)
  })

  it('rattache une offre sans organisation à la plateforme', () => {
    assert.equal(organisationOf(''), 'admin')
    assert.equal(organisationOf(undefined), 'admin')
    assert.equal(organisationOf('org1'), 'org1')
  })

  it('écrit une ligne JSON repérable, sans autre champ que ceux de la ligne', () => {
    const line = usageLogLine(usageRecord({ feature: 'assistant' }, 'assistant', facts()))
    assert.match(line, /^\[llm-usage\] \{.*\}$/)
    assert.deepEqual(Object.keys(JSON.parse(line.slice('[llm-usage] '.length))).sort(), [
      'attempt', 'cacheReadTokens', 'cacheWriteTokens', 'costUsd', 'durationMs', 'feature', 'inputTokens', 'model', 'module',
      'outcome', 'outputTokens', 'provider', 'tenantId', 'truncated',
    ])
  })
})
