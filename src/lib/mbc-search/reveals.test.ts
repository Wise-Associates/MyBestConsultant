import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { MbcRevealed } from './rules'
import { MBC_REVEAL_RETENTION_DAYS, parseRevealDoc, revealCutoff, revealDocId, revealJson } from './reveals'

const now = new Date('2026-11-06T12:00:00Z')
const profile: MbcRevealed = {
  id: '0123456789abcdef01234567', name: 'Camille Martin', title: 'Data Engineer', headline: 'Data', company: 'Exemple SA',
  companyWebsite: 'https://exemple.fr', location: 'Lyon, France', linkedinUrl: 'https://www.linkedin.com/in/exemple',
  email: 'camille@exemple.fr', emailStatus: 'verified', photoUrl: '',
  experiences: [{ title: 'Data Engineer', company: 'Exemple SA', start: '2021-03', end: '', current: true }],
}
const doc = (over: Record<string, unknown> = {}) => ({ apolloId: profile.id, profileJson: revealJson(profile), revealedAt: now.toISOString(), ...over })

describe('MBC Search : profils révélés gardés', () => {
  it('donne un identifiant propre à l\'organisation et à la personne', () => {
    const id = revealDocId('orga-1', profile.id)
    assert.equal(id.length, 36)
    assert.equal(revealDocId('orga-1', profile.id), id)
    assert.notEqual(revealDocId('orga-2', profile.id), id)
  })

  it('relit un profil révélé pendant la durée de conservation', () => {
    assert.deepEqual(parseRevealDoc(doc(), now), profile)
    const lastDay = new Date(now.getTime() - (MBC_REVEAL_RETENTION_DAYS * 86_400_000 - 60_000)).toISOString()
    assert.ok(parseRevealDoc(doc({ revealedAt: lastDay }), now))
  })

  it('ne relit pas un profil périmé, illisible ou d\'une autre personne', () => {
    assert.equal(parseRevealDoc(doc({ revealedAt: new Date(revealCutoff(now).getTime() - 1).toISOString() }), now), null)
    assert.equal(parseRevealDoc(doc({ profileJson: 'pas du json' }), now), null)
    assert.equal(parseRevealDoc(doc({ apolloId: 'ffffffffffffffffffffffff' }), now), null)
    assert.equal(parseRevealDoc(doc({ profileJson: JSON.stringify({ ...profile, linkedinUrl: 'javascript:alert(1)' }) }), now), null)
  })

  it('tient dans l\'attribut, même avec un long parcours', () => {
    const long = { ...profile, headline: 'x'.repeat(5000), experiences: Array.from({ length: 20 }, () => ({ ...profile.experiences[0], title: 'y'.repeat(290) })) }
    const json = revealJson(long)
    assert.ok(json.length <= 10_000)
    assert.ok(parseRevealDoc(doc({ profileJson: json }), now))
  })
})
