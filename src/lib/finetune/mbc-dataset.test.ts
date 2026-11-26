import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { scaleKeys } from '../match-scoring'
import { TASKS, chatExample, cvTextOfRequest, estimateCost, exampleRefusal, followUpItems, itemId, splitOf, teacherAnswer, titleCheckItem, type DatasetItem, type TaskContext } from './mbc-dataset'

// CV et offre inventés pour l'exemple.
const CV = `Développeur Java senior chez Exemple Banque (2019-2024).
Conception de microservices Spring Boot pour la gestion des paiements en temps réel.
Migration de l'application de crédit vers Kubernetes avec une équipe de huit personnes.`

const scoringCtx = (scale: 'matching' | 'final' = 'matching'): TaskContext => ({
  task: scale === 'matching' ? 'scoring-matching' : 'scoring-final', scale, skills: ['Java', 'Kubernetes'],
  description: 'Développement de microservices bancaires.', cvText: CV,
})

/** Réponse complète au barème : chaque critère jugé, une citation tirée du CV. */
function scoringAnswer(scale: 'matching' | 'final' = 'matching') {
  const answer: Record<string, unknown> = {}
  for (const key of scaleKeys(scale)) {
    if (key === 'poste') answer.poste = [{ metier: 'Développeur Java', exerce: 'oui', intitule: 'Développeur Java senior' }]
    else if (key === 'exigences') answer.exigences = { jugement: 'partiel', citation: '' }
    else if (key === 'competences') answer.competences = [
      { jugement: 'oui', citation: 'Conception de microservices Spring Boot pour la gestion des paiements' },
      { jugement: 'oui', citation: "Migration de l'application de crédit vers Kubernetes" },
    ]
    else answer[key] = 'oui'
  }
  return { ...answer, raison: 'Profil proche.', resume: 'Développeur Java expérimenté.' }
}

describe("réponse de l'enseignant lue comme l'application la lit", () => {
  it('accepte une notation complète, même entourée de texte, et la réécrit en JSON compact', () => {
    const answer = scoringAnswer()
    const verdict = teacherAnswer(scoringCtx(), `Voici l'évaluation :\n\`\`\`json\n${JSON.stringify(answer, null, 2)}\n\`\`\``)
    assert.deepEqual(verdict, { answer: JSON.stringify(answer) })
  })

  it('refuse une notation à laquelle manque un critère du barème, ou sans JSON', () => {
    const answer = scoringAnswer('final') as Record<string, unknown>
    const fitKey = scaleKeys('final').find(k => !['poste', 'exigences', 'competences'].includes(k)) ?? ''
    delete answer[fitKey]
    assert.ok('reason' in teacherAnswer(scoringCtx('final'), JSON.stringify(answer)))
    assert.ok('reason' in teacherAnswer(scoringCtx(), 'Je ne peux pas évaluer ce candidat.'))
  })

  it('exige une relation lisible pour chaque paire d’intitulés, ni plus ni moins', () => {
    assert.deepEqual(teacherAnswer({ task: 'title-check', count: 2 }, '["meme", "autre"]'), { answer: '["meme","autre"]' })
    assert.ok('reason' in teacherAnswer({ task: 'title-check', count: 3 }, '["meme", "autre"]'))
    assert.ok('reason' in teacherAnswer({ task: 'title-check', count: 2 }, '["meme", "peut-être"]'))
  })

  it("refuse un lot du vivier dont une offre n'est pas jugée", () => {
    const offer = { $id: 'o1', title: 'Développeur Java', skills: ['Java'], location: 'Paris', description: 'Microservices.' }
    const item = { offre: 1, ...scoringAnswer() }
    const ctx: TaskContext = { task: 'vivier-batch', offers: [offer, { ...offer, $id: 'o2' }], cvText: CV }
    assert.ok('reason' in teacherAnswer(ctx, JSON.stringify([item])))
    assert.ok('answer' in teacherAnswer(ctx, JSON.stringify([item, { ...item, offre: 2 }])))
  })
})

