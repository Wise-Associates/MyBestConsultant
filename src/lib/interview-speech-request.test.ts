import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseSpeechLine } from './interview-speech-request'

describe('demande de voix de l\'entretien vocal (ADR 0052)', () => {
  it('accepte une question par son rang, la fin et la relance, sans texte libre', () => {
    assert.deepEqual(parseSpeechLine({ kind: 'question', index: 3 }), { kind: 'question', index: 3 })
    assert.deepEqual(parseSpeechLine({ kind: 'closing' }), { kind: 'closing' })
    assert.deepEqual(parseSpeechLine({ kind: 'reprompt', text: 'ignoré' }), { kind: 'reprompt' })
    assert.deepEqual(parseSpeechLine({ kind: 'question', index: 0, text: 'texte choisi par le navigateur' }), { kind: 'question', index: 0 })
  })

  it('refuse un rang de question invalide', () => {
    assert.equal(parseSpeechLine({ kind: 'question', index: -1 }), null)
    assert.equal(parseSpeechLine({ kind: 'question', index: 1.5 }), null)
    assert.equal(parseSpeechLine({ kind: 'question', index: '2' }), null)
    assert.equal(parseSpeechLine({ kind: 'question', index: 100 }), null)
  })

  it('n\'accepte aucun texte libre (ADR 0053 : plus de réponse de l\'IA pendant l\'entretien)', () => {
    assert.equal(parseSpeechLine({ kind: 'reply', text: 'Bonne question.' }), null)
  })

  it('refuse toute autre forme', () => {
    for (const body of [null, 'texte', 42, {}, { kind: 'autre' }, { text: 'Bonjour' }, []]) assert.equal(parseSpeechLine(body), null)
  })
})
