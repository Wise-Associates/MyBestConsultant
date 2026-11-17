import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { COMPARE_MAX, DEFAULT_FOLLOW, FOLLOW_LIMITS, countByStatus, followFields, followSchema, parseFollow, toggleCompared } from './follow'

describe('MBC Search : suivi des personnes enregistrées', () => {
  it('valide le suivi envoyé : statut connu, note et étiquettes bornées, étiquettes sans doublon ni vide', () => {
    const f = followSchema.parse({ status: 'contacte', note: '  Relancer lundi\nsur LinkedIn\u0007 ', tags: ['Java', 'java', ' ', 'Lyon'] })
    assert.deepEqual(f, { status: 'contacte', note: 'Relancer lundi\nsur LinkedIn', tags: ['Java', 'Lyon'] })
    assert.equal(followSchema.safeParse({ status: 'vip', note: '', tags: [] }).success, false)
    assert.equal(followSchema.safeParse({ status: 'contacte', note: 'x'.repeat(FOLLOW_LIMITS.note + 1), tags: [] }).success, false)
    assert.equal(followSchema.safeParse({ status: 'contacte', note: '', tags: Array(FOLLOW_LIMITS.tags + 1).fill('a') }).success, false)
    assert.equal(followSchema.safeParse({ status: 'contacte', note: '', tags: ['x'.repeat(41)] }).success, false)
  })

  it('relit un document : sans attributs (avant leur création), « À examiner » ; valeur invalide, par défaut', () => {
    assert.deepEqual(parseFollow({}), DEFAULT_FOLLOW)
    assert.deepEqual(parseFollow({ followStatus: 'refuse', followNote: 'Pas mobile', followTags: ['SAP', 3] }), { status: 'refuse', note: 'Pas mobile', tags: ['SAP'] })
    assert.deepEqual(parseFollow({ followStatus: 'inconnu' }), DEFAULT_FOLLOW)
    // Valeurs null (documents créés avant les attributs, tels qu'Appwrite les rend).
    assert.deepEqual(parseFollow({ followStatus: null, followNote: null, followTags: null }), DEFAULT_FOLLOW)
    // Un statut retiré de la liste ne fait perdre ni la note ni les étiquettes.
    assert.deepEqual(parseFollow({ followStatus: 'ancien', followNote: 'Garder', followTags: ['SAP'] }), { status: 'a_examiner', note: 'Garder', tags: ['SAP'] })
  })

  it('étiquettes nettoyées des caractères de contrôle', () => {
    assert.deepEqual(followSchema.parse({ status: 'a_examiner', note: '', tags: ['Ja\tva'] }).tags, ['Ja va'])
  })

  it('« Comparer » : 3 au plus, personnes retirées de la sélection oubliées (elles ne prennent plus de place)', () => {
    const kept = (id: string) => id !== 'c'
    assert.deepEqual(toggleCompared(['a', 'b'], 'd', () => true), ['a', 'b', 'd'])
    assert.deepEqual(toggleCompared(['a', 'b', 'd'], 'e', () => true), ['a', 'b', 'd'], `${COMPARE_MAX} au plus`)
    assert.deepEqual(toggleCompared(['a', 'b', 'c'], 'd', kept), ['a', 'b', 'd'], 'c retirée : sa place se libère')
    assert.deepEqual(toggleCompared(['a', 'b'], 'a', () => true), ['b'])
  })

  it('attributs écrits et nombres par statut', () => {
    assert.deepEqual(followFields({ status: 'embauche', note: 'n', tags: ['t'] }), { followStatus: 'embauche', followNote: 'n', followTags: ['t'] })
    const counts = countByStatus([DEFAULT_FOLLOW, DEFAULT_FOLLOW, { ...DEFAULT_FOLLOW, status: 'contacte' }])
    assert.equal(counts.a_examiner, 2)
    assert.equal(counts.contacte, 1)
    assert.equal(counts.embauche, 0)
  })
})
