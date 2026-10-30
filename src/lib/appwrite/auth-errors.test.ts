import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AppwriteException } from 'node-appwrite'
import { translateAuthError } from './auth-errors'

// Réponses telles que les rend Appwrite 1.7.4.
const smtpDisabled = () => new AppwriteException('SMTP Disabled', 503, 'general_smtp_disabled')

describe('translateAuthError : envoi des emails (vérification, mot de passe oublié)', () => {
  it('serveur sans SMTP : le message le dit en français, sans le texte d’Appwrite', () => {
    for (const context of ['verify', 'forgot'] as const) {
      const message = translateAuthError(smtpDisabled(), context)
      assert.match(message, /^L’envoi d’emails est indisponible sur la plateforme/)
      assert.doesNotMatch(message, /SMTP/)
    }
  })

  it('vérification : une erreur de configuration (adresse de retour refusée) donne le message par défaut, pas « informations saisies »', () => {
    const err = new AppwriteException('Invalid `url` param: URL host must be one of: localhost', 400, 'general_argument_invalid')
    assert.equal(translateAuthError(err, 'verify'), 'L’email n’a pas pu être envoyé. Réessayez dans un instant ; si le problème continue, contactez le support.')
  })

  it('vérification : trop de demandes', () => {
    const err = new AppwriteException('Rate limit for the current endpoint has been exceeded.', 429, 'general_rate_limit_exceeded')
    assert.equal(translateAuthError(err, 'verify'), 'Trop de tentatives. Patientez quelques minutes avant de réessayer.')
  })
})
