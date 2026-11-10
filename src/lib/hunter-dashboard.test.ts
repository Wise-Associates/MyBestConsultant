import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { filterProposals, isWideHunterPage, parseProposalFilter, proposalCounts, proposalsShown } from './hunter-dashboard'

const p = (id: string, status: string) => ({ applicationId: id, status })
const list = [p('a', 'pending'), p('b', 'screening'), p('c', 'interview'), p('d', 'accepted'), p('e', 'rejected'), p('f', 'on_hold'), p('g', 'shortlist')]

describe('tableau de bord chasseur : les chiffres filtrent les propositions', () => {
  it('« En cours de traitement » : ni reçues, ni gardées en vivier, ni décidées', () => {
    assert.deepEqual(filterProposals(list, 'en-cours').map(x => x.applicationId), ['b', 'c', 'g'])
  })

  it('« Profils retenus » : acceptées seulement ; « Propositions envoyées » : toutes', () => {
    assert.deepEqual(filterProposals(list, 'retenus').map(x => x.applicationId), ['d'])
    assert.equal(filterProposals(list, 'toutes').length, list.length)
  })

  it('les chiffres des cartes comptent exactement ce que chaque filtre affiche', () => {
    assert.deepEqual(proposalCounts(list), { toutes: 7, 'en-cours': 3, retenus: 1 })
  })

  it('sans filtre, les 5 dernières ; avec un filtre, toutes celles qui passent (20 au plus)', () => {
    const many = Array.from({ length: 30 }, (_, i) => p(String(i), 'screening'))
    assert.equal(proposalsShown(many, null).length, 5)
    assert.equal(proposalsShown(many, 'en-cours').length, 20)
    assert.equal(proposalsShown(many, 'retenus').length, 0)
  })

  it('lit le filtre de l\'adresse ; une valeur inconnue n\'en est pas un', () => {
    assert.equal(parseProposalFilter('en-cours'), 'en-cours')
    assert.equal(parseProposalFilter('retenus'), 'retenus')
    assert.equal(parseProposalFilter('toutes'), 'toutes')
    assert.equal(parseProposalFilter('autre'), null)
    assert.equal(parseProposalFilter(undefined), null)
    assert.equal(parseProposalFilter(['retenus']), null)
  })
})

describe('espace chasseur : pages en pleine largeur à partir de 1440 px', () => {
  it('le tableau de bord seulement', () => {
    assert.equal(isWideHunterPage('/hunter/dashboard'), true)
    for (const path of ['/hunter/vivier', '/hunter/offres', '/hunter/offres/a1', '/hunter/propositions', '/hunter/dashboardx']) {
      assert.equal(isWideHunterPage(path), false, path)
    }
  })
})
