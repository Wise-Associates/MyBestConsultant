import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { answerText, answersSchema, briefWithAnswers, criteriaForAi, parseQuestionsAnswer, parseRefinement } from './conversation'
import type { MbcCriteria } from './rules'

const criteria: MbcCriteria = {
  titles: ['Java Developer'], locations: ['Paris, France'], seniorities: ['senior'], skills: ['Java', 'Spring'],
  requiredSkills: ['Java'], sectors: [], emailOnly: true, recentOnly: false,
}

describe('questions de l\'IA avant la recherche', () => {
  it('lit la phrase et les questions, même entourées de texte ou d\'un bloc de code', () => {
    const text = 'Voici :\n```json\n{"reply": "Java est le socle.", "questions": [{"question": "Quel type de développement ?", "options": ["Back-end", "Full-stack", "Peu importe"]}]}\n```'
    assert.deepEqual(parseQuestionsAnswer(text), {
      reply: 'Java est le socle.',
      questions: [{ question: 'Quel type de développement ?', options: ['Back-end', 'Full-stack', 'Peu importe'] }],
    })
  })

  it('garde 3 questions et 4 réponses au plus, sans doublon ni réponse vide', () => {
    const q = (n: number) => ({ question: `Q${n}`, options: ['A', 'a', ' ', 'B', 'C', 'D', 'E'] })
    const res = parseQuestionsAnswer(JSON.stringify({ reply: 'ok', questions: [q(1), q(2), q(3), q(4)] }))
    assert.equal(res?.questions.length, 3)
    assert.deepEqual(res?.questions[0].options, ['A', 'B', 'C', 'D'])
  })

  it('écarte une question sans au moins deux réponses proposées, ou sans texte', () => {
    const res = parseQuestionsAnswer(JSON.stringify({ questions: [{ question: 'Seule ?', options: ['Oui'] }, { question: ' ', options: ['A', 'B'] }, 'texte'] }))
    assert.deepEqual(res, { reply: '', questions: [] })
  })

  it('tait la phrase de l\'IA quand toutes ses questions sont écartées (elle les annoncerait sans qu\'elles s\'affichent)', () => {
    const res = parseQuestionsAnswer(JSON.stringify({ reply: 'Quelques précisions :', questions: [{ question: 'Seule ?', options: ['Oui'] }] }))
    assert.deepEqual(res, { reply: '', questions: [] })
    assert.equal(parseQuestionsAnswer(JSON.stringify({ reply: 'Votre besoin est clair.', questions: [] }))?.reply, 'Votre besoin est clair.')
  })

  it('renvoie null sur une réponse qui n\'est pas un objet JSON', () => {
    assert.equal(parseQuestionsAnswer('Je ne peux pas répondre.'), null)
    assert.equal(parseQuestionsAnswer('{"reply": "coupé'), null)
    assert.equal(parseQuestionsAnswer('[1, 2]'), null)
  })
})

describe('brief complété par les réponses du recruteur', () => {
  it('ajoute les réponses cochées et libres, et omet les questions passées', () => {
    const answers = answersSchema.parse([
      { question: 'Quel type de développement ?', choices: ['Back-end'], text: 'surtout des API' },
      { question: 'Quelle séniorité ?', choices: [], text: '' },
      { question: 'Quel lieu ?', choices: ['Paris', 'Lyon'], text: '' },
    ])
    assert.equal(briefWithAnswers('  Développeur Java  ', answers),
      'Développeur Java\n\nPrécisions du recruteur :\n- Quel type de développement ? → Back-end ; surtout des API\n- Quel lieu ? → Paris ; Lyon')
  })

  it('écrit une réponse en une ligne : réponses cochées puis réponse libre ; vide pour une question passée', () => {
    assert.equal(answerText({ question: 'Q', choices: ['Back-end', 'API'], text: ' surtout Kafka ' }), 'Back-end ; API ; surtout Kafka')
    assert.equal(answerText({ question: 'Q', choices: [], text: '  ' }), '')
  })

  it('rend le brief seul sans réponse', () => {
    assert.equal(briefWithAnswers('Développeur Java', []), 'Développeur Java')
  })

  it('refuse plus de 3 réponses ou une réponse libre trop longue', () => {
    const a = { question: 'Q', choices: [], text: '' }
    assert.equal(answersSchema.safeParse([a, a, a, a]).success, false)
    assert.equal(answersSchema.safeParse([{ ...a, text: 'x'.repeat(501) }]).success, false)
  })
})

describe('critères ajustés après un message du recruteur', () => {
  it('lit les nouveaux critères et garde les filtres de la recherche en cours', () => {
    const text = JSON.stringify({
      reply: 'J\'ajoute Kafka et je retire Paris.',
      criteria: { titles: ['Java Developer'], locations: [], seniorities: ['senior', 'inconnu'], skills: ['Java', 'Kafka'], requiredSkills: ['Kafka', 'Go'], sectors: ['Banking'] },
    })
    assert.deepEqual(parseRefinement(text, criteria), {
      reply: 'J\'ajoute Kafka et je retire Paris.',
      criteria: {
        titles: ['Java Developer'], locations: [], seniorities: ['senior'], skills: ['Java', 'Kafka'], requiredSkills: ['Kafka'], sectors: ['Banking'],
        emailOnly: true, recentOnly: false,
      },
    })
  })

  it('écarte les séniorités qui ne sont pas des clés propres de la liste (réponse dictée par un texte collé)', () => {
    const text = JSON.stringify({ reply: 'ok', criteria: { titles: ['Dev'], skills: [], seniorities: ['__proto__', 'constructor', 'toString', 'senior'] } })
    assert.deepEqual(parseRefinement(text, criteria)?.criteria.seniorities, ['senior'])
  })

  it('refuse des critères sans intitulé ni compétence, ou une réponse sans critères', () => {
    assert.equal(parseRefinement(JSON.stringify({ reply: 'ok', criteria: { titles: [], skills: [] } }), criteria), null)
    assert.equal(parseRefinement(JSON.stringify({ reply: 'ok' }), criteria), null)
    assert.equal(parseRefinement('pas de JSON', criteria), null)
  })

  it('envoie à l\'IA les critères sans les filtres qu\'elle ne règle pas', () => {
    assert.deepEqual(JSON.parse(criteriaForAi(criteria)), {
      titles: ['Java Developer'], locations: ['Paris, France'], seniorities: ['senior'], skills: ['Java', 'Spring'], requiredSkills: ['Java'], sectors: [],
    })
  })
})
