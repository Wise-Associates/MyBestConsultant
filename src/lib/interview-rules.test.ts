import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  INTERVIEW_AI_REFUSAL, INTERVIEW_INPUT_LIMITS, SCREENING_BATCH_MAX, aiQuestionPlan, analysisInputSchema, followUpInputSchema, moveInterviewQuestion,
  orderInterviewQuestions, questionsInputSchema, screeningBatch,
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

describe('ordre des questions d’un entretien (demande du 2026-11-27)', () => {
  // Questions par défaut de l'organisation, puis questions techniques ajoutées après les clôtures (cas de l'écran).
  const q = (id: string, category: 'intro' | 'technical' | 'behavioral' | 'motivation' | 'closing') => ({ id, category })
  const list = [q('intro', 'intro'), q('motiv', 'motivation'), q('comport', 'behavioral'), q('dispo', 'closing'), q('questions', 'closing'), q('react', 'technical'), q('perf', 'technical')]
  const ids = (l: { id: string }[] | null) => l?.map(x => x.id)

  it('introduction en tête, clôtures à la fin, ordre gardé dans chaque bloc', () => {
    assert.deepEqual(ids(orderInterviewQuestions(list)), ['intro', 'motiv', 'comport', 'react', 'perf', 'dispo', 'questions'])
    assert.deepEqual(ids(orderInterviewQuestions([q('fin', 'closing'), q('a', 'technical'), q('debut', 'intro')])), ['debut', 'a', 'fin'])
  })

  it('déplacer d’un cran dans son bloc, jamais au-dessus de l’introduction ni sous la clôture', () => {
    // Rangs dans l'ordre de l'entretien : 0 intro, 1 motiv, 2 comport, 3 react, 4 perf, 5 dispo, 6 questions.
    assert.deepEqual(ids(moveInterviewQuestion(list, 3, -1)), ['intro', 'motiv', 'react', 'comport', 'perf', 'dispo', 'questions'])
    assert.deepEqual(ids(moveInterviewQuestion(list, 6, -1)), ['intro', 'motiv', 'comport', 'react', 'perf', 'questions', 'dispo'])
    assert.equal(moveInterviewQuestion(list, 1, -1), null, 'au-dessus de l’introduction')
    assert.equal(moveInterviewQuestion(list, 4, 1), null, 'sous une clôture')
    assert.equal(moveInterviewQuestion(list, 0, -1), null)
    assert.equal(moveInterviewQuestion(list, 6, 1), null)
  })
})
