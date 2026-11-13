import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Job } from '@/types'
import { isNewJob, jobFacets, publishedAgo, skillsPreview } from './job-listing'

const job = (contractType: string, remote: string, id = Math.random().toString(36).slice(2)) =>
  ({ $id: id, contractType, remote, title: 't', description: '', skills: [], location: '', isActive: true, tenantId: '', createdAt: '' }) as unknown as Job

const NOW = Date.parse('2026-11-13T12:00:00.000Z')

describe('liste publique des offres', () => {
  const jobs = [job('mission', 'hybrid'), job('mission', 'onsite'), job('cdi', 'hybrid'), job('freelance', 'remote'), job('cdi', 'onsite')]

  it('compte dans « Tous » aussi les offres sans contrat ni télétravail renseigné', () => {
    const facets = jobFacets([...jobs, job('', '')], {})
    assert.equal(facets.contractTotal, 6)
    assert.equal(facets.remoteTotal, 6)
    assert.equal(Object.values(facets.contractCounts).reduce((a, b) => a + b, 0), 5)
  })

  it('compte chaque choix avec les autres filtres gardés', () => {
    const all = jobFacets(jobs, {})
    assert.equal(all.results.length, 5)
    assert.deepEqual(all.contractCounts, { mission: 2, cdi: 2, freelance: 1 })
    assert.deepEqual(all.remoteCounts, { hybrid: 2, onsite: 2, remote: 1 })

    const hybridMissions = jobFacets(jobs, { contract: 'mission', remote: 'hybrid' })
    assert.equal(hybridMissions.results.length, 1)
    // Contrats : parmi les offres hybrides ; télétravail : parmi les missions.
    assert.deepEqual(hybridMissions.contractCounts, { mission: 1, cdi: 1 })
    assert.deepEqual(hybridMissions.remoteCounts, { hybrid: 1, onsite: 1 })
  })

  it('marque « Nouveau » une offre de moins de 3 jours', () => {
    assert.equal(isNewJob('2026-11-12T12:00:00.000Z', NOW), true)
    assert.equal(isNewJob('2026-11-10T12:00:00.000Z', NOW), false)
    assert.equal(isNewJob('pas une date', NOW), false)
  })

  it('dit depuis quand l\'offre est publiée', () => {
    assert.equal(publishedAgo('2026-11-13T09:00:00.000Z', NOW), 'il y a 3 h')
    assert.equal(publishedAgo('2026-11-12T11:00:00.000Z', NOW), 'il y a 1 j')
    assert.equal(publishedAgo('2026-11-05T12:00:00.000Z', NOW), 'il y a 1 sem.')
    assert.equal(publishedAgo('2026-10-29T12:00:00.000Z', NOW), 'il y a 2 sem.')
    assert.equal(publishedAgo('2026-08-01T12:00:00.000Z', NOW), 'il y a 3 mois')
  })

  it('montre les compétences qui tiennent sur une ligne et compte les autres', () => {
    assert.deepEqual(skillsPreview(['Python', 'Spark', 'SQL', 'Airflow', 'AWS']), { shown: ['Python', 'Spark', 'SQL'], more: 2 })
    assert.deepEqual(skillsPreview([' AMOA ', '']), { shown: ['AMOA'], more: 0 })
    assert.deepEqual(skillsPreview(['Logiciels systèmes', 'Logiciels bureautiques', 'Architecture client/serveur']), { shown: ['Logiciels systèmes'], more: 2 })
    // Une seule compétence très longue est montrée quand même (coupée à l'affichage).
    assert.deepEqual(skillsPreview(['Management de la qualité et des risques opérationnels']).shown.length, 1)
  })
})