describe('comparaison des intitulés qui suit une notation', () => {
  const base: DatasetItem = { id: itemId('scoring-matching', 'cv', 'offre'), group: 'g1', project: 'p', system: 's', messages: [{ role: 'user', content: 'u' }], ctx: scoringCtx() }

  it('reprend les paires « métier / intitulé du CV » de la notation, dans le même groupe', () => {
    const item = titleCheckItem(base, JSON.stringify(scoringAnswer()))
    assert.ok(item)
    assert.equal(item.group, 'g1')
    assert.deepEqual(item.ctx, { task: 'title-check', count: 1 })
    assert.match(item.messages[0].content, /Développeur Java senior/)
  })

  it("n'en crée pas quand aucun métier n'est exercé", () => {
    const answer = { ...scoringAnswer(), poste: [{ metier: 'Développeur Java', exerce: 'non', intitule: '' }] }
    assert.equal(titleCheckItem(base, JSON.stringify(answer)), null)
  })
})

describe('répartition et coût', () => {
  it('place toujours un groupe dans la même part, environ 80 / 10 / 10', () => {
    assert.equal(splitOf('cv-42'), splitOf('cv-42'))
    const counts = { train: 0, validation: 0, test: 0 }
    for (let i = 0; i < 2000; i++) counts[splitOf(`groupe-${i}`)]++
    assert.ok(counts.train > 1500 && counts.validation > 120 && counts.test > 120, JSON.stringify(counts))
  })

  it('estime le coût par tâche, au tarif des lots', () => {
    const item: DatasetItem = { id: 'a', group: 'g', project: 'p', system: 'x'.repeat(3200), messages: [{ role: 'user', content: 'y'.repeat(3200) }], ctx: scoringCtx() }
    const [line] = estimateCost([item, { ...item, id: 'b' }])
    assert.equal(line.items, 2)
    assert.equal(line.inputTokens, 4000)
    assert.equal(line.outputTokens, 2 * TASKS['scoring-matching'].expectedOutputTokens)
    assert.equal(line.usd, ((4000 * 2 + line.outputTokens * 10) / 1e6) * 0.5)
  })

  it("forme l'exemple d'entraînement : consignes, message, réponse attendue", () => {
    const item: DatasetItem = { id: 'a', group: 'g', project: 'p', system: 'S', messages: [{ role: 'user', content: 'U' }], ctx: scoringCtx() }
    assert.deepEqual(chatExample(item, 'R').messages.map(m => m.role), ['system', 'user', 'assistant'])
  })
})

