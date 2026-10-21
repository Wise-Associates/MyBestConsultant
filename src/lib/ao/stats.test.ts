import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { engagementOf } from './parse'
import { cityName, offersByMonth, seniorityOf, tjmSummary, topCounts } from './stats'

describe('assistance technique ou forfait', () => {
  it('reconnaît les formulations courantes', () => {
    for (const v of ['assistance', 'Assistance technique', 'AT', 'régie', 'au TJM']) assert.equal(engagementOf(v), 'assistance', v)
    for (const v of ['forfait', 'Forfait global', 'engagement au forfait']) assert.equal(engagementOf(v), 'forfait', v)
    for (const v of ['', 'mission', 'CDI']) assert.equal(engagementOf(v), '', v)
  })
})

describe('séniorité', () => {
  it('range l\'expérience demandée par tranche, d\'après les années ou le niveau écrit', () => {
    const cases: [string, string][] = [
      ['', 'unknown'], ['Non précisé', 'unknown'], ['Débutant accepté', 'junior'], ['Junior', 'junior'], ['2 ans', 'junior'],
      ['3 à 5 ans', 'confirmed'], ['5 ans et plus', 'confirmed'], ['Confirmé', 'confirmed'], ['8 ans minimum', 'senior'],
      ['Senior', 'senior'], ['Expert, 12 ans d\'expérience', 'expert'], ['10+ ans', 'expert'], ['Expert', 'expert'],
    ]
    for (const [text, bucket] of cases) assert.equal(seniorityOf(text), bucket, text)
  })
})

describe('statistiques AO', () => {
  const now = new Date('2026-10-21T09:00:00Z')

  it('compte les offres par mois de réception sur 12 mois, par statut', () => {
    const months = offersByMonth([
      { receivedAt: '2026-10-02T08:00:00Z', status: 'to_review' }, { receivedAt: '2026-10-15T08:00:00Z', status: 'published' },
      { receivedAt: '2026-09-30T08:00:00Z', status: 'ignored' }, { receivedAt: '2025-01-10T08:00:00Z', status: 'to_review' },
    ], now)
    assert.equal(months.length, 12)
    assert.deepEqual(months[11], { month: '2026-10', to_review: 1, published: 1, ignored: 0 })
    assert.deepEqual(months[10], { month: '2026-09', to_review: 0, published: 0, ignored: 1 })
    assert.equal(months[0].month, '2025-11', 'trop ancien : hors des 12 mois')
  })

  it('classe les valeurs les plus fréquentes, sans tenir compte de la casse ni des accents', () => {
    assert.deepEqual(topCounts(['React', 'react', 'Java', 'Sécurité', 'securite', 'React', ''], 2), [{ label: 'React', count: 3 }, { label: 'Sécurité', count: 2 }])
  })

  it('résume les TJM des missions (médiane et tranches), sans les salaires annuels', () => {
    const s = tjmSummary([450, 520, 600, 480, 55000, null, 750])
    assert.equal(s.count, 5)
    assert.equal(s.median, 520)
    assert.deepEqual(s.ranges.map(r => r.count), [0, 2, 1, 1, 1])
  })
})

describe('villes des statistiques', () => {
  it('regroupe les arrondissements et précisions sous la ville', () => {
    assert.equal(cityName('Paris 15e (75015)'), 'Paris')
    assert.equal(cityName('PARIS - La Défense'), 'Paris')
    assert.equal(cityName('saint-denis'), 'Saint-Denis')
    assert.equal(cityName(''), '')
  })
})
