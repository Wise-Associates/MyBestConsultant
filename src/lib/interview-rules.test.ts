import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  INTERVIEW_AI_REFUSAL, INTERVIEW_INPUT_LIMITS, SCREENING_BATCH_MAX, analysisInputSchema, followUpInputSchema, questionsInputSchema, screeningBatch,
} from './interview-rules'

const turn = (content: string) => ({ role: 'candidate' as const, content, timestamp: '2026-11-13T10:00:00.000Z' })

describe('textes envoyés à l\'IA des entretiens', () => {
  it('coupe les textes longs au lieu de refuser une offre importée', () => {
    const parsed = questionsInputSchema.parse({
      jobTitle: 'Chef de projet', jobDescription: 'x'.repeat(60_000), jobSkills: Array(80).fill('Java'), cvSummary: 'Résumé', questionCount: 8,
    })
    assert.equal(parsed.jobDescription.length, INTERVIEW_INPUT_LIMITS.longText)
    assert.equal(parsed.jobSkills.length, INTERVIEW_INPUT_LIMITS.skills)
  })

  it('refuse un nombre de questions hors bornes ou un type inattendu', () => {
    const base = { jobTitle: 'Poste', jobDescription: '', jobSkills: [], cvSummary: '' }
    assert.equal(questionsInputSchema.safeParse({ ...base, questionCount: 500 }).success, false)
    assert.equal(questionsInputSchema.safeParse({ ...base, questionCount: 8, jobSkills: 'Java' }).success, false)
  })

  it('ne lit que les 4 dernières répliques pour une relance, chacune bornée', () => {
    const parsed = followUpInputSchema.parse({
      transcript: Array.from({ length: 10 }, (_, i) => turn(`r${i}`)),
      currentQuestion: { id: 'q1', text: 'Présentez-vous', category: 'intro', aiGenerated: true },
      candidateAnswer: 'a'.repeat(20_000),
    })
    assert.deepEqual(parsed.transcript.map(t => t.content), ['r6', 'r7', 'r8', 'r9'])
    assert.equal(parsed.candidateAnswer.length, INTERVIEW_INPUT_LIMITS.answer)
  })

  it('borne la retranscription analysée et l\'identifiant de session', () => {
    assert.equal(analysisInputSchema.safeParse({ sessionId: '../x', transcript: [], jobTitle: '', jobSkills: [] }).success, false)
    assert.equal(analysisInputSchema.safeParse({ sessionId: 's1', transcript: Array(INTERVIEW_INPUT_LIMITS.turns + 1).fill(turn('x')), jobTitle: '', jobSkills: [] }).success, false)
    assert.equal(analysisInputSchema.parse({ sessionId: 's1', transcript: [turn('y'.repeat(9000))], jobTitle: '', jobSkills: [] }).transcript[0].content.length, INTERVIEW_INPUT_LIMITS.turn)
  })
})

describe('demande de screening', () => {
  it('dédoublonne et borne les candidatures, refuse des identifiants invalides', () => {
    assert.deepEqual(screeningBatch(['a1', 'a1', 'b2']), ['a1', 'b2'])
    assert.equal(screeningBatch(Array.from({ length: 150 }, (_, i) => `a${i}`))?.length, SCREENING_BATCH_MAX)
    assert.equal(screeningBatch(['a1', '../x']), null)
    assert.equal(screeningBatch('a1'), null)
  })

  it('donne la limite de l\'organisation dans le refus', () => {
    assert.match(INTERVIEW_AI_REFUSAL.organisation(7), /Limite de 7 analyses/)
  })
})