describe("export CV : lecture puis traduction, comme l'application", () => {
  // Dossier inventé, au format demandé par extractionPrompt.
  const extraction = {
    titre: 'Ingénieur DevOps', experience: '7 ans d’expérience', resume: ['Ingénieur DevOps orienté automatisation.'],
    experiences: [{ dates: '2021 – Aujourd’hui', client: 'Exemple Banque', role_lignes: ['Ingénieur DevOps'], contexte: 'Migration cloud.', realisations: ['Migration vers Kubernetes.'], environnement: 'Kubernetes, Terraform' }],
    formations: [{ annees: '2018', intitule: 'Master informatique', etablissement: 'Université Imaginaire', details: [] }],
    certifications: [], langues: [{ langue: 'Anglais', niveau: 'courant' }], competences: [{ categorie: 'Cloud', contenu: 'AWS, Kubernetes' }],
    langue: 'fr', termes_identifiants: ['Claire Morel'], omis: [],
  }
  const item: DatasetItem = { id: itemId('cv-export-extract', 'cv'), group: 'g', project: 'p', system: 's', messages: [{ role: 'user', content: 'u' }], ctx: { task: 'cv-export-extract', mode: 'standard' } }

  it("refuse un dossier sans termes d'identité, accepte un dossier complet", () => {
    assert.ok('reason' in teacherAnswer(item.ctx, JSON.stringify({ ...extraction, termes_identifiants: [] })))
    assert.deepEqual(teacherAnswer(item.ctx, `\`\`\`json\n${JSON.stringify(extraction)}\n\`\`\``), { answer: JSON.stringify(extraction) })
  })

  it('demande ensuite la traduction vers l’autre langue, vérifiée contre le dossier lu', () => {
    const [next] = followUpItems(item, JSON.stringify(extraction))
    assert.equal(next.ctx.task, 'cv-export-translate')
    assert.equal(next.ctx.task === 'cv-export-translate' && next.ctx.target, 'en')
    assert.match(next.messages[0].content, /^<dossier>\n\{"titre":"Ingénieur DevOps"/)
    // Traduction qui perd une expérience : refusée (même structure exigée).
    const lost = { ...extraction, titre: 'DevOps Engineer', experiences: [] }
    assert.ok('reason' in teacherAnswer(next.ctx, JSON.stringify(lost)))
  })

  it('écarte des exemples un dossier qui perd une partie du CV, garde un dossier fidèle', () => {
    const cv = [
      'Claire Morel', 'Ingénieur DevOps', '7 ans d’expérience', 'Ingénieur DevOps orienté automatisation.',
      '2021 – Aujourd’hui Exemple Banque Ingénieur DevOps', 'Migration cloud.', 'Migration vers Kubernetes.', 'Kubernetes, Terraform',
      '2018 Master informatique Université Imaginaire', 'Anglais courant', 'Cloud : AWS, Kubernetes',
    ].join('\n')
    const request: DatasetItem = { ...item, messages: [{ role: 'user', content: `Dossier à lire.\n<cv>\n${cv}\n</cv>` }] }
    assert.equal(cvTextOfRequest(request), cv)
    assert.equal(exampleRefusal(request, JSON.stringify(extraction)), null)
    const partial = { ...extraction, experiences: [], formations: [], competences: [] }
    assert.equal(exampleRefusal(request, JSON.stringify(partial)), 'dossier incomplet')
    // Les autres tâches ne passent pas par cette règle.
    assert.equal(exampleRefusal({ ...request, ctx: { task: 'assistant', role: 'candidate' } }, 'Réponse.'), null)
  })
})

describe("assistant : réponse nettoyée, conversation à deux tours", () => {
  const item: DatasetItem = { id: itemId('assistant', 'candidate', 'Q1'), group: 'g', project: 'p', system: 'S', messages: [{ role: 'user', content: 'Q1' }], ctx: { task: 'assistant', role: 'candidate', followUp: 'Q2' } }

  it('refuse une réponse vide, garde une réponse nettoyée', () => {
    assert.ok('reason' in teacherAnswer(item.ctx, '   '))
    assert.deepEqual(teacherAnswer(item.ctx, '  Bonjour.  '), { answer: 'Bonjour.' })
  })

  it("pose la question suivante avec l'historique, sans nouvelle suite", () => {
    const [next] = followUpItems(item, 'R1')
    assert.deepEqual(next.messages, [{ role: 'user', content: 'Q1' }, { role: 'assistant', content: 'R1' }, { role: 'user', content: 'Q2' }])
    assert.deepEqual(next.ctx, { task: 'assistant', role: 'candidate' })
    assert.deepEqual(followUpItems(next, 'R2'), [])
  })
})

describe('demande sans consignes', () => {
  it("n'ajoute pas de message système vide à l'exemple", () => {
    const item: DatasetItem = { id: 'a', group: 'g', project: 'p', system: '', messages: [{ role: 'user', content: 'U' }], ctx: { task: 'interview-analysis-end' } }
    assert.deepEqual(chatExample(item, '{}').messages.map(m => m.role), ['user', 'assistant'])
  })
})
