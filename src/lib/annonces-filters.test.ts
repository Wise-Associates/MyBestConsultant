import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { annoncesViewFromSearchParams, DEFAULT_ANNONCES_VIEW, withAnnoncesView, type AnnoncesView } from './annonces-filters'

describe('vue de « Suivi des annonces » dans l’adresse', () => {
  it('relit à l’identique la vue écrite', () => {
    const v: AnnoncesView = { q: 'chef de projet', status: 'archived', sort: 'todo', page: 3 }
    const params = withAnnoncesView(new URLSearchParams(), v)
    assert.equal(params.toString(), 'q=chef+de+projet&status=archived&sort=todo&page=3')
    assert.deepEqual(annoncesViewFromSearchParams(params), v)
  })

  it('n’écrit pas les valeurs par défaut', () => {
    assert.equal(withAnnoncesView(new URLSearchParams('q=ancienne&page=4'), DEFAULT_ANNONCES_VIEW).toString(), '')
  })

  it('ignore une valeur inconnue ou une page impossible', () => {
    assert.deepEqual(annoncesViewFromSearchParams(new URLSearchParams('status=supprimees&sort=hasard&page=-2')), DEFAULT_ANNONCES_VIEW)
    assert.equal(annoncesViewFromSearchParams(new URLSearchParams('page=abc')).page, 1)
  })

  it('borne la recherche relue', () => {
    assert.equal(annoncesViewFromSearchParams(new URLSearchParams({ q: 'x'.repeat(500) })).q.length, 200)
  })
})
