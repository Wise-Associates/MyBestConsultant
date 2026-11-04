import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mapLimit } from './concurrency'

describe('mapLimit', () => {
  it('garde l\'ordre des éléments et ne lance jamais plus de `limit` appels à la fois', async () => {
    let running = 0
    let peak = 0
    const results = await mapLimit([30, 5, 20, 1, 10, 2], 2, async ms => {
      running++
      peak = Math.max(peak, running)
      await new Promise(resolve => setTimeout(resolve, ms))
      running--
      return ms * 2
    })
    assert.deepEqual(results, [60, 10, 40, 2, 20, 4])
    assert.equal(peak, 2)
  })

  it('ne fait rien sans élément', async () => {
    assert.deepEqual(await mapLimit([], 3, async () => 1), [])
  })
})
