import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FRESHNESS, RISING_RECENT_MONTHS, cvStatsView, sinceFilter } from './cv-stats'
import {
  MAX_PAGE, freshnessRange, meiliString, pageFromParam, parseSelection, selectionFilter, selectionParams, selectionTitle, statProfilesHref,
  type StatSelection,
} from './cv-stats-selection'

const now = new Date('2026-11-19T10:00:00.000Z')

describe('sélection des profils d’un nombre des statistiques', () => {
  it('relit chaque sélection de la page depuis son adresse', () => {
    const selections: StatSelection[] = [
      { field: 'competence', value: 'Python' }, { field: 'metier', value: 'Chef de projet' }, { field: 'famille', value: 'data_ia' },
      { field: 'seniorite', value: 'senior' }, { field: 'secteur', value: 'banque' }, { field: 'langue', value: 'Anglais' },
      { field: 'ville', value: 'Lyon' }, { field: 'etudes', value: 'bac+5' }, { field: 'mois', value: '2026-03' },
      { field: 'fraicheur', value: '3_12_mois' }, { field: 'fraicheur', value: 'inconnue' }, { field: 'recente', value: 'dbt' },
      { field: 'tous' }, { field: 'seniors' }, { field: 'annee' },
    ]
    for (const s of selections) assert.deepEqual(parseSelection(selectionParams(s)), s)
  })

  it('écrit l’adresse de la liste et la relit à l’identique', () => {
    const selection: StatSelection = { field: 'competence', value: 'C# & .NET "Core"' }
    const href = statProfilesHref('vivier', selection, 2)
    assert.match(href, /^\/recruiter\/cvtheque\/statistiques\/profils\?/)
    const params = new URLSearchParams(href.split('?')[1])
    assert.equal(params.get('perimetre'), 'vivier')
    assert.equal(pageFromParam(params.get('page') ?? undefined), 2)
    assert.deepEqual(parseSelection({ champ: params.get('champ'), valeur: params.get('valeur') }), selection)
    assert.equal(statProfilesHref('pool', { field: 'tous' }), '/recruiter/cvtheque/statistiques/profils?champ=tous')
  })

  it('refuse ce qui n’est pas une ligne possible de la page', () => {
    for (const params of [
      {}, { champ: 'competence' }, { champ: 'competence', valeur: '   ' }, { champ: 'competence', valeur: 'x'.repeat(121) },
      { champ: 'competence', valeur: 'Py\nthon' }, { champ: 'competence', valeur: ['Python'] }, { champ: 'tenantId', valeur: 'org1' },
      { champ: 'kind', valeur: 'vivier' }, { champ: 'toString', valeur: 'x' }, { champ: '__proto__', valeur: 'x' },
      { champ: 'mois', valeur: '2026-13' }, { champ: 'mois', valeur: '2026-1' }, { champ: 'fraicheur', valeur: 'demain' },
    ]) assert.equal(parseSelection(params), null, JSON.stringify(params))
  })

  it('garde une valeur hostile entre guillemets dans le filtre', () => {
    assert.equal(meiliString('x" OR kind = "vivier'), '"x\\" OR kind = \\"vivier"')
    assert.equal(meiliString('C:\\'), '"C:\\\\"')
    const filter = selectionFilter({ field: 'competence', value: 'x\\" OR ownerId = "autre' }, now)
    assert.equal(filter, 'skills = "x\\\\\\" OR ownerId = \\"autre"')
  })

  it('filtre chaque champ sur l’attribut que la page compte', () => {
    assert.equal(selectionFilter({ field: 'famille', value: 'data_ia' }, now), 'jobFamily = "data_ia"')
    assert.equal(selectionFilter({ field: 'etudes', value: 'bac+5' }, now), 'educationLevel = "bac+5"')
    assert.equal(selectionFilter({ field: 'mois', value: '2026-03' }, now), 'cvMonth = "2026-03"')
    assert.equal(selectionFilter({ field: 'tous' }, now), '')
    assert.equal(selectionFilter({ field: 'seniors' }, now), 'seniority IN ["senior", "expert"]')
    assert.equal(selectionFilter({ field: 'fraicheur', value: 'inconnue' }, now), 'cvDate IS NULL OR cvDate NOT EXISTS')
  })

  it('découpe la fraîcheur et « depuis un an » exactement comme les comptes de la page', () => {
    // Pour chaque mois de dépôt (un mois à venir compris), la tranche de la page et celle du filtre sont les mêmes,
    // au premier et au dernier instant du mois.
    for (let back = -1; back <= 40; back++) {
      const first = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1) / 1000
      const last = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 1) / 1000 - 1
      const month = new Date(first * 1000).toISOString().slice(0, 7)
      const view = cvStatsView({ facetDistribution: { kind: { candidate: 1 }, cvMonth: { [month]: 1 } } }, now)
      const pageBucket = view.freshness[0].key
      for (const at of [first, last]) {
        const inRange = FRESHNESS.filter(b => {
          const r = freshnessRange(b.key, now)!
          return (r.from === undefined || at >= r.from) && (r.to === undefined || at < r.to)
        }).map(b => b.key)
        assert.deepEqual(inRange, [pageBucket], `${month} (${at})`)
        const sinceYear = Number(selectionFilter({ field: 'annee' }, now).replace('cvDate >= ', ''))
        assert.equal(at >= sinceYear, view.lastYearShare === 1, `depuis un an, ${month}`)
      }
    }
  })

  it('liste pour une compétence en hausse les CV récents qu’elle compte, à la même coupure', () => {
    const recent = sinceFilter('base', RISING_RECENT_MONTHS, now, 'recent').replace('base AND ', '')
    assert.equal(selectionFilter({ field: 'recente', value: 'dbt' }, now), `skills = "dbt" AND ${recent}`)
    assert.equal(selectionTitle({ field: 'recente', value: 'dbt' }), `Compétence en hausse : dbt, CV de moins de ${RISING_RECENT_MONTHS} mois`)
    assert.equal(parseSelection({ champ: 'recente', valeur: '' }), null)
  })

  it('écrit les bornes de la fraîcheur dans le filtre', () => {
    const r = freshnessRange('3_12_mois', now)!
    assert.equal(selectionFilter({ field: 'fraicheur', value: '3_12_mois' }, now), `cvDate >= ${r.from} AND cvDate < ${r.to}`)
    assert.equal(selectionFilter({ field: 'fraicheur', value: 'moins_3_mois' }, now), `cvDate >= ${freshnessRange('moins_3_mois', now)!.from}`)
    assert.equal(selectionFilter({ field: 'fraicheur', value: 'plus_2_ans' }, now), `cvDate < ${freshnessRange('plus_2_ans', now)!.to}`)
  })

  it('titre la liste avec les libellés de la page', () => {
    assert.equal(selectionTitle({ field: 'competence', value: 'Python' }), 'Compétence : Python')
    assert.equal(selectionTitle({ field: 'famille', value: 'data_ia' }), 'Famille de métiers : Data et IA')
    assert.equal(selectionTitle({ field: 'seniorite', value: 'senior' }), 'Séniorité : Senior (8 à 14 ans)')
    assert.equal(selectionTitle({ field: 'fraicheur', value: 'inconnue' }), 'Fraîcheur : Date inconnue')
    assert.match(selectionTitle({ field: 'mois', value: '2026-03' }), /^CV déposés en mars 2026$/)
  })

  it('lit le numéro de page sans dépasser ce que Meilisearch peut décaler', () => {
    assert.equal(pageFromParam('3'), 3)
    assert.equal(pageFromParam(String(MAX_PAGE)), MAX_PAGE)
    for (const v of [undefined, '', '0', '-1', '2.5', String(MAX_PAGE + 1), '1e3', ['2']]) assert.equal(pageFromParam(v), 1, String(v))
  })
})
