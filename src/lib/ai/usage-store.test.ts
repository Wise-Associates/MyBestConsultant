import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deleteRowsBefore, recordLlmUsage, usageCutoff } from './usage-store'
import type { LlmUsageRecord } from './usage'

/** Base fictive : `pages` lignes périmées par lot demandé, suppressions comptées. */
function fakeDatabases(pages: number[], failDelete = false) {
  const calls = { list: 0, deleted: 0 }
  const databases = {
    listDocuments: async () => {
      const n = pages[calls.list++] ?? 0
      return { total: n, documents: Array.from({ length: n }, (_, i) => ({ $id: `d${calls.list}-${i}` })) }
    },
    deleteDocument: async () => {
      if (failDelete) throw new Error('refus')
      calls.deleted++
      return {}
    },
  }
  return { databases: databases as unknown as Parameters<typeof deleteRowsBefore>[0], calls }
}

const record: LlmUsageRecord = {
  feature: 'assistant', module: 'assistant', tenantId: '', provider: 'claude', model: 'claude-sonnet-5-5', outcome: 'ok', attempt: 0,
  inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 100, costUsd: 0.00007, truncated: false,
}

describe('conservation du journal de consommation de l’IA', () => {
  it('garde 90 jours', () => {
    assert.equal(usageCutoff(new Date('2026-11-26T12:00:00.000Z')), '2026-08-28T12:00:00.000Z')
  })

  it('supprime par lots jusqu’à un lot incomplet', async () => {
    const { databases, calls } = fakeDatabases([100, 100, 30, 100])
    assert.equal(await deleteRowsBefore(databases, 'db', 'llm_usage', 'cutoff'), 230)
    assert.deepEqual(calls, { list: 3, deleted: 230 })
  })

  it('s’arrête au nombre de lots ou à l’heure limite', async () => {
    const limited = fakeDatabases([100, 100, 100])
    assert.equal(await deleteRowsBefore(limited.databases, 'db', 'llm_usage', 'cutoff', { maxBatches: 2 }), 200)
    const late = fakeDatabases([100])
    assert.equal(await deleteRowsBefore(late.databases, 'db', 'llm_usage', 'cutoff', { deadline: 1000 }, () => 1000), 0)
    assert.equal(late.calls.list, 0)
  })

  it('signale une suppression refusée à l’appelant (journalisée par lui)', async () => {
    const { databases } = fakeDatabases([5], true)
    await assert.rejects(deleteRowsBefore(databases, 'db', 'llm_usage', 'cutoff'), /refus/)
  })

  it('noter un appel ne lève jamais, même sans collection configurée', async () => {
    assert.doesNotThrow(() => recordLlmUsage(record))
    // L'écriture n'est pas attendue par l'appel : laisser finir la tâche lancée, qui ne doit pas rejeter.
    await new Promise(resolve => setTimeout(resolve, 50))
  })
})
