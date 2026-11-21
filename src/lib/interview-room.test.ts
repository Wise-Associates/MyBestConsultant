import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ROOM_AFTER_COMPLETION_MS, SPEECH_DAILY_LIMITS, interviewPath, questionTexts, roomAccepts, roomCallCap, roomSpeechCap, roomTranscriptionCap } from './interview-room'

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

  it('plafonne à part les transcriptions de l\'entretien vocal', () => {
    assert.equal(roomTranscriptionCap(JSON.stringify(Array(8).fill({}))), 42)
    assert.equal(roomTranscriptionCap(JSON.stringify(Array(500).fill({}))), 130)
    assert.equal(roomTranscriptionCap('pas du json'), 10)
  })

  it('plafonne à part les voix de l\'entretien vocal (ADR 0052)', () => {
    const ten = JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, text: `Question ${i}` })))
    // Question, relance, deux relances orales après un silence, et marge pour la fin et la réponse de clôture.
    assert.equal(roomSpeechCap(ten), 60)
    assert.equal(roomSpeechCap('pas du json'), 10)
    assert.ok(SPEECH_DAILY_LIMITS.organisation < SPEECH_DAILY_LIMITS.allOrganisations)
  })

  it('lit le texte des questions de la session, sans planter sur une valeur abîmée', () => {
    assert.deepEqual(questionTexts(JSON.stringify([{ text: 'Q1' }, { text: 'Q2' }])), ['Q1', 'Q2'])
    assert.deepEqual(questionTexts(JSON.stringify([{ text: 'Q1' }, { autre: 1 }, 'x'])), ['Q1', '', ''])
    assert.deepEqual(questionTexts('pas du json'), [])
    assert.deepEqual(questionTexts(undefined), [])
    assert.equal(questionTexts(JSON.stringify(Array.from({ length: 50 }, () => ({ text: 'Q' })))).length, 30)
  })

  it('envoie le candidat dans la salle vocale /v2, au format choisi (demande du 2026-11-21)', () => {
    assert.equal(interviewPath('abc123', 'audio'), '/interview/abc123/v2?mode=audio')
    assert.equal(interviewPath('abc123', 'video'), '/interview/abc123/v2?mode=video')
    assert.equal(interviewPath('abc123'), '/interview/abc123/v2?mode=video', 'format inconnu : vidéo, comme la salle /v2')
    assert.equal(interviewPath('a/b?c'), '/interview/a%2Fb%3Fc/v2?mode=video')
  })
})

