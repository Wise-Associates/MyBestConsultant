import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  INTERVIEW_AI_REFUSAL, INTERVIEW_INPUT_LIMITS, SCREENING_BATCH_MAX, aiQuestionPlan, analysisInputSchema, followUpInputSchema, questionsInputSchema, screeningBatch,
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

describe('nombre de questions d\'un entretien (demande du 2026-11-21)', () => {
  const defaults = ['intro', 'motivation', 'behavioral', 'closing', 'closing'] as const

  it('compte les questions par défaut dans le nombre choisi : l\'IA n\'écrit que les manquantes', () => {
    const plan = aiQuestionPlan(8, defaults)
    assert.equal(plan.count, 3)
    assert.equal(Object.values(plan.mix).reduce((a, b) => a + b, 0), 3)
    // Introduction et clôture déjà posées par les questions par défaut : l'IA n'en refait pas.
    assert.equal(plan.mix.intro, undefined)
    assert.equal(plan.mix.closing, undefined)
    assert.ok((plan.mix.technical ?? 0) >= 2)
  })

  it('n\'appelle pas l\'IA quand les questions par défaut suffisent', () => {
    assert.deepEqual(aiQuestionPlan(4, defaults), { count: 0, mix: {} })
    assert.deepEqual(aiQuestionPlan(5, defaults), { count: 0, mix: {} })
  })

  it('répartit toutes les questions sans questions par défaut', () => {
    const plan = aiQuestionPlan(10, [])
    assert.equal(plan.count, 10)
    assert.equal(Object.values(plan.mix).reduce((a, b) => a + b, 0), 10)
    assert.equal(plan.mix.intro, 1)
    assert.equal(plan.mix.closing, 1)
    for (const n of [3, 4, 7, 15]) assert.equal(Object.values(aiQuestionPlan(n, []).mix).reduce((a, b) => a + b, 0), n, `${n} questions`)
  })
})
