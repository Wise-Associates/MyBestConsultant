import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { aiQuestionPlan } from './interview-rules'
import {
  candidateFollowUpPrompt,
  closingAnswerPrompt,
  interviewEndAnalysisPrompt,
  nullableReply,
  parseGeneratedQuestions,
  parseInterviewEndAnalysis,
  parseRecruiterAnalysis,
  questionGenerationPrompt,
  recruiterAnalysisPrompt,
  recruiterFollowUpPrompt,
  type PromptTurn,
} from './interview-prompts'

const turns: PromptTurn[] = [
  { role: 'interviewer', content: 'Pouvez-vous vous présenter ?' },
  { role: 'candidate', content: 'Développeuse Java depuis 6 ans.' },
]

describe('réponse en texte libre des entretiens', () => {
  it('rend le texte sans espaces autour, ou null pour « null » et une réponse vide', () => {
    assert.equal(nullableReply('  Pouvez-vous préciser ?\n'), 'Pouvez-vous préciser ?')
    assert.equal(nullableReply(' null '), null)
    assert.equal(nullableReply('   '), null)
    assert.equal(nullableReply('NULL'), 'NULL')
  })
})

describe('consignes de la salle du candidat', () => {
  it('réponse à « Avez-vous des questions ? » : poste dans la consigne, message cité, textes coupés', () => {
    const p = closingAnswerPrompt({ jobTitle: 'Consultant SAP', candidateMessage: 'Quel est le rythme de télétravail ?' })
    assert.match(p.system, /^Tu es Alex, un recruteur IA bienveillant pour le poste de "Consultant SAP"\.\n/)
    assert.match(p.system, /réponds exactement : null\./)
    assert.equal(p.user, 'Message du candidat en réponse à "Avez-vous des questions ?" : "Quel est le rythme de télétravail ?"')
    const long = closingAnswerPrompt({ jobTitle: 'P'.repeat(500), candidateMessage: 'm'.repeat(9000) })
    assert.ok(long.system.includes(`"${'P'.repeat(200)}"`))
    assert.ok(long.user.endsWith(`"${'m'.repeat(8000)}"`))
  })

  it('relance du candidat : question (1 000 caractères) et réponse (8 000) seulement', () => {
    const p = candidateFollowUpPrompt({ question: 'Parlez-moi de vous', answer: 'Je suis "ingénieur"' })
    assert.match(p.system, /^Tu es un interviewer IA expert et bienveillant\./)
    assert.equal(p.user, 'Question posée : "Parlez-moi de vous"\nRéponse du candidat : "Je suis "ingénieur""')
    const long = candidateFollowUpPrompt({ question: 'q'.repeat(1500), answer: 'r'.repeat(9000) })
    assert.equal(long.user, `Question posée : "${'q'.repeat(1000)}"\nRéponse du candidat : "${'r'.repeat(8000)}"`)
  })
})

describe('génération des questions d\'un entretien', () => {
  const defaults = [{ text: 'Pouvez-vous vous présenter ?', category: 'intro' as const }]

  it('demande les questions manquantes, réparties par catégorie, sans répéter celles par défaut', () => {
    const plan = aiQuestionPlan(6, defaults.map(q => q.category))
    const p = questionGenerationPrompt({ jobTitle: 'Data engineer', jobSkills: ['Python', 'Spark'], jobDescription: 'Mission à Lyon', cvSummary: '5 ans de Spark', defaultQuestions: defaults, plan })
    assert.match(p.system, /Répartition des 5 questions :\n- 2 technical\n- 1 behavioral\n- 1 motivation\n- 1 closing\n/)
    assert.equal(p.user, 'POSTE : Data engineer\nCompétences : Python, Spark\nDescription : Mission à Lyon\n\nRÉSUMÉ CV : 5 ans de Spark'
      + '\n\nQUESTIONS DÉJÀ POSÉES (ne les répète pas) :\n- Pouvez-vous vous présenter ?\n\nGénère exactement 5 questions.')
  })

  it('sans question par défaut, pas de liste « déjà posées »', () => {
    const p = questionGenerationPrompt({ jobTitle: 'X', jobSkills: [], jobDescription: '', cvSummary: '', defaultQuestions: [], plan: aiQuestionPlan(3, []) })
    assert.equal(p.user, 'POSTE : X\nCompétences : \nDescription : \n\nRÉSUMÉ CV : \n\nGénère exactement 3 questions.')
  })

  it('lit le tableau de la réponse, garde le nombre demandé et numérote les questions sans identifiant', () => {
    const content = 'Voici :\n[{"id":"a","text":"Q1","category":"technical"},{"text":"Q2","category":"behavioral"},{"text":"Q3","category":"closing"}]'
    assert.deepEqual(parseGeneratedQuestions(content, 2), [
      { id: 'a', text: 'Q1', category: 'technical', aiGenerated: true },
      { id: 'q2', text: 'Q2', category: 'behavioral', aiGenerated: true },
    ])
  })

  it('refuse une réponse sans tableau (null) ou au JSON illisible (erreur)', () => {
    assert.equal(parseGeneratedQuestions('Je ne peux pas répondre.', 3), null)
    assert.throws(() => parseGeneratedQuestions('[{"text": "Q1",}]', 3))
  })
})

