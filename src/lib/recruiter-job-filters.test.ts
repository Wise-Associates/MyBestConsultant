import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_JOB_FILTERS, filterJobs, isFiltering, jobFiltersFromSearchParams, matchesFocus, parseRecruiterSelection, recruiterSelectionParam,
  withJobFilters, type JobFilters,
} from './recruiter-job-filters'
import type { JobFacts } from './recruiter-dashboard'

const facts = (over: Partial<JobFacts> = {}): JobFacts => ({
  state: 'online', expiresInDays: null, applications: 0, newApplications: 0, avgScore: null, diffusionFailed: false, ...over,
})

const rows = [
  { id: 'a', job: { title: 'Développeur React', location: 'Lyon', contractType: 'freelance' as const, companyName: 'Client Fictif', createdAt: '2026-10-30T00:00:00Z', expiresAt: '2026-11-20T00:00:00Z' },
    facts: facts({ applications: 4, newApplications: 2, avgScore: 72 }) },
  { id: 'b', job: { title: 'Chef de projet Data', location: 'Paris', contractType: 'cdi' as const, createdAt: '2026-10-01T00:00:00Z' },
    facts: facts({ state: 'archived', applications: 9, avgScore: 55 }) },
  { id: 'c', job: { title: 'Ingénieur DevOps', location: 'Île-de-France', contractType: undefined, createdAt: '2026-10-20T00:00:00Z', expiresAt: '2026-11-05T00:00:00Z' },
    facts: facts({ expiresInDays: 3, diffusionFailed: true }) },
  { id: 'd', job: { title: 'Architecte cloud', location: 'Nantes', contractType: 'mission' as const, createdAt: '2026-10-25T00:00:00Z', expiresAt: '2026-10-28T00:00:00Z' },
    facts: facts({ state: 'expired', applications: 1, avgScore: 90 }) },
]
const ids = (over: Partial<JobFilters>) => filterJobs(rows, { ...EMPTY_JOB_FILTERS, ...over }).map(r => r.id)

describe('filtres de « Mes offres »', () => {
  it('garde toutes les offres sans filtre, les plus récentes d\'abord', () => {
    assert.deepEqual(ids({}), ['a', 'd', 'c', 'b'])
    assert.equal(isFiltering(EMPTY_JOB_FILTERS), false)
  })

  it('cherche dans l\'intitulé, la ville et l\'entreprise, sans casse ni accents', () => {
    assert.deepEqual(ids({ q: 'developpeur' }), ['a'])
    assert.deepEqual(ids({ q: 'ILE-DE' }), ['c'])
    assert.deepEqual(ids({ q: 'client fictif' }), ['a'])
    assert.deepEqual(ids({ q: '   ' }), ['a', 'd', 'c', 'b'])
  })

  it('range une offre expirée avec les archivées, jamais avec celles en ligne', () => {
    assert.deepEqual(ids({ status: 'active' }), ['a', 'c'])
    assert.deepEqual(ids({ status: 'archived' }), ['d', 'b'])
  })

  it('filtre sur le contrat et combine les filtres', () => {
    assert.deepEqual(ids({ contract: ['cdi'] }), ['b'])
    assert.deepEqual(ids({ status: 'active', contract: ['cdi'] }), [])
    assert.equal(isFiltering({ ...EMPTY_JOB_FILTERS, contract: ['cdi'] }), true)
    // Choix multiple : une offre passe si son contrat est l'un des contrats choisis ; une offre sans contrat, jamais.
    assert.deepEqual(ids({ contract: ['cdi', 'mission'] }).sort(), ['b', 'd'])
  })

  it('garde les offres d\'une tuile « À traiter »', () => {
    assert.deepEqual(ids({ focus: 'new' }), ['a'])
    assert.deepEqual(ids({ focus: 'noApplications' }), ['c'], 'en ligne et sans candidature')
    assert.deepEqual(ids({ focus: 'diffusionFailed' }), ['c'])
    assert.deepEqual(ids({ focus: 'expiringSoon' }), ['c'])
    assert.equal(isFiltering({ ...EMPTY_JOB_FILTERS, focus: 'new' }), true)
    assert.equal(matchesFocus(facts({ state: 'archived' }), 'noApplications'), false, 'une offre archivée n\'attend plus de candidature')
  })

  it('trie sans filtrer', () => {
    assert.deepEqual(ids({ sort: 'applications' }), ['b', 'a', 'd', 'c'])
    assert.deepEqual(ids({ sort: 'score' }), ['d', 'a', 'b', 'c'], 'sans score en dernier')
    assert.deepEqual(ids({ sort: 'expiry' }), ['c', 'a', 'd', 'b'], 'échéance des offres en ligne d\'abord, puis les plus récentes')
    assert.equal(isFiltering({ ...EMPTY_JOB_FILTERS, sort: 'score' }), false)
  })
})

