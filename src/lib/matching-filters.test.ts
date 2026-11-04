import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_MATCHING_FILTERS, filterMatches, isFilteringMatches, matchingFiltersFromSearchParams, withMatchingFilters,
  type MatchingFilters, type MatchRow,
} from './matching-filters'

// Candidats fictifs.
const rows: (MatchRow & { id: string })[] = [
  { id: 'a', source: 'application', name: 'Élodie Martin', email: 'elodie.martin@exemple.fr', score: 82 },
  { id: 'b', source: 'pool', name: 'Jean Dupont', email: 'jean.dupont@exemple.fr', score: 65 },
  { id: 'c', source: 'pool', name: 'Karim Benali', email: 'k.benali@exemple.fr', score: 64 },
  { id: 'd', source: 'vivier', name: 'Sophie Leroy', email: '', score: 40 },
  { id: 'e', source: 'application', name: 'Paul Morel', email: 'paul.morel@exemple.fr', score: null },
]
const ids = (f: Partial<MatchingFilters>) => filterMatches(rows, { ...EMPTY_MATCHING_FILTERS, ...f }).map(r => r.id)

describe('filtres du Matching IA', () => {
  it('garde tout sans filtre, dans l’ordre de la page', () => {
    assert.deepEqual(ids({}), ['a', 'b', 'c', 'd', 'e'])
    assert.equal(isFilteringMatches(EMPTY_MATCHING_FILTERS), false)
  })

  it('filtre par type de candidat', () => {
    assert.deepEqual(ids({ source: 'application' }), ['a', 'e'])
    assert.deepEqual(ids({ source: 'pool' }), ['b', 'c'])
    assert.deepEqual(ids({ source: 'vivier' }), ['d'])
  })

  it('sépare au seuil « correspond » de 65, et les candidats pas encore notés', () => {
    assert.deepEqual(ids({ score: 'match' }), ['a', 'b'])
    assert.deepEqual(ids({ score: 'below' }), ['c', 'd'])
    assert.deepEqual(ids({ score: 'pending' }), ['e'])
  })

  it('cherche dans le nom et l’e-mail, sans casse ni accents', () => {
    assert.deepEqual(ids({ q: 'elodie' }), ['a'])
    assert.deepEqual(ids({ q: '  DUPONT ' }), ['b'])
    assert.deepEqual(ids({ q: 'k.benali@' }), ['c'])
    assert.deepEqual(ids({ q: 'inconnu' }), [])
  })

  it('combine les filtres', () => {
    assert.deepEqual(ids({ source: 'application', score: 'match' }), ['a'])
    assert.deepEqual(ids({ source: 'pool', score: 'match', q: 'karim' }), [])
  })
})

describe('filtres du Matching IA dans l’adresse', () => {
  it('relit à l’identique les filtres écrits', () => {
    const f: MatchingFilters = { q: 'dupont', source: 'pool', score: 'match' }
    const params = withMatchingFilters(new URLSearchParams(), f)
    assert.equal(params.toString(), 'q=dupont&type=pool&score=match')
    assert.deepEqual(matchingFiltersFromSearchParams(params), f)
  })

  it('n’écrit pas les valeurs par défaut et garde les autres paramètres', () => {
    assert.equal(withMatchingFilters(new URLSearchParams('autre=1&type=pool'), EMPTY_MATCHING_FILTERS).toString(), 'autre=1')
  })

  it('ignore une valeur inconnue et borne la recherche', () => {
    assert.deepEqual(matchingFiltersFromSearchParams(new URLSearchParams('type=chasseur&score=90')), EMPTY_MATCHING_FILTERS)
    assert.equal(matchingFiltersFromSearchParams(new URLSearchParams({ q: 'x'.repeat(500) })).q.length, 200)
  })
})
