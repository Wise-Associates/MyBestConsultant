import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { periodStart, rowFromDocument, summarizeUsage, usageDocument, usagePeriodOf, type UsageRow } from './usage-stats'

const row = (over: Partial<UsageRow> = {}): UsageRow => ({
  createdAt: '2026-11-26T10:00:00.000Z', feature: 'scoring-matching', module: 'matching', tenantId: 'org1', provider: 'claude',
  model: 'claude-sonnet-5-5', outcome: 'ok', attempt: 0, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0,
  cacheWriteTokens: 0, durationMs: 2000, costMicroUsd: 3000, truncated: false, ...over,
})

const NOW = new Date('2026-11-26T18:00:00.000Z')

describe('page « Consommation IA » : totaux de la période', () => {
  it('garde le coût en millionièmes de dollar, sans arrondi flottant', () => {
    const doc = usageDocument({
      feature: 'f', module: '', tenantId: '', provider: 'claude', model: 'm', outcome: 'ok', attempt: 0, inputTokens: 1,
      outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 1, costUsd: 0.004321, truncated: false,
    })
    assert.equal(doc.costMicroUsd, 4321)
    assert.equal('costUsd' in doc, false)
  })

  it('relit une ligne abîmée sans faire échouer la page', () => {
    const r = rowFromDocument({ $createdAt: '2026-11-26T10:00:00.000Z', inputTokens: 'x', attempt: null, outcome: '' })
    assert.deepEqual([r.feature, r.outcome, r.attempt, r.inputTokens, r.costMicroUsd], ['unlabelled', 'error', 0, null, null])
  })

  it('période de 7, 30 ou 90 jours, 30 sinon ; elle commence à minuit UTC', () => {
    assert.equal(usagePeriodOf('7'), 7)
    assert.equal(usagePeriodOf(['90']), 90)
    assert.equal(usagePeriodOf('365'), 30)
    assert.equal(periodStart(7, NOW).toISOString(), '2026-11-20T00:00:00.000Z')
  })

  it('compte requêtes, replis, échecs, jetons et coût', () => {
    const s = summarizeUsage([
      row(),
      row({ outcome: 'http-529', attempt: 0, inputTokens: null, outputTokens: null, costMicroUsd: null, durationMs: 50 }),
      row({ attempt: 1, provider: 'gpt4o', model: 'gpt-4o-mini', costMicroUsd: 600, durationMs: 4000 }),
      row({ provider: 'os-ministral', model: 'ft-x', inputTokens: null, outputTokens: null, costMicroUsd: null }),
      row({ model: 'claude-inconnu', costMicroUsd: null, truncated: true }),
    ], periodStart(7, NOW), NOW)
    assert.deepEqual(s.totals, {
      attempts: 5, requests: 4, fallbacks: 1, failures: 1, inputTokens: 3000, outputTokens: 300, cacheReadTokens: 0,
      cacheWriteTokens: 0, costUsd: 0.0036, withoutTokens: 1, withoutPrice: 1, truncated: 1, medianDurationMs: 2000,
    })
  })

  it('regroupe par fonction, modèle et organisation, les plus coûteux d’abord', () => {
    const s = summarizeUsage([
      row({ feature: 'assistant', tenantId: '', costMicroUsd: 100 }),
      row({ feature: 'cv-export-extract', costMicroUsd: 90_000 }),
      row({ feature: 'cv-export-extract', costMicroUsd: 10_000, tenantId: 'org2', model: 'claude-opus-5-5' }),
    ], periodStart(7, NOW), NOW)
    assert.deepEqual(s.byFeature.map(g => [g.key, g.attempts, g.costUsd]), [['cv-export-extract', 2, 0.1], ['assistant', 1, 0.0001]])
    assert.deepEqual(s.byModel.map(g => g.key), ['claude · claude-sonnet-5-5', 'claude · claude-opus-5-5'])
    assert.deepEqual(s.byTenant.map(g => g.key), ['org1', 'org2', ''])
  })

  it('donne chaque jour de la période, même sans appel, et ignore les lignes hors période', () => {
    const s = summarizeUsage([
      row({ createdAt: '2026-11-25T23:59:00.000Z' }),
      row({ createdAt: '2026-11-26T00:01:00.000Z', outcome: 'timeout', costMicroUsd: null }),
      row({ createdAt: '2026-11-01T00:00:00.000Z' }),
    ], periodStart(7, NOW), NOW)
    assert.equal(s.byDay.length, 7)
    assert.deepEqual(s.byDay.slice(-2), [
      { day: '2026-11-25', requests: 1, failures: 0, costUsd: 0.003 },
      { day: '2026-11-26', requests: 1, failures: 1, costUsd: 0 },
    ])
    assert.equal(s.totals.attempts, 2)
    assert.deepEqual(s.recentFailures.map(r => r.outcome), ['timeout'])
  })
})