describe('filtre par recruteur (adresse de la page)', () => {
  const team = ['profil1', 'profil2', 'profil3']

  it('garde les recruteurs de l’équipe et « Non affectées », dans l’ordre de l’équipe', () => {
    assert.deepEqual(parseRecruiterSelection('profil3,aucun,profil1', team), { ids: ['profil1', 'profil3'], unassigned: true })
    assert.deepEqual(parseRecruiterSelection('aucun', team), { ids: [], unassigned: true })
    assert.deepEqual(parseRecruiterSelection(['profil2', 'profil2'], team), { ids: ['profil2'], unassigned: false }, 'paramètre répété')
  })

  it('ignore un recruteur hors de l’équipe ; sans valeur retenue, toutes les offres', () => {
    assert.deepEqual(parseRecruiterSelection('profil1,autre-org', team), { ids: ['profil1'], unassigned: false })
    assert.equal(parseRecruiterSelection('autre-org', team), null)
    assert.equal(parseRecruiterSelection('', team), null)
    assert.equal(parseRecruiterSelection(undefined, team), null)
  })

  it('écrit la sélection dans l’adresse, relue à l’identique', () => {
    const selection = { ids: ['profil1', 'profil3'], unassigned: true }
    assert.equal(recruiterSelectionParam(selection), 'profil1,profil3,aucun')
    assert.deepEqual(parseRecruiterSelection(recruiterSelectionParam(selection), team), selection)
    assert.equal(recruiterSelectionParam({ ids: [], unassigned: false }), '')
  })
})

describe('filtres de « Mes offres » dans l’adresse', () => {
  it('relit à l’identique les filtres écrits', () => {
    const f: JobFilters = { q: 'développeur java', status: 'archived', contract: ['freelance', 'mission'], focus: 'expiringSoon', sort: 'score' }
    const params = withJobFilters(new URLSearchParams(), f)
    assert.equal(params.toString(), 'q=d%C3%A9veloppeur+java&status=archived&contract=freelance%2Cmission&focus=expiringSoon&sort=score')
    assert.deepEqual(jobFiltersFromSearchParams(params), f)
  })

  it('n’écrit pas les valeurs par défaut et garde les autres paramètres de la page', () => {
    const params = withJobFilters(new URLSearchParams('recruteurs=aucun&q=ancienne&sort=score'), EMPTY_JOB_FILTERS)
    assert.equal(params.toString(), 'recruteurs=aucun')
  })

  it('ignore une valeur inconnue (adresse modifiée, ancien lien)', () => {
    const f = jobFiltersFromSearchParams(new URLSearchParams('status=supprimees&contract=stage&focus=tout&sort=hasard'))
    assert.deepEqual(f, EMPTY_JOB_FILTERS)
  })

  it('relit les contrats sans doublon, dans un ordre fixe, et les anciens liens à un seul contrat', () => {
    assert.deepEqual(jobFiltersFromSearchParams(new URLSearchParams('contract=mission,cdi,stage,cdi')).contract, ['cdi', 'mission'])
    assert.deepEqual(jobFiltersFromSearchParams(new URLSearchParams('contract=cdd')).contract, ['cdd'])
    assert.equal(withJobFilters(new URLSearchParams(), { ...EMPTY_JOB_FILTERS, contract: ['mission', 'cdi'] }).get('contract'), 'cdi,mission')
  })

  it('borne la recherche relue', () => {
    assert.equal(jobFiltersFromSearchParams(new URLSearchParams({ q: 'x'.repeat(500) })).q.length, 200)
  })
})
