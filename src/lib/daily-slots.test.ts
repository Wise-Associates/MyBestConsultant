import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { takeAllSlots } from './daily-slots'

const quiet = { error: () => {} }

describe('places de quota prises ensemble', () => {
  it('prend toutes les places en parallèle', async () => {
    let running = 0
    let maxRunning = 0
    const take = async (name: string) => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise(r => setTimeout(r, 5))
      running--
      return `${name}_0`
    }
    const result = await takeAllSlots(['session', 'org', 'plateforme'], take, async () => {}, quiet)
    assert.deepEqual(result, { ok: true, refused: [] })
    assert.equal(maxRunning, 3)
  })

  it('rend les places prises quand une autre est refusée', async () => {
    const released: string[] = []
    const result = await takeAllSlots(['session', 'org', 'plateforme'], async n => (n === 'org' ? null : `${n}_0`), async id => { released.push(id) }, quiet)
    assert.deepEqual(result, { ok: false, refused: ['org'] })
    assert.deepEqual(released.sort(), ['plateforme_0', 'session_0'])
  })

  it('rend les places prises puis lève quand une prise échoue', async () => {
    const released: string[] = []
    await assert.rejects(
      takeAllSlots(['session', 'org'], async n => { if (n === 'org') throw new Error('Appwrite injoignable'); return `${n}_0` }, async id => { released.push(id) }, quiet),
      /Appwrite injoignable/,
    )
    assert.deepEqual(released, ['session_0'])
  })

  it('journalise une place qui n\'a pas pu être rendue, sans masquer le refus', async () => {
    const logged: unknown[] = []
    const result = await takeAllSlots(['a', 'b'], async n => (n === 'b' ? null : 'a_0'), async () => { throw new Error('suppression impossible') }, { error: (...args: unknown[]) => { logged.push(args) } })
    assert.deepEqual(result, { ok: false, refused: ['b'] })
    assert.equal(logged.length, 1)
  })
})
