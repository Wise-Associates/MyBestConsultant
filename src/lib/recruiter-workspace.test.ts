import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  candidateLevel, jobOnlineStatus, sortRecruitments, summarizeRecruitments, workspaceKpis,
  type WorkspaceApplication, type WorkspaceJob, type WorkspaceJourney,
} from './recruiter-workspace'

const NOW = new Date('2026-10-31T10:00:00.000Z')
const job = (id: string, extra: Partial<WorkspaceJob> = {}): WorkspaceJob => ({
  id, title: `Offre ${id}`, isActive: true, recruiterId: 'fanny', createdAt: '2026-10-20T08:00:00.000Z', ...extra,
})
const app = (id: string, jobId: string, status = 'pending'): WorkspaceApplication => ({ id, jobId, status })

describe('niveau d’un candidat', () => {
  it('est en matching tant qu’il n’a pas eu d’entretien', () => {
    assert.equal(candidateLevel(app('a', 'j'), false, undefined), 'matching')
    assert.equal(candidateLevel(app('a', 'j', 'screening'), false, { stage: 'funnel', status: 'active' }), 'matching')
  })

  it('passe aux entretiens avec un entretien IA, l’étape « entretien » ou le parcours', () => {
    assert.equal(candidateLevel(app('a', 'j'), true, undefined), 'interview')
    assert.equal(candidateLevel(app('a', 'j', 'interview'), false, undefined), 'interview')
    assert.equal(candidateLevel(app('a', 'j'), false, { stage: 'envoi_client', status: 'active' }), 'interview')
  })

  it('est une recrue validée une fois accepté ou retenu par le client (contrat et après)', () => {
    assert.equal(candidateLevel(app('a', 'j', 'accepted'), false, undefined), 'validated')
    assert.equal(candidateLevel(app('a', 'j'), true, { stage: 'contrat', status: 'active' }), 'validated')
    assert.equal(candidateLevel(app('a', 'j'), true, { stage: 'facture', status: 'active' }), 'validated')
  })

  it('n’est plus en lice refusé ou parcours abandonné', () => {
    assert.equal(candidateLevel(app('a', 'j', 'rejected'), true, undefined), null)
    assert.equal(candidateLevel(app('a', 'j'), true, { stage: 'contrat', status: 'abandoned' }), null)
  })
})

describe('recrutements du recruteur', () => {
  it('donne le statut en ligne, expiré ou désactivé', () => {
    assert.equal(jobOnlineStatus({ isActive: true }, NOW), 'online')
    assert.equal(jobOnlineStatus({ isActive: true, expiresAt: '2026-10-30T00:00:00.000Z' }, NOW), 'expired')
    assert.equal(jobOnlineStatus({ isActive: false, expiresAt: '2026-12-01T00:00:00.000Z' }, NOW), 'inactive')
  })

  it('prend le niveau du candidat le plus avancé et compte les chiffres du haut sur les offres en ligne', () => {
    const journeys = new Map<string, WorkspaceJourney>([['a3', { stage: 'contrat', status: 'active' }]])
    const summaries = summarizeRecruitments({
      jobs: [job('j1'), job('j2'), job('j3'), job('j4', { isActive: false })],
      applications: [
        app('a1', 'j1'), app('a2', 'j1', 'rejected'),
        app('a3', 'j2'), app('a4', 'j2'),
        app('a5', 'j3'),
        app('a6', 'j4', 'accepted'),
      ],
      interviewed: new Set(['a4', 'a5']),
      journeys,
      now: NOW,
    })
    assert.deepEqual(summaries.map(s => [s.job.id, s.level, s.counts, s.closed]), [
      ['j1', 'matching', { matching: 1, interview: 0, validated: 0 }, 1],
      ['j2', 'validated', { matching: 0, interview: 1, validated: 1 }, 0],
      ['j3', 'interview', { matching: 0, interview: 1, validated: 0 }, 0],
      ['j4', 'validated', { matching: 0, interview: 0, validated: 1 }, 0],
    ])
    assert.deepEqual(workspaceKpis(summaries), { inProgress: 3, matching: 1, interview: 1, validated: 1 })
  })

  it('compte un recrutement sans candidat comme en matching', () => {
    const [summary] = summarizeRecruitments({ jobs: [job('j1')], applications: [], interviewed: new Set(), journeys: new Map(), now: NOW })
    assert.equal(summary.level, 'matching')
  })

  it('range les recrutements en ligne d’abord, puis du plus avancé au plus récent', () => {
    const summaries = summarizeRecruitments({
      jobs: [job('vieux', { createdAt: '2026-10-01T00:00:00.000Z' }), job('recent'), job('ferme', { isActive: false }), job('avance')],
      applications: [app('a1', 'avance', 'accepted'), app('a2', 'ferme', 'accepted')],
      interviewed: new Set(), journeys: new Map(), now: NOW,
    })
    assert.deepEqual(sortRecruitments(summaries).map(s => s.job.id), ['avance', 'recent', 'vieux', 'ferme'])
  })
})
