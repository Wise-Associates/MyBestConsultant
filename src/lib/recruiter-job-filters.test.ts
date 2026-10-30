import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_JOB_FILTERS, filterJobs, isFiltering, type JobFilters } from './recruiter-job-filters'

const jobs = [
  { $id: 'a', title: 'Développeur React', location: 'Lyon', isActive: true, contractType: 'freelance' as const, companyName: 'Client Fictif' },
  { $id: 'b', title: 'Chef de projet Data', location: 'Paris', isActive: false, contractType: 'cdi' as const },
  { $id: 'c', title: 'Ingénieur DevOps', location: 'Île-de-France', isActive: true, contractType: undefined },
]
const ids = (over: Partial<JobFilters>) => filterJobs(jobs, { ...EMPTY_JOB_FILTERS, ...over }).map(j => j.$id)

describe('filtres de « Mes offres »', () => {
  it('garde toutes les offres sans filtre', () => {
    assert.deepEqual(ids({}), ['a', 'b', 'c'])
    assert.equal(isFiltering(EMPTY_JOB_FILTERS), false)
  })

  it('cherche dans l\'intitulé, la ville et l\'entreprise, sans casse ni accents', () => {
    assert.deepEqual(ids({ q: 'developpeur' }), ['a'])
    assert.deepEqual(ids({ q: 'ILE-DE' }), ['c'])
    assert.deepEqual(ids({ q: 'client fictif' }), ['a'])
    assert.deepEqual(ids({ q: '   ' }), ['a', 'b', 'c'])
  })

  it('filtre sur le statut et le contrat, et combine les filtres', () => {
    assert.deepEqual(ids({ status: 'active' }), ['a', 'c'])
    assert.deepEqual(ids({ status: 'archived' }), ['b'])
    assert.deepEqual(ids({ contract: 'cdi' }), ['b'])
    assert.deepEqual(ids({ status: 'active', contract: 'cdi' }), [])
    assert.equal(isFiltering({ ...EMPTY_JOB_FILTERS, contract: 'cdi' }), true)
  })
})
