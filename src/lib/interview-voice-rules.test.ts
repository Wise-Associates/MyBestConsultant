import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_GOOGLE_VOICE, audioOfGoogleResponse, googleErrorMessage, googleFailureAllowsFallback, googleSynthesizeBody, googleVoiceSettings } from './interview-voice-rules'

describe('voix Google de l\'entretien vocal (ADR 0052)', () => {
  it('n\'utilise Google qu\'avec une clé', () => {
    assert.equal(googleVoiceSettings({}), null)
    assert.equal(googleVoiceSettings({ GOOGLE_TTS_API_KEY: '  ' }), null)
  })

  it('prend la voix par défaut, ou celle réglée, et en tire la langue', () => {
    assert.deepEqual(googleVoiceSettings({ GOOGLE_TTS_API_KEY: ' k ' }), { apiKey: 'k', voice: DEFAULT_GOOGLE_VOICE, languageCode: 'fr-FR' })
    assert.deepEqual(googleVoiceSettings({ GOOGLE_TTS_API_KEY: 'k', GOOGLE_TTS_VOICE: ' fr-FR-Neural2-D ' }),
      { apiKey: 'k', voice: 'fr-FR-Neural2-D', languageCode: 'fr-FR' })
    assert.equal(googleVoiceSettings({ GOOGLE_TTS_API_KEY: 'k', GOOGLE_TTS_VOICE: 'fr-CA-Chirp3-HD-Orus' })?.languageCode, 'fr-CA')
    assert.match(DEFAULT_GOOGLE_VOICE, /^fr-FR-Chirp3-HD-/)
  })

  it('demande un MP3 du texte avec la voix réglée, sans clé dans le corps', () => {
    const settings = { apiKey: 'secret', voice: 'fr-FR-Chirp3-HD-Charon', languageCode: 'fr-FR' }
    const body = googleSynthesizeBody('Bonjour « Camille » & bienvenue', settings)
    assert.deepEqual(JSON.parse(body), {
      input: { text: 'Bonjour « Camille » & bienvenue' },
      voice: { languageCode: 'fr-FR', name: 'fr-FR-Chirp3-HD-Charon' },
      audioConfig: { audioEncoding: 'MP3' },
    })
    assert.ok(!body.includes('secret'))
  })

  it('lit l\'audio de la réponse, ou rien si elle n\'en a pas', () => {
    const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x44])
    assert.deepEqual(audioOfGoogleResponse({ audioContent: mp3.toString('base64') }), mp3)
    assert.equal(audioOfGoogleResponse({ audioContent: '' }), null)
    assert.equal(audioOfGoogleResponse({}), null)
    assert.equal(audioOfGoogleResponse(null), null)
    assert.equal(audioOfGoogleResponse({ audioContent: 42 }), null)
  })

  it('résume un refus de Google pour le journal, message borné', () => {
    assert.equal(googleErrorMessage(400, { error: { message: 'Voice does not exist' } }), 'Google Text-to-Speech 400 : Voice does not exist')
    assert.equal(googleErrorMessage(503, null), 'Google Text-to-Speech 503')
    assert.ok(googleErrorMessage(400, { error: { message: 'x'.repeat(1000) } }).length < 240)
  })

  it('ne passe pas à OpenAI quand Google refuse pour quota : un plafond de dépenses chez Google doit arrêter la dépense', () => {
    assert.equal(googleFailureAllowsFallback(429), false)
    assert.equal(googleFailureAllowsFallback(400), true)
    assert.equal(googleFailureAllowsFallback(403), true)
    assert.equal(googleFailureAllowsFallback(503), true)
    assert.equal(googleFailureAllowsFallback(null), true)
  })
})
