import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { smtpErrorMessage, smtpSettings } from './smtp'

const env = {
  SMTP_HOST: 'smtp.exemple.test', SMTP_USER: 'envoi@exemple.test', SMTP_PASSWORD: ' secret ',
  SMTP_FROM: 'My Best Consultant <envoi@exemple.test>',
}

describe('réglages SMTP', () => {
  it('lit les réglages, port 465 par défaut, mot de passe tel quel', () => {
    assert.deepEqual(smtpSettings(env), {
      settings: { host: 'smtp.exemple.test', port: 465, user: 'envoi@exemple.test', password: ' secret ', from: 'My Best Consultant <envoi@exemple.test>' },
    })
    const on587 = smtpSettings({ ...env, SMTP_PORT: '587' })
    assert.equal('settings' in on587 && on587.settings.port, 587)
  })

  it('refuse d\'envoyer sans toutes les variables, et les nomme', () => {
    assert.deepEqual(smtpSettings({}), { missing: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'] })
    assert.deepEqual(smtpSettings({ ...env, SMTP_FROM: '  ' }), { missing: ['SMTP_FROM'] })
  })

  it('refuse un port qui n\'en est pas un', () => {
    for (const port of ['abc', '0', '70000', '46.5']) {
      assert.deepEqual(smtpSettings({ ...env, SMTP_PORT: port }), { missing: ['SMTP_PORT'] }, port)
    }
  })
})

describe('erreur d\'envoi SMTP', () => {
  it('garde les codes, jamais la réponse du serveur (elle peut contenir l\'adresse du candidat)', () => {
    const refused = Object.assign(new Error('Can\'t send mail - all recipients were rejected: 550 5.1.1 <jean.dupont@exemple.test>: Recipient address rejected'), {
      code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO',
    })
    assert.equal(smtpErrorMessage(refused), 'Envoi SMTP impossible (EENVELOPE, 550, RCPT TO)')
    assert.equal(smtpErrorMessage(new Error('boom')), 'Envoi SMTP impossible')
    assert.equal(smtpErrorMessage(undefined), 'Envoi SMTP impossible')
  })
})