describe('relance et analyse d\'un entretien mené par le recruteur', () => {
  it('relance : question, réponse et contexte récent en Q / R', () => {
    const p = recruiterFollowUpPrompt({ question: 'Un projet difficile ?', answer: 'Une migration', recentTurns: turns })
    assert.match(p.system, /^Tu es un interviewer IA expert\. Analyse la réponse du candidat\./)
    assert.equal(p.user, 'Question posée : "Un projet difficile ?"\nRéponse du candidat : "Une migration"\n\nContexte récent :\nQ: Pouvez-vous vous présenter ?\nR: Développeuse Java depuis 6 ans.')
  })

  it('analyse : schéma JSON dans la consigne, retranscription en [INTERVIEWER] / [CANDIDAT]', () => {
    const p = recruiterAnalysisPrompt({ jobTitle: 'Consultant BI', jobSkills: ['Power BI', 'SQL'], transcript: turns })
    assert.match(p.system, /"recommendation": "hire"\|"consider"\|"reject"/)
    assert.equal(p.user, 'POSTE : Consultant BI\nCompétences requises : Power BI, SQL\n\nRETRANSCRIPTION :\n[INTERVIEWER] Pouvez-vous vous présenter ?\n[CANDIDAT] Développeuse Java depuis 6 ans.')
  })

  it('analyse lue : notes ramenées entre 0 et 100, listes coupées, modèle qui a répondu', () => {
    const content = 'Résultat : {"overallScore": 140, "communicationScore": "72", "technicalScore": -5, "keyInsights": ["a","b","c","d","e","f"], "redFlags": ["x"], "summary": "Bon profil.", "nextSteps": "non"}'
    assert.deepEqual(parseRecruiterAnalysis(content, 'claude'), {
      overallScore: 100,
      communicationScore: 72,
      technicalScore: 0,
      motivationScore: 0,
      culturalFitScore: 0,
      recommendation: 'consider',
      keyInsights: ['a', 'b', 'c', 'd', 'e'],
      redFlags: ['x'],
      summary: 'Bon profil.',
      nextSteps: [],
      analysedBy: 'claude',
    })
  })

  it('analyse refusée sans objet (null) ou au JSON illisible (erreur)', () => {
    assert.equal(parseRecruiterAnalysis('Analyse impossible.', 'claude'), null)
    assert.throws(() => parseRecruiterAnalysis('{"overallScore": 80,}', 'claude'))
  })
})

describe('analyse automatique à la fin de l\'entretien', () => {
  it('tout dans le message de l\'utilisateur : poste, répliques « Alex (recruteur) » / « Candidat »', () => {
    const p = interviewEndAnalysisPrompt({ jobTitle: 'Développeur React', transcript: turns })
    assert.deepEqual(Object.keys(p), ['user'])
    assert.match(p.user, /^Tu es un expert RH\. Analyse cette transcription d'entretien pour le poste "Développeur React"\.\n\nTRANSCRIPTION:\n/)
    assert.ok(p.user.includes('Alex (recruteur): Pouvez-vous vous présenter ?\n\nCandidat: Développeuse Java depuis 6 ans.\n\nRéponds UNIQUEMENT'))
    assert.ok(p.user.endsWith('"analysedBy": "Claude AI"\n}'))
  })

  it('lit le JSON, avec ou sans balises de code, et refuse un texte illisible', () => {
    assert.deepEqual(parseInterviewEndAnalysis('```json\n{"overallScore": 80, "recommendation": "hire"}\n```'), { overallScore: 80, recommendation: 'hire' })
    assert.deepEqual(parseInterviewEndAnalysis('  {"summary": "ok"}  '), { summary: 'ok' })
    assert.throws(() => parseInterviewEndAnalysis('Voici mon analyse : bon candidat.'))
  })
})
