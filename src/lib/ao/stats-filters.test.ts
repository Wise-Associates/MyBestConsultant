import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_PERIOD_DAYS, addDays, inPeriod, periodLabel, selectedSites, statsFiltersFromParams } from './stats-filters'

const NOW = new Date('2026-11-13T21:30:00Z')

describe('filtres des statistiques AO : période', () => {
  it('ouvre sur les 30 derniers jours, aujourd\'hui compris', () => {
    assert.deepEqual(statsFiltersFromParams({}, NOW), { period: { from: '2026-10-15', to: '2026-11-13' }, preset: '30', sites: null })
  })

  it('un raccourci l\'emporte sur les dates saisies et glisse avec le jour', () => {
    assert.deepEqual(statsFiltersFromParams({ periode: '7', du: '2026-01-01', au: '2026-02-01' }, NOW).period, { from: '2026-11-07', to: '2026-11-13' })
    assert.deepEqual(statsFiltersFromParams({ periode: '365' }, NOW).period, { from: '2025-11-14', to: '2026-11-13' })
    assert.equal(statsFiltersFromParams({ periode: '365' }, NOW).preset, '365')
  })

  it('dates saisies : remises dans l\'ordre, une seule date complétée, date inexistante ignorée', () => {
    assert.deepEqual(statsFiltersFromParams({ periode: '', du: '2026-10-01', au: '2026-10-31' }, NOW), { period: { from: '2026-10-01', to: '2026-10-31' }, preset: null, sites: null })
    assert.deepEqual(statsFiltersFromParams({ du: '2026-10-31', au: '2026-10-01' }, NOW).period, { from: '2026-10-01', to: '2026-10-31' })
    assert.deepEqual(statsFiltersFromParams({ du: '2026-11-01' }, NOW).period, { from: '2026-11-01', to: '2026-11-13' })
    assert.deepEqual(statsFiltersFromParams({ au: '2026-10-31' }, NOW).period, { from: '2026-10-02', to: '2026-10-31' })
    assert.deepEqual(statsFiltersFromParams({ du: '2026-02-30', au: '2026-13-01' }, NOW).period, { from: '2026-10-15', to: '2026-11-13' }, 'dates inexistantes : 30 jours')
    assert.deepEqual(statsFiltersFromParams({ du: ['2026-11-01', '2026-01-01'] }, NOW).period.from, '2026-11-01', 'paramètre répété : le premier')
  })

  it('raccourcit une période trop longue par son début', () => {
    const { period } = statsFiltersFromParams({ du: '1900-01-01', au: '2026-11-13' }, NOW)
    assert.equal(period.to, '2026-11-13')
    assert.equal(period.from, addDays('2026-11-13', -(MAX_PERIOD_DAYS - 1)))
  })

  it('compte un instant dans la période selon son jour UTC, quelle que soit son écriture', () => {
    const period = { from: '2026-11-07', to: '2026-11-13' }
    assert.equal(inPeriod('2026-11-07T00:00:00.000+00:00', period), true)
    assert.equal(inPeriod('2026-11-13T23:59:59Z', period), true)
    assert.equal(inPeriod('2026-11-14T00:30:00+02:00', period), true, '13 novembre 22 h 30 UTC')
    assert.equal(inPeriod('2026-11-06T23:59:59Z', period), false)
    assert.equal(inPeriod('', period), false)
  })

  it('écrit la période en clair', () => {
    assert.equal(periodLabel({ from: '2026-10-15', to: '2026-11-13' }), 'du 15/10/2026 au 13/11/2026')
    assert.equal(periodLabel({ from: '2026-11-13', to: '2026-11-13' }), 'le 13/11/2026')
  })
})

describe('filtres des statistiques AO : sites sources', () => {
  it('lit les sites demandés, sans doublon ni identifiant malformé', () => {
    assert.deepEqual(statsFiltersFromParams({ site: ['boamp', 'ted', 'boamp', 'Pas un id', '../x'] }, NOW).sites, ['boamp', 'ted'])
    assert.equal(statsFiltersFromParams({ site: 'boamp' }, NOW).sites?.[0], 'boamp')
    assert.equal(statsFiltersFromParams({ site: [] }, NOW).sites, null)
  })

  it('retient les sites demandés qui existent ; aucun, ou aucun connu : tous', () => {
    const available = ['boamp', 'ted', 'e-mails']
    assert.deepEqual([...selectedSites(['ted', 'inconnu'], available)], ['ted'])
    assert.deepEqual([...selectedSites(null, available)], available)
    assert.deepEqual([...selectedSites(['retire-depuis'], available)], available)
  })
})
