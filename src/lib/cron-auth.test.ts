import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hasBearerSecret } from './cron-auth'

const request = (authorization?: string) => new Request('https://exemple.test/api/veille/config', { headers: authorization ? { authorization } : {} })
const token = 'j'.repeat(32)

describe('jeton d\'une route appelée par un service (scanner de la veille, planificateur)', () => {
  it('accepte le bon jeton seulement', () => {
    assert.equal(hasBearerSecret(request(`Bearer ${token}`), token, 32), true)
    assert.equal(hasBearerSecret(request(`Bearer ${'k'.repeat(32)}`), token, 32), false)
    assert.equal(hasBearerSecret(request(token), token, 32), false, 'sans « Bearer »')
    assert.equal(hasBearerSecret(request(), token, 32), false, 'sans en-tête')
  })

  it('refuse tout quand le jeton du serveur manque ou est trop court, même « Bearer undefined »', () => {
    assert.equal(hasBearerSecret(request('Bearer undefined'), undefined, 32), false)
    assert.equal(hasBearerSecret(request('Bearer '), '', 32), false)
    assert.equal(hasBearerSecret(request('Bearer court'), 'court', 32), false)
  })
})
