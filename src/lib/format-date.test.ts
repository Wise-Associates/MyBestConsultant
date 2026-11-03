import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatDateFr } from './format-date'

describe('formatDateFr', () => {
  it('écrit la date en français, mois abrégé', () => {
    assert.equal(formatDateFr('2026-06-01T10:00:00Z'), '1 juin 2026')
    assert.equal(formatDateFr('2026-11-03T10:00:00Z'), '3 nov. 2026')
  })

  it('donne le jour de Paris, pas celui du serveur en UTC', () => {
    assert.equal(formatDateFr('2026-11-02T23:30:00Z'), '3 nov. 2026', 'hiver, UTC+1')
    assert.equal(formatDateFr('2026-07-14T22:30:00Z'), '15 juil. 2026', 'été, UTC+2')
  })
})
