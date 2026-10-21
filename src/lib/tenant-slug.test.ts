import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { READABLE_SLUG_ATTEMPTS, slugCandidate, slugify } from './tenant-slug'

describe('slug d\'organisation', () => {
  it('donne une adresse lisible, sans accents ni ponctuation', () => {
    assert.equal(slugify('Wise Associates'), 'wise-associates')
    assert.equal(slugify('  Société Générale (SG) '), 'societe-generale-sg')
    assert.equal(slugify('!!!'), 'entreprise')
    assert.ok(slugify('x'.repeat(200)).length <= 60)
  })

  it('propose « nom-2 », « nom-3 »… puis un suffixe aléatoire quand le nom est pris', () => {
    const random = () => 'k3x9'
    assert.equal(slugCandidate('Acme', 0, random), 'acme')
    assert.equal(slugCandidate('Acme', 1, random), 'acme-2')
    assert.equal(slugCandidate('Acme', READABLE_SLUG_ATTEMPTS - 1, random), `acme-${READABLE_SLUG_ATTEMPTS}`)
    assert.equal(slugCandidate('Acme', READABLE_SLUG_ATTEMPTS, random), 'acme-k3x9')
  })
})
