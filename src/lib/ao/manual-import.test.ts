import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { manualImportRequest, parseManualImportResponse } from './manual-import'

const now = new Date('2026-11-25T10:00:00.000Z')

describe('manualImportRequest', () => {
  it('présente le texte du document, coupé à 40 000 caractères', () => {
    assert.equal(manualImportRequest('Offre fictive'), 'Voici le texte du document d\'appels d\'offres :\n\nOffre fictive')
    assert.equal(manualImportRequest('é'.repeat(45_000)).length, 'Voici le texte du document d\'appels d\'offres :\n\n'.length + 40_000)
  })
})

describe('parseManualImportResponse', () => {
  it('lit un tableau entre balises et place les dates sans libellé selon leur jour', () => {
    const jobs = parseManualImportResponse('```json\n[{"title":"Développeur","startDate":"","deadline":"","otherDates":["lundi 7 décembre 2026","vendredi 4 décembre 2026"]}]\n```', now)
    assert.equal(jobs.length, 1)
    const job = jobs[0] as Record<string, unknown>
    assert.equal(job.title, 'Développeur')
    assert.equal('otherDates' in job, false)
    assert.ok(typeof job.startDate === 'string' && job.startDate.includes('7'))
    assert.ok(typeof job.deadline === 'string' && job.deadline.includes('4'))
  })

  it('garde tels quels les éléments qui ne sont pas des objets', () => {
    assert.deepEqual(parseManualImportResponse('[null, 3]', now), [null, 3])
  })

  it('lève si la réponse n’est pas un tableau JSON', () => {
    assert.throws(() => parseManualImportResponse('{"title":"seul"}', now), /attendu un tableau/)
    assert.throws(() => parseManualImportResponse('[{"title":', now))
  })
})
