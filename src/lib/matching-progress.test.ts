import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BACKGROUND_SCORING_MS, STALL_MS, nextWatch, startWatch } from './matching-progress'

const T0 = Date.UTC(2026, 10, 26, 9, 0, 0)

describe('suivi des notations en arrière-plan du Matching IA', () => {
  it('suit jusqu’à l’échéance de la requête, ou plus tôt quand plus aucune ligne n’attend', () => {
    const watch = startWatch(T0, false)
    assert.equal(watch.until, T0 + BACKGROUND_SCORING_MS)
    assert.ok(nextWatch(watch, 12, T0 + 10_000))
    assert.equal(nextWatch(watch, 0, T0 + 10_000), null)
    assert.equal(nextWatch(watch, 12, T0 + BACKGROUND_SCORING_MS), null)
    assert.equal(nextWatch(null, 12, T0), null)
  })

  it('renotation de la base (scores écrits à la fin) : jamais arrêtée faute de progrès', () => {
    let watch = nextWatch(startWatch(T0, false), 30, T0 + 10_000)
    watch = nextWatch(watch, 30, T0 + 10_000 + STALL_MS * 3)
    assert.ok(watch)
    assert.equal(watch.left, 30)
  })

  it('jugement de mes libellés : progrès noté, arrêt après une minute sans ligne notée', () => {
    let watch = nextWatch(startWatch(T0, true), 50, T0 + 10_000)
    assert.deepEqual([watch?.left, watch?.at], [50, T0 + 10_000])
    watch = nextWatch(watch, 44, T0 + 20_000)
    assert.deepEqual([watch?.left, watch?.at], [44, T0 + 20_000])
    assert.ok(nextWatch(watch, 44, T0 + 20_000 + STALL_MS - 1))
    assert.equal(nextWatch(watch, 44, T0 + 20_000 + STALL_MS), null)
  })
})
