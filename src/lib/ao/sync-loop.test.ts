import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { afterBatch } from './sync-loop'

const report = (over: Partial<Parameters<typeof afterBatch>[0]> = {}) => ({
  configured: true, skipped: false, mailboxes: 1, failedMailboxes: 0, processed: 2, failed: 0, remaining: 5, aiUnavailable: false, ...over,
})

describe('synchronisation continue (bouton « Synchroniser maintenant »)', () => {
  it('continue tant qu\'il reste des e-mails et que le passage avance', () => {
    assert.deepEqual(afterBatch(report()), { action: 'continue' })
    assert.deepEqual(afterBatch(report({ processed: 0, failed: 1 })), { action: 'continue' }, 'un e-mail en erreur compte comme avancé')
  })

  it('s\'arrête quand tout est lu, ou quand continuer ne servirait à rien', () => {
    assert.deepEqual(afterBatch(report({ remaining: 0 })), { action: 'stop', reason: 'done' })
    assert.deepEqual(afterBatch(report({ configured: false })), { action: 'stop', reason: 'not-configured' })
    assert.deepEqual(afterBatch(report({ aiUnavailable: true })), { action: 'stop', reason: 'ai' })
    assert.deepEqual(afterBatch(report({ failedMailboxes: 1 })), { action: 'stop', reason: 'mailbox' })
    assert.deepEqual(afterBatch(report({ processed: 0, failed: 0 })), { action: 'stop', reason: 'stalled' })
  })

  it('attend quand une autre synchronisation tient la boîte', () => {
    assert.deepEqual(afterBatch(report({ skipped: true, processed: 0, remaining: 0 })), { action: 'wait' })
  })
})
