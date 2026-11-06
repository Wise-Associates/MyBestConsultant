import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_CRITERIA, type MbcCriteria } from './rules'
import {
  SEARCH_HISTORY_MAX, criteriaKey, historyOverflow, parseSearchDoc, searchDocId, searchIdSchema, type MbcSearchEntry,
} from './history'

const criteria: MbcCriteria = { ...EMPTY_CRITERIA, titles: ['Data Engineer'], locations: ['Lyon, France'], skills: ['Spark', 'Kafka'], requiredSkills: ['Kafka'] }

describe('MBC Search : historique des recherches', () => {
  it('reconnaît la même recherche à la casse, aux accents et à l\'ordre près', () => {
    const same: MbcCriteria = { ...criteria, titles: ['data engineer '], skills: ['kafka', 'SPARK'], locations: ['Lyon,  France'] }
    assert.equal(criteriaKey(same), criteriaKey(criteria))
    assert.equal(criteriaKey({ ...criteria, titles: ['Ingénieur'] }), criteriaKey({ ...criteria, titles: ['ingenieur'] }))
  })

  it('distingue des recherches différentes (critère, filtre, compétence obligatoire)', () => {
    assert.notEqual(criteriaKey({ ...criteria, locations: ['Paris'] }), criteriaKey(criteria))
    assert.notEqual(criteriaKey({ ...criteria, emailOnly: true }), criteriaKey(criteria))
    assert.notEqual(criteriaKey({ ...criteria, requiredSkills: [] }), criteriaKey(criteria))
    // Une compétence obligatoire retirée de la liste ne compte plus : même recherche.
    assert.equal(criteriaKey({ ...criteria, requiredSkills: ['Kafka', 'Rust'] }), criteriaKey(criteria))
  })

  it('donne un identifiant de document propre au recruteur, valide pour Appwrite', () => {
    const id = searchDocId('user-1', criteria)
    assert.equal(id.length, 36)
    assert.ok(searchIdSchema.safeParse(id).success)
    assert.equal(searchDocId('user-1', { ...criteria, skills: ['Kafka', 'Spark'] }), id)
    assert.notEqual(searchDocId('user-2', criteria), id)
    assert.equal(searchIdSchema.safeParse('../autre').success, false)
  })

  it('relit un document, et écarte des critères illisibles', () => {
    const doc = { $id: 'sabc', name: 'Data · Lyon', brief: 'brief', criteriaJson: JSON.stringify(criteria), pinned: true, total: 42, lastRunAt: '2026-11-06T10:00:00.000+00:00' }
    const entry = parseSearchDoc(doc)
    assert.deepEqual(entry && { ...entry, criteria: undefined }, { id: 'sabc', name: 'Data · Lyon', brief: 'brief', criteria: undefined, pinned: true, total: 42, lastRunAt: doc.lastRunAt })
    assert.equal(parseSearchDoc({ ...doc, name: '' })?.name, 'Data Engineer · Lyon')
    assert.equal(parseSearchDoc({ ...doc, pinned: null, total: null })?.pinned, false)
    assert.equal(parseSearchDoc({ ...doc, criteriaJson: 'pas du json' }), null)
    assert.equal(parseSearchDoc({ ...doc, criteriaJson: '{"titles":"x"}' }), null)
  })

  it('supprime les plus anciennes au-delà de la limite, jamais une recherche enregistrée', () => {
    const entry = (i: number, pinned = false): MbcSearchEntry => ({ id: `s${i}`, name: '', brief: '', criteria, pinned, total: 0, lastRunAt: '' })
    const list = [entry(0, true), ...Array.from({ length: SEARCH_HISTORY_MAX + 2 }, (_, i) => entry(i + 1)), entry(999, true)]
    assert.deepEqual(historyOverflow(list), [`s${SEARCH_HISTORY_MAX + 1}`, `s${SEARCH_HISTORY_MAX + 2}`])
    assert.deepEqual(historyOverflow(list.slice(0, 10)), [])
  })
})
