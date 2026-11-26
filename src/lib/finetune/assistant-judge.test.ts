import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ASSISTANT_EVAL_QUESTIONS, acceptable, evalQuestionsInTraining, judgeCostUsd, judgeSystem, judgeUser, parseVerdict, summarizeVerdicts,
} from './assistant-judge'

const verdict = (exactitude: string, invention = false, consignes = true) => JSON.stringify({ exactitude, invention, consignes, motif: 'm' })

describe("mesure de l'assistant IA par un juge", () => {
  it('aucune question de mesure n’est un exemple d’entraînement', () => {
    assert.deepEqual(evalQuestionsInTraining(), [])
    assert.deepEqual(evalQuestionsInTraining([{ role: 'candidate', question: 'Faut-il être connecté pour passer l’entretien IA ?!' }]), ['Faut-il être connecté pour passer l’entretien IA ?'])
  })

  it('pose des questions aux deux rôles', () => {
    assert.ok(ASSISTANT_EVAL_QUESTIONS.some(q => q.role === 'candidate'))
    assert.ok(ASSISTANT_EVAL_QUESTIONS.some(q => q.role === 'recruiter'))
  })

  it('donne au juge les consignes et le contenu d’aide du rôle', () => {
    assert.match(judgeSystem('recruiter'), /L'UTILISATEUR EST RECRUTEUR/)
    assert.match(judgeSystem('candidate'), /L'UTILISATEUR EST CANDIDAT/)
  })

  it('montre la conversation et isole la dernière réponse', () => {
    const user = judgeUser([
      { role: 'user', content: 'Q1' }, { role: 'assistant', content: 'R1' }, { role: 'user', content: 'Q2' }, { role: 'assistant', content: 'R2' },
    ])
    assert.match(user, /<utilisateur>\nQ1\n<\/utilisateur>\n<assistant>\nR1\n<\/assistant>\n<utilisateur>\nQ2\n<\/utilisateur>/)
    assert.match(user, /<reponse>\nR2\n<\/reponse>$/)
    assert.throws(() => judgeUser([{ role: 'user', content: 'Q' }]))
  })

  it('lit un jugement complet, entouré de texte ou non, et refuse le reste', () => {
    assert.deepEqual(parseVerdict(`Voici : ${verdict('juste')}`), { exactitude: 'juste', invention: false, consignes: true, motif: 'm' })
    assert.equal(parseVerdict(verdict('correcte')), null)
    assert.equal(parseVerdict('{"exactitude": "juste"}'), null)
    assert.equal(parseVerdict('pas de JSON'), null)
    assert.equal(parseVerdict('{"exactitude": "juste",'), null)
  })

  it('n’accepte qu’une réponse juste, sans invention, dans les consignes', () => {
    const ok = parseVerdict(verdict('juste'))!
    assert.equal(acceptable(ok), true)
    assert.equal(acceptable({ ...ok, invention: true }), false)
    assert.equal(acceptable({ ...ok, consignes: false }), false)
    assert.equal(acceptable({ ...ok, exactitude: 'incomplete' }), false)
  })

  it('compte les réponses non jugées à part', () => {
    const s = summarizeVerdicts([parseVerdict(verdict('juste')), parseVerdict(verdict('fausse', true)), null, parseVerdict(verdict('incomplete', false, false))])
    assert.deepEqual(s, { answers: 4, judged: 3, acceptable: 1, juste: 1, incomplete: 1, fausse: 1, inventions: 1, offRules: 1 })
  })

  it('calcule le coût d’un appel, cache compris', () => {
    const usd = judgeCostUsd({ input_tokens: 1_000_000, output_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 })
    assert.equal(usd, 4 + 20 + 5 + 0.2)
  })
})
