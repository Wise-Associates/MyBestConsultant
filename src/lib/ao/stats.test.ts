import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { engagementOf } from './parse'
import { cityName, grainOf, lastTwelveMonths, offersOverTime, seniorityOf, tjmSummary, topCounts } from './stats'

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

  it('compte les offres par mois de réception sur 12 mois, par statut (page d\'une organisation)', () => {
    const { grain, buckets: months } = offersOverTime([
      { receivedAt: '2026-10-02T08:00:00Z', status: 'to_review' }, { receivedAt: '2026-10-15T08:00:00.000+00:00', status: 'published' },
      { receivedAt: '2026-09-30T08:00:00Z', status: 'ignored' }, { receivedAt: '2025-01-10T08:00:00Z', status: 'to_review' },
    ], lastTwelveMonths(now))
    assert.equal(grain, 'month')
    assert.equal(months.length, 12)
    assert.deepEqual(months[11], { start: '2026-10-01', to_review: 1, published: 1, ignored: 0 })
    assert.deepEqual(months[10], { start: '2026-09-01', to_review: 0, published: 0, ignored: 1 })
    assert.equal(months[0].start, '2025-11-01', 'trop ancien : hors des 12 mois')
  })

  it('choisit des barres lisibles : par jour jusqu\'à 31 jours, par semaine jusqu\'à 120, par mois au-delà', () => {
    assert.equal(grainOf({ from: '2026-10-15', to: '2026-11-13' }), 'day')
    assert.equal(grainOf({ from: '2026-10-14', to: '2026-11-13' }), 'day', '31 jours')
    assert.equal(grainOf({ from: '2026-10-13', to: '2026-11-13' }), 'week')
    assert.equal(grainOf({ from: '2026-07-17', to: '2026-11-13' }), 'week', '120 jours')
    assert.equal(grainOf({ from: '2026-07-16', to: '2026-11-13' }), 'month', '121 jours')

    const days = offersOverTime([
      { receivedAt: '2026-11-13T23:59:00Z', status: 'published' }, { receivedAt: '2026-11-07T00:00:00Z', status: 'to_review' },
      { receivedAt: '2026-11-06T23:59:59Z', status: 'ignored' }, { receivedAt: 'illisible', status: 'ignored' },
    ], { from: '2026-11-07', to: '2026-11-13' })
    assert.deepEqual(days.buckets.map(b => b.start), ['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'])
    assert.deepEqual(days.buckets.map(b => b.to_review + b.published + b.ignored), [1, 0, 0, 0, 0, 0, 1], 'veille de la période et date illisible écartées')

    // Semaines du lundi : le 2026-09-15 est un mardi, la première barre commence le lundi 14.
    const weeks = offersOverTime([{ receivedAt: '2026-09-20T10:00:00Z', status: 'published' }, { receivedAt: '2026-09-21T10:00:00Z', status: 'published' }], { from: '2026-09-15', to: '2026-11-13' })
    assert.equal(weeks.grain, 'week')
    assert.equal(weeks.buckets[0].start, '2026-09-14')
    assert.equal(weeks.buckets[0].published, 1, 'dimanche 20 : semaine du 14')
    assert.equal(weeks.buckets[1].published, 1, 'lundi 21 : semaine suivante')
    assert.equal(weeks.buckets.at(-1)?.start, '2026-11-09')
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
