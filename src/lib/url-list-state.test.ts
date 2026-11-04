import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { initialUrlListSync, noteListWrite, syncFromUrl } from './url-list-state'

describe('filtres d’une liste recopiés dans l’adresse', () => {
  it('ne reprend pas les écritures de la liste, même arrivées en retard pendant une frappe', () => {
    let sync = initialUrlListSync('')
    sync = noteListWrite(sync, 'q=j')
    sync = noteListWrite(sync, 'q=ja')
    sync = noteListWrite(sync, 'q=jav')
    // L'adresse de la première lettre arrive alors que la liste en est à « jav » : la saisie est gardée.
    let step = syncFromUrl(sync, 'q=j')
    assert.equal(step.adopt, false)
    step = syncFromUrl(step.sync, 'q=jav')
    assert.equal(step.adopt, false)
    assert.deepEqual(step.sync, { seen: 'q=jav', pending: [] })
  })

  it('reprend une adresse que la liste n’a pas écrite (onglet du sous-menu, lien vers la même page)', () => {
    let sync = noteListWrite(initialUrlListSync(''), 'status=archived')
    sync = syncFromUrl(sync, 'status=archived').sync
    const step = syncFromUrl(sync, '')
    assert.equal(step.adopt, true)
    assert.deepEqual(step.sync, { seen: '', pending: [] })
  })

  it('reprend une navigation arrivée avant la fin d’une frappe', () => {
    let sync = noteListWrite(initialUrlListSync(''), 'q=j')
    let step = syncFromUrl(sync, 'q=j')
    sync = noteListWrite(step.sync, 'q=ja')
    step = syncFromUrl(sync, 'contract=cdi')
    assert.equal(step.adopt, true)
    assert.deepEqual(step.sync.pending, [])
  })

  it('ne note pas une écriture qui ne change pas l’adresse (attendue sans fin sinon)', () => {
    const sync = initialUrlListSync('q=java')
    assert.equal(noteListWrite(sync, 'q=java'), sync)
    const pending = noteListWrite(sync, 'q=jav')
    assert.equal(noteListWrite(pending, 'q=jav'), pending)
  })

  it('ne fait rien tant que l’adresse ne change pas', () => {
    const sync = initialUrlListSync('q=java')
    assert.deepEqual(syncFromUrl(sync, 'q=java'), { sync, adopt: false })
  })
})
