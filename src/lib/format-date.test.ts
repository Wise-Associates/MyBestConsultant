import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatDateFr, timeAgoFr } from './format-date'

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

describe('durée écoulée d\'une activité', () => {
  const now = new Date('2026-11-13T12:00:00.000Z').getTime()
  it('écrit les minutes, heures et jours, puis la date au-delà d\'une semaine', () => {
    assert.equal(timeAgoFr('2026-11-13T11:59:30.000Z', now), 'à l’instant')
    assert.equal(timeAgoFr('2026-11-13T11:15:00.000Z', now), 'il y a 45 min')
    assert.equal(timeAgoFr('2026-11-13T09:00:00.000Z', now), 'il y a 3 h')
    assert.equal(timeAgoFr('2026-11-10T12:00:00.000Z', now), 'il y a 3 j')
    assert.equal(timeAgoFr('2026-11-01T12:00:00.000Z', now), '1 nov.')
  })
})
