import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_ANSWER_AUDIO_BYTES, audioContainer, transcriptionFailureReason, transcriptionFields, transcriptionPrompt } from './speech-to-text-rules'

const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81])
const mp4 = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20])
const ogg = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02])

describe('fichier audio d\'une réponse', () => {
  it('reconnaît les formats des enregistreurs des navigateurs par leurs premiers octets', () => {
    assert.equal(audioContainer(webm), 'webm')
    assert.equal(audioContainer(mp4), 'mp4')
    assert.equal(audioContainer(ogg), 'ogg')
  })

  it('refuse tout autre contenu, quel que soit le type annoncé', () => {
    assert.equal(audioContainer(new TextEncoder().encode('<html><script>')), null)
    assert.equal(audioContainer(new Uint8Array([0x25, 0x50, 0x44, 0x46])), null)
    assert.equal(audioContainer(new Uint8Array([])), null)
  })

  it('accepte une réponse de 3 min au débit de la page, sans marge excessive (OpenAI facture la durée)', () => {
    const threeMinutesAt32kbps = (180 * 32_000) / 8
    assert.ok(MAX_ANSWER_AUDIO_BYTES >= threeMinutesAt32kbps * 1.5)
    assert.ok(MAX_ANSWER_AUDIO_BYTES <= 1.5 * 1024 * 1024)
  })
})

describe('demande de transcription', () => {
  it('envoie la langue au format de gpt-transcribe', () => {
    const fields = transcriptionFields('gpt-transcribe', 'contexte')
    assert.deepEqual(fields, [['model', 'gpt-transcribe'], ['languages[]', 'fr'], ['prompt', 'contexte'], ['response_format', 'json']])
  })

  it('envoie la langue à l\'ancien format pour les autres modèles', () => {
    const fields = transcriptionFields('gpt-4o-mini-transcribe', 'contexte')
    assert.ok(fields.some(([k, v]) => k === 'language' && v === 'fr'))
    assert.ok(!fields.some(([k]) => k === 'languages[]'))
  })

  it('donne le poste et la question en contexte, sans dépasser la longueur prévue', () => {
    const prompt = transcriptionPrompt('Développeur React', 'Pouvez-vous vous présenter ?')
    assert.match(prompt, /Développeur React/)
    assert.match(prompt, /Pouvez-vous vous présenter/)
    assert.ok(transcriptionPrompt('x'.repeat(5000), 'y'.repeat(5000)).length <= 800)
  })

  it('traduit les erreurs d\'OpenAI sans jamais recopier la clé', () => {
    assert.equal(transcriptionFailureReason(429, '{"error":{"code":"insufficient_quota"}}', 'sk-1'), 'crédits OpenAI épuisés')
    assert.equal(transcriptionFailureReason(401, '{}', 'sk-1'), 'clé OpenAI refusée (Config IA)')
    assert.equal(transcriptionFailureReason(404, '{"error":{"code":"model_not_found"}}', 'sk-1'), 'modèle de transcription introuvable ou non autorisé (OPENAI_TRANSCRIBE_MODEL)')
    assert.equal(transcriptionFailureReason(503, 'Bad gateway', 'sk-1'), 'OpenAI indisponible (503)')
    assert.doesNotMatch(transcriptionFailureReason(400, '{"error":{"message":"bad key sk-secret here"}}', 'sk-secret'), /sk-secret/)
  })
})
