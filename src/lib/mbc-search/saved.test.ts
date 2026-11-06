import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { MbcProfile, MbcRevealed } from './rules'
import { parseSavedPersonDoc, savedPersonDocId, savedPersonFields, searchRowSchema } from './saved'

const profile: MbcRevealed = {
  id: '0123456789abcdef01234567', name: 'Camille Martin', title: 'Data Engineer', headline: 'Data', company: 'Exemple SA',
  companyWebsite: 'https://exemple.fr', location: 'Lyon, France', linkedinUrl: 'https://www.linkedin.com/in/exemple',
  email: 'camille@exemple.fr', emailStatus: 'verified', photoUrl: '',
  experiences: [{ title: 'Data Engineer', company: 'Exemple SA', start: '2021-03', end: '', current: true }],
}
const search: MbcProfile = {
  id: profile.id, firstName: 'Camille', lastNameMasked: 'M***n', title: 'Data Engineer', company: 'Exemple SA',
  hasEmail: true, hasPhone: false, refreshedAt: '2026-10-01T00:00:00Z',
}
const savedAt = '2026-11-06T12:00:00.000Z'
const doc = (over: Record<string, unknown> = {}) => ({ apolloId: profile.id, savedAt, ...savedPersonFields(search, profile), ...over })

describe('MBC Search : personnes enregistrées', () => {
  it('donne un identifiant propre au recruteur et à la personne', () => {
    const id = savedPersonDocId('user-1', profile.id)
    assert.equal(id.length, 36)
    assert.match(id, /^p[a-f0-9]{35}$/)
    assert.equal(savedPersonDocId('user-1', profile.id), id)
    assert.notEqual(savedPersonDocId('user-2', profile.id), id)
    assert.notEqual(savedPersonDocId('user-1', 'ffffffffffffffffffffffff'), id)
  })

  it('relit une personne enregistrée, sans limite de durée', () => {
    assert.deepEqual(parseSavedPersonDoc(doc()), { search, profile, savedAt })
    assert.deepEqual(parseSavedPersonDoc(doc({ savedAt: '2020-01-01T00:00:00.000Z' }))?.profile, profile)
  })

  it('écarte un document illisible, d\'une autre personne ou aux liens non https', () => {
    assert.equal(parseSavedPersonDoc(doc({ profileJson: 'pas du json' })), null)
    assert.equal(parseSavedPersonDoc(doc({ searchJson: 'pas du json' })), null)
    assert.equal(parseSavedPersonDoc(doc({ apolloId: 'ffffffffffffffffffffffff' })), null)
    assert.equal(parseSavedPersonDoc(doc({ searchJson: JSON.stringify({ ...search, id: 'ffffffffffffffffffffffff' }) })), null)
    assert.equal(parseSavedPersonDoc(doc({ profileJson: JSON.stringify({ ...profile, linkedinUrl: 'javascript:alert(1)' }) })), null)
  })

  it('n\'accepte du navigateur que la ligne de recherche, bornée', () => {
    const sent = { ...search, score: 90, email: 'intrus@exemple.fr' }
    const parsed = searchRowSchema.safeParse(sent)
    assert.ok(parsed.success)
    assert.deepEqual(parsed.data, search)
    const long = searchRowSchema.safeParse({ ...search, title: 'x'.repeat(1500) })
    assert.ok(long.success)
    assert.equal(long.data.title.length, 300)
    const control = searchRowSchema.safeParse({ ...search, title: '\u0001'.repeat(300), company: '"'.repeat(300) })
    assert.ok(control.success)
    assert.ok(JSON.stringify(control.data).length <= 4000, 'tient dans l\'attribut searchJson (4 000)')
    assert.equal(searchRowSchema.safeParse({ ...search, id: 'pas-un-identifiant' }).success, false)
    assert.equal(searchRowSchema.safeParse({ ...search, title: 'x'.repeat(5000) }).success, false)
  })
})
