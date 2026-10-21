import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { keyFromBase64, seal, unseal } from './crypto-box'

describe('crypto-box', () => {
  const key = randomBytes(32)

  it('déchiffre ce qu\'il a chiffré, et ne produit jamais deux fois le même texte', () => {
    const a = seal('mot de passe é€', key, 'ao_source:abc')
    assert.equal(unseal(a, key, 'ao_source:abc'), 'mot de passe é€')
    assert.notEqual(seal('mot de passe é€', key, 'ao_source:abc'), a)
    assert.ok(!a.includes('mot'))
  })

  it('refuse un texte altéré, recopié vers un autre document ou lu avec une autre clé', () => {
    const sealed = seal('secret', key, 'ao_source:abc')
    const [v, iv, tag, data] = sealed.split('.')
    const flipped = Buffer.from(data, 'base64url')
    flipped[0] ^= 1
    assert.throws(() => unseal([v, iv, tag, flipped.toString('base64url')].join('.'), key, 'ao_source:abc'))
    assert.throws(() => unseal(sealed, key, 'ao_source:autre'))
    assert.throws(() => unseal(sealed, randomBytes(32), 'ao_source:abc'))
    // Étiquette tronquée : refusée (sinon l'authentification serait affaiblie).
    assert.throws(() => unseal([v, iv, Buffer.from(tag, 'base64url').subarray(0, 4).toString('base64url'), data].join('.'), key, 'ao_source:abc'))
    assert.throws(() => unseal('v0.a.b.c', key, 'ao_source:abc'), /format/)
  })

  it('exige une clé de 32 octets', () => {
    assert.equal(keyFromBase64(randomBytes(32).toString('base64'), 'CLE').length, 32)
    assert.throws(() => keyFromBase64(undefined, 'CLE'), /CLE/)
    assert.throws(() => keyFromBase64(randomBytes(16).toString('base64'), 'CLE'), /32 octets/)
  })
})
