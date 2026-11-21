import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseTunedQuestions, tuningSystemPrompt, tuningUserMessage } from './interview-question-tuning'

const mine = [
  { text: 'tu connais react ?', category: 'technical' as const },
  { text: 'pourquoi nous', category: 'motivation' as const },
]

describe('questions ajustées par l\'IA (« Retravailler et compléter », ADR 0054)', () => {
  it('demande de garder le sens et l\'ordre, et de compléter jusqu\'au nombre choisi', () => {
    const system = tuningSystemPrompt()
    assert.match(system, /sans en changer le sens ni l'ordre/)
    assert.match(system, /Ne supprime aucune question/)
    assert.match(system, /données/)
    const user = tuningUserMessage({ jobTitle: 'Développeur React', jobSkills: ['React', 'TypeScript'], jobDescription: 'Mission longue', cvSummary: '5 ans de React', questions: mine, targetCount: 5 })
    assert.match(user, /Développeur React/)
    assert.match(user, /1\. \[technical\] tu connais react \?/)
    assert.match(user, /2\. \[motivation\] pourquoi nous/)
    assert.match(user, /ajoute 3 questions/)
  })

  it('n\'ajoute rien quand le recruteur a déjà assez de questions', () => {
    const user = tuningUserMessage({ jobTitle: 'X', jobSkills: [], jobDescription: '', cvSummary: '', questions: mine, targetCount: 2 })
    assert.match(user, /n'en ajoute aucune/)
  })

  it('lit une réponse valide, même entourée de texte', () => {
    const content = 'Voici :\n[{"text":"Quelle est votre expérience de React ?","category":"technical"},{"text":"Qu\'est-ce qui vous attire dans notre entreprise ?","category":"motivation"},{"text":"Décrivez un projet réussi.","category":"behavioral"}]'
    assert.deepEqual(parseTunedQuestions(content, 2, 3), [
      { text: 'Quelle est votre expérience de React ?', category: 'technical' },
      { text: 'Qu\'est-ce qui vous attire dans notre entreprise ?', category: 'motivation' },
      { text: 'Décrivez un projet réussi.', category: 'behavioral' },
    ])
  })

  it('refuse une réponse qui perd des questions du recruteur ou en ajoute trop', () => {
    const one = '[{"text":"Quelle est votre expérience de React ?","category":"technical"}]'
    assert.equal(parseTunedQuestions(one, 2, 5), null)
    const four = JSON.stringify(Array.from({ length: 4 }, (_, i) => ({ text: `Question numéro ${i + 1} ?`, category: 'technical' })))
    assert.equal(parseTunedQuestions(four, 2, 3), null)
    assert.equal(parseTunedQuestions(four, 4, 2)?.length, 4, 'plus de questions que le nombre choisi : toutes retravaillées, aucune ajoutée')
  })

  it('refuse une réponse illisible, une catégorie inconnue ou une question vide', () => {
    assert.equal(parseTunedQuestions('Je ne peux pas.', 1, 1), null)
    assert.equal(parseTunedQuestions('[{"text":"Question correcte ?","category":"autre"}]', 1, 1), null)
    assert.equal(parseTunedQuestions('[{"text":"  ","category":"technical"}]', 1, 1), null)
    assert.equal(parseTunedQuestions('[{"text":"Question correcte ?","category":"technical"}', 1, 1), null)
  })
})
