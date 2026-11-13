import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ROOM_AFTER_COMPLETION_MS, roomAccepts, roomCallCap } from './interview-room'

const NOW = new Date('2026-11-13T12:00:00.000Z')

describe('salle d\'entretien du candidat', () => {
  it('n\'accepte l\'IA et la progression que pendant l\'entretien', () => {
    assert.equal(roomAccepts({ status: 'pending' }, 'live', NOW), true)
    assert.equal(roomAccepts({ status: 'in_progress' }, 'live', NOW), true)
    assert.equal(roomAccepts({ status: 'completed', completedAt: NOW.toISOString() }, 'live', NOW), false)
    assert.equal(roomAccepts({ status: 'analysed' }, 'live', NOW), false)
  })

  it('accepte l\'enregistrement et les signalements peu après la fin, pas plus tard', () => {
    const justNow = new Date(NOW.getTime() - 60_000).toISOString()
    const tooOld = new Date(NOW.getTime() - ROOM_AFTER_COMPLETION_MS - 1).toISOString()
    assert.equal(roomAccepts({ status: 'analysed', completedAt: justNow }, 'after', NOW), true)
    assert.equal(roomAccepts({ status: 'completed', completedAt: tooOld }, 'after', NOW), false)
    assert.equal(roomAccepts({ status: 'completed' }, 'after', NOW), false)
    assert.equal(roomAccepts({ status: 'cancelled', completedAt: justNow }, 'after', NOW), false)
  })

  it('plafonne les appels d\'une session selon son nombre de questions', () => {
    assert.equal(roomCallCap(JSON.stringify(Array(8).fill({}))), 68)
    assert.equal(roomCallCap(JSON.stringify(Array(500).fill({}))), 200)
    assert.equal(roomCallCap('pas du json'), 20)
    assert.equal(roomCallCap(undefined), 20)
  })
})
