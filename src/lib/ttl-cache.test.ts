import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TtlCache } from './ttl-cache'

describe('cache en mémoire à durée de vie', () => {
  it('rend une valeur pendant sa durée de vie, plus après', () => {
    const cache = new TtlCache<string>(1000)
    cache.set('a', 'A', 0)
    assert.equal(cache.get('a', 999), 'A')
    assert.equal(cache.get('a', 1000), undefined)
    assert.equal(cache.get('a', 500), undefined, 'une valeur expirée est retirée')
  })

  it('oublie une valeur sur demande', () => {
    const cache = new TtlCache<number>(1000)
    cache.set('a', 1, 0)
    cache.delete('a')
    assert.equal(cache.get('a', 1), undefined)
  })

  it('reste borné en nombre de valeurs', () => {
    const cache = new TtlCache<number>(60_000, 3)
    for (let i = 0; i < 10; i++) cache.set(`k${i}`, i, i)
    assert.equal(cache.size, 3)
    assert.equal(cache.get('k9', 10), 9)
    assert.equal(cache.get('k0', 10), undefined)
  })

  it('retire d\'abord les valeurs expirées quand il est plein', () => {
    const cache = new TtlCache<number>(100, 2)
    cache.set('vieux', 1, 0)
    cache.set('récent', 2, 150)
    cache.set('nouveau', 3, 160)
    assert.equal(cache.get('récent', 160), 2)
    assert.equal(cache.get('nouveau', 160), 3)
  })
})
