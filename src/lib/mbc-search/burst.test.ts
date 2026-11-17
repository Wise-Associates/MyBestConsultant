import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BURST_LIMIT, takeBurstSlot } from './burst'

describe('MBC Search : rafales d\'appels', () => {
  it('refuse le 21e appel d\'un recruteur dans la minute, sans gêner les autres', () => {
    const log = new Map<string, number[]>()
    for (let i = 0; i < BURST_LIMIT.calls; i++) assert.equal(takeBurstSlot(log, 'r1', 1_000 + i), true)
    assert.equal(takeBurstSlot(log, 'r1', 1_100), false)
    assert.equal(takeBurstSlot(log, 'r2', 1_100), true)
  })

  it('libère les places une fois la minute passée', () => {
    const log = new Map<string, number[]>()
    for (let i = 0; i < BURST_LIMIT.calls; i++) takeBurstSlot(log, 'r1', 0)
    assert.equal(takeBurstSlot(log, 'r1', BURST_LIMIT.windowMs - 1), false)
    assert.equal(takeBurstSlot(log, 'r1', BURST_LIMIT.windowMs), true)
  })

  it('un refus ne prend pas de place', () => {
    const log = new Map<string, number[]>()
    assert.equal(takeBurstSlot(log, 'r1', 0, 1), true)
    assert.equal(takeBurstSlot(log, 'r1', 10, 1), false)
    assert.deepEqual(log.get('r1'), [0])
  })
})
