import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { expiresInDays, jobFacts, jobState, relativeAge, summarize, type DashboardApp } from './recruiter-dashboard'

const now = new Date('2026-11-02T10:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString()
const inDays = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString()
const keys = { newStatus: 'pending', acceptedStatus: 'accepted' }
const app = (status: string, ageDays: number, aiScore?: number): DashboardApp => ({ status, createdAt: daysAgo(ageDays), aiScore })

describe('état d\'une offre', () => {
  it('distingue en ligne, expirée et archivée', () => {
    assert.equal(jobState({ isActive: true }, now), 'online')
    assert.equal(jobState({ isActive: true, expiresAt: inDays(3) }, now), 'online')
    assert.equal(jobState({ isActive: true, expiresAt: daysAgo(1) }, now), 'expired')
    assert.equal(jobState({ isActive: false, expiresAt: inDays(3) }, now), 'archived')
  })

  it('signale une offre en ligne qui expire dans 7 jours ou moins', () => {
    assert.equal(expiresInDays({ isActive: true, expiresAt: inDays(3) }, now), 3)
    assert.equal(expiresInDays({ isActive: true, expiresAt: inDays(0.2) }, now), 1)
    assert.equal(expiresInDays({ isActive: true, expiresAt: inDays(7) }, now), 7)
    assert.equal(expiresInDays({ isActive: true, expiresAt: inDays(8) }, now), null)
    assert.equal(expiresInDays({ isActive: true }, now), null)
    assert.equal(expiresInDays({ isActive: true, expiresAt: daysAgo(1) }, now), null, 'déjà expirée')
    assert.equal(expiresInDays({ isActive: false, expiresAt: inDays(2) }, now), null, 'archivée')
  })
})

describe('âge affiché', () => {
  it('écrit l\'âge en jours, semaines, mois puis années', () => {
    assert.equal(relativeAge(daysAgo(0.5), now), 'aujourd’hui')
    assert.equal(relativeAge(daysAgo(1.5), now), 'hier')
    assert.equal(relativeAge(daysAgo(3), now), 'il y a 3 j')
    assert.equal(relativeAge(daysAgo(15), now), 'il y a 2 sem.')
    assert.equal(relativeAge(daysAgo(65), now), 'il y a 2 mois')
    assert.equal(relativeAge(daysAgo(400), now), 'il y a 1 an')
    assert.equal(relativeAge(daysAgo(800), now), 'il y a 2 ans')
    assert.equal(relativeAge(inDays(1), now), 'aujourd’hui', 'date future (horloges décalées)')
  })
})

describe('faits d\'une ligne de « Mes offres »', () => {
  it('compte candidatures, nouvelles et score moyen', () => {
    const facts = jobFacts({ isActive: true }, [app('pending', 1, 80), app('pending', 2), app('interview', 9, 61)], keys, undefined, now)
    assert.deepEqual(facts, { state: 'online', expiresInDays: null, applications: 3, newApplications: 2, avgScore: 71, diffusionFailed: false })
  })

  it('ne signale une diffusion en échec que pour une offre en ligne', () => {
    assert.equal(jobFacts({ isActive: true }, [], keys, 'failed', now).diffusionFailed, true)
    assert.equal(jobFacts({ isActive: false }, [], keys, 'failed', now).diffusionFailed, false)
    assert.equal(jobFacts({ isActive: true }, [], keys, 'published', now).diffusionFailed, false)
  })

  it('n\'a pas de score sans candidature notée', () => {
    assert.equal(jobFacts({ isActive: true }, [app('pending', 1)], keys, undefined, now).avgScore, null)
  })
})

describe('indicateurs du tableau de bord', () => {
  it('compte toutes les offres : en ligne d\'un côté, archivées et expirées de l\'autre', () => {
    const jobs = [
      ...Array.from({ length: 140 }, () => ({ isActive: true })),
      { isActive: true, expiresAt: daysAgo(2) },
      { isActive: false },
    ]
    assert.deepEqual(summarize(jobs, [], keys, now).jobs, { total: 142, online: 140, offline: 2 })
  })

  it('calcule candidatures, semaines, score, taux de sélection et nouvelles', () => {
    const byJob = [
      [app('pending', 0.5, 90), app('pending', 3), app('accepted', 8, 70)],
      [app('rejected', 20, 40), app('pending', 100)],
      [app('interview', 6.9)],
    ]
    const { applications } = summarize([], byJob, keys, now)
    assert.equal(applications.total, 6)
    // Semaine 0 = les 7 derniers jours (3 candidatures), semaine 1 (8 j), semaine 2 (20 j) ; 100 j est hors graphique.
    assert.deepEqual(applications.weekly, [0, 0, 0, 0, 0, 1, 1, 3])
    assert.equal(applications.scored, 3)
    assert.equal(applications.avgScore, 67)
    assert.equal(applications.accepted, 1)
    assert.equal(applications.selectionRate, 17)
    assert.equal(applications.new, 3)
    assert.equal(applications.jobsWithNew, 2)
  })

  it('n\'invente aucun chiffre sans candidature', () => {
    const { applications } = summarize([{ isActive: true }], [], keys, now)
    assert.equal(applications.avgScore, null)
    assert.equal(applications.selectionRate, null)
    assert.deepEqual(applications.weekly, [0, 0, 0, 0, 0, 0, 0, 0])
  })
})
