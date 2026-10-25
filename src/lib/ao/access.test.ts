import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { aoAccess, type AoAccessStore } from './access'
import type { AoSource } from './sources'
import type { AoEmail, AoOffer } from './types'

// Deux organisations fictives et la plateforme, chacune avec sa boîte, un e-mail et une offre.
const sources: Record<string, Pick<AoSource, '$id' | 'tenantId'>> = {
  'src-acme': { $id: 'src-acme', tenantId: 'tenant-acme' },
  'src-globex': { $id: 'src-globex', tenantId: 'tenant-globex' },
  'src-platform': { $id: 'src-platform', tenantId: 'admin' },
}
const emails: Record<string, Pick<AoEmail, '$id' | 'sourceId'>> = {
  'mail-acme': { $id: 'mail-acme', sourceId: 'src-acme' },
  'mail-globex': { $id: 'mail-globex', sourceId: 'src-globex' },
  'mail-platform': { $id: 'mail-platform', sourceId: 'src-platform' },
  // E-mail enregistré avant les boîtes par organisation (ADR 0005) : rattaché à aucune boîte.
  'mail-orphan': { $id: 'mail-orphan', sourceId: '' },
}
const offers: Record<string, Pick<AoOffer, '$id' | 'emailId'>> = {
  'offer-acme': { $id: 'offer-acme', emailId: 'mail-acme' },
  'offer-globex': { $id: 'offer-globex', emailId: 'mail-globex' },
  'offer-platform': { $id: 'offer-platform', emailId: 'mail-platform' },
  'offer-orphan': { $id: 'offer-orphan', emailId: 'mail-orphan' },
}

const read: string[] = []
const store: AoAccessStore = {
  getEmail: async id => { read.push(`email:${id}`); return (emails[id] as AoEmail | undefined) ?? null },
  getSource: async id => (sources[id] as AoSource | undefined) ?? null,
  getOffer: async id => (offers[id] as AoOffer | undefined) ?? null,
}

describe('accès d\'une organisation à ses appels d\'offres', () => {
  it('ouvre les e-mails et offres reçus dans ses propres boîtes', async () => {
    const acme = aoAccess(store, 'tenant-acme')
    assert.equal((await acme.offer('offer-acme'))?.$id, 'offer-acme')
    assert.equal((await acme.email('mail-acme'))?.email.$id, 'mail-acme')
    assert.equal((await acme.email('mail-acme'))?.source.$id, 'src-acme', 'la boîte est rendue pour relire l\'original')
  })

  it('ne montre ni l\'offre d\'une autre organisation ni celle de la plateforme', async () => {
    const acme = aoAccess(store, 'tenant-acme')
    assert.equal(await acme.offer('offer-globex'), null)
    assert.equal(await acme.offer('offer-platform'), null)
    assert.equal(await acme.email('mail-globex'), null)
  })

  it('limite la plateforme à ses propres boîtes', async () => {
    const platform = aoAccess(store, 'admin')
    assert.equal((await platform.offer('offer-platform'))?.$id, 'offer-platform')
    assert.equal(await platform.offer('offer-acme'), null)
  })

  it('refuse un e-mail sans boîte, un document inconnu et un identifiant invalide sans interroger la base', async () => {
    const acme = aoAccess(store, 'tenant-acme')
    assert.equal(await acme.offer('offer-orphan'), null)
    assert.equal(await acme.offer('offer-inconnue'), null)
    read.length = 0
    for (const id of ['', '../offer-acme', 'a'.repeat(37), 'offer acme']) assert.equal(await acme.email(id), null, JSON.stringify(id))
    assert.deepEqual(read, [], 'identifiants refusés avant toute lecture')
  })
})
