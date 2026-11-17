import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { MbcRevealed } from './rules'
import type { PoolProfile } from './strategies'
import { DEFAULT_POOL_FILTERS, filterPool, hasActiveFilters, poolCsv, type PoolContext } from './results-view'

// Données fictives uniquement.
const p = (id: string, over: Partial<PoolProfile> = {}): PoolProfile => ({
  id, firstName: 'Camille', lastNameMasked: 'Du***t', title: 'Data Engineer', company: 'Exemple SA', hasEmail: true, hasPhone: false,
  refreshedAt: '2026-10-01T00:00:00Z', score: 70, reasons: [], match: { title: 'full', skills: [], reachable: true, fresh: true },
  points: { title: 55, skills: 0, reachable: 10, fresh: 5 }, strategies: [0], ...over,
})
const revealed = (id: string, over: Partial<MbcRevealed> = {}): MbcRevealed => ({
  id, name: 'Camille Durand', title: 'Data Engineer', headline: '', company: 'Exemple SA', companyWebsite: '', location: 'Lyon, France',
  linkedinUrl: 'https://www.linkedin.com/in/exemple', email: 'camille@exemple.fr', emailStatus: 'verified', photoUrl: '', experiences: [], ...over,
})
const none: PoolContext = { revealed: {}, aiScore: {} }

describe('MBC Search : filtres et tri de la liste', () => {
  const pool = [
    p('a', { score: 90, refreshedAt: '2026-01-01T00:00:00Z' }),
    p('b', { score: 60, hasEmail: false, strategies: [1], title: 'Ingénieur Data', company: 'Banque Fictive' }),
    p('c', { score: 40, strategies: [0, 1], refreshedAt: '2026-11-01T00:00:00Z' }),
  ]

  it('sans filtre : la liste telle quelle', () => {
    assert.deepEqual(filterPool(pool, DEFAULT_POOL_FILTERS, none).map(x => x.id), ['a', 'b', 'c'])
    assert.equal(hasActiveFilters(DEFAULT_POOL_FILTERS), false)
  })

  it('score minimal, e-mail, requête et texte (sans accents ni casse, tous les mots)', () => {
    const f = DEFAULT_POOL_FILTERS
    assert.deepEqual(filterPool(pool, { ...f, minScore: 55 }, none).map(x => x.id), ['a', 'b'])
    assert.deepEqual(filterPool(pool, { ...f, emailOnly: true }, none).map(x => x.id), ['a', 'c'])
    assert.deepEqual(filterPool(pool, { ...f, strategy: 1 }, none).map(x => x.id), ['b', 'c'])
    assert.deepEqual(filterPool(pool, { ...f, text: 'ingenieur BANQUE' }, none).map(x => x.id), ['b'])
    assert.equal(hasActiveFilters({ ...f, strategy: 0 }), true)
  })

  it('profils révélés (texte cherché aussi dans le lieu révélé) et évalués', () => {
    const ctx: PoolContext = { revealed: { c: revealed('c') }, aiScore: { b: 72 } }
    assert.deepEqual(filterPool(pool, { ...DEFAULT_POOL_FILTERS, revealedOnly: true }, ctx).map(x => x.id), ['c'])
    assert.deepEqual(filterPool(pool, { ...DEFAULT_POOL_FILTERS, text: 'lyon' }, ctx).map(x => x.id), ['c'])
    assert.deepEqual(filterPool(pool, { ...DEFAULT_POOL_FILTERS, evaluatedOnly: true }, ctx).map(x => x.id), ['b'])
  })

  it('tri par score de l\'IA (évalués d\'abord) ou par mise à jour la plus récente', () => {
    const ctx: PoolContext = { revealed: {}, aiScore: { c: 80, b: 50 } }
    assert.deepEqual(filterPool(pool, { ...DEFAULT_POOL_FILTERS, sort: 'ai' }, ctx).map(x => x.id), ['c', 'b', 'a'])
    assert.deepEqual(filterPool(pool, { ...DEFAULT_POOL_FILTERS, sort: 'recent' }, none).map(x => x.id), ['c', 'b', 'a'])
  })
})

describe('MBC Search : export CSV', () => {
  it('ce que la page montre : nom masqué sans révélation, coordonnées seulement d\'un profil révélé, formules neutralisées', () => {
    const csv = poolCsv([p('a'), p('b', { title: '=HYPERLINK("http://x")' })], { revealed: { a: revealed('a') }, aiScore: { a: 81 } })
    const [header, first, second] = csv.split('\n')
    assert.match(header, /^"Nom","Intitulé"/)
    assert.match(first, /^"Camille Durand","Data Engineer","Exemple SA","Lyon, France","camille@exemple.fr","https:\/\/www.linkedin.com\/in\/exemple","70","81","oui","2026-10-01"$/)
    assert.match(second, /^"Camille Du\*\*\*t","'=HYPERLINK\(""http:\/\/x""\)","Exemple SA","","","","70","","non",/)
  })
})
