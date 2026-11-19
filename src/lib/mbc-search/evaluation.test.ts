import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SCALES, judgedScore, type MatchJudgements, type ScoringNotes } from '@/lib/match-scoring'
import { EMPTY_CRITERIA, type MbcCriteria, type MbcRevealed } from './rules'
import {
  APOLLO_CAPS, APOLLO_UNAVAILABLE, apolloWeights, evaluationOf, needAsOffer, parseEvaluationExtras, profileText, similarBrief, similarNeed,
} from './evaluation'

// Données fictives uniquement.
const person: MbcRevealed = {
  id: 'a'.repeat(24), name: 'Camille Durand', title: 'Senior Data Engineer', headline: 'Data Engineer | Spark | AWS', company: 'Exemple SA',
  companyWebsite: 'https://exemple.fr', location: 'Lyon, France', linkedinUrl: 'https://www.linkedin.com/in/camille-exemple',
  email: 'camille@exemple.fr', emailStatus: 'verified', photoUrl: '', seniority: 'senior', industry: 'Banking',
  experiences: [
    { title: 'Senior Data Engineer', company: 'Exemple SA', start: '2022-01', end: '', current: true, description: 'Pipelines Spark sur AWS pour la banque de détail.' },
    { title: 'Data Engineer', company: 'Fictive Corp', start: '2019-03', end: '2021-12', current: false },
  ],
}
const criteria: MbcCriteria = {
  ...EMPTY_CRITERIA, titles: ['Data Engineer', 'Ingénieur Data'], skills: ['Spark', 'Kafka'], requiredSkills: ['Kafka'],
  locations: ['Lyon, France'], seniorities: ['senior'], sectors: ['Banking'],
}
const notes: ScoringNotes = { reason: 'Kafka non visible.', summary: 'Profil data confirmé.', strengths: ['Spark'], concerns: ['Kafka'], namedSkills: [] }
const judgements = (over: Partial<MatchJudgements> = {}): MatchJudgements => ({
  scale: 'matching', roles: [{ title: 'Data Engineer', fit: 'oui', cited: 'Senior Data Engineer' }],
  requirements: ['oui'], requirementsListed: false, skills: ['non', 'non'], skillsListed: true,
  fits: { projet: 'oui', localisation: 'oui', niveau: 'oui', formation: 'non', domaine: 'oui', langue: 'non', tjm: 'non' }, ...over,
})

describe('MBC Search : évaluation d\'un profil révélé sur le barème du matching', () => {
  it('poids du recruteur sans formation, langue ni TJM, les autres ramenés à 100', () => {
    const w = apolloWeights(SCALES.matching.weights)
    for (const k of APOLLO_UNAVAILABLE) assert.equal(w[k], 0)
    const sum = Object.values(w).reduce((s, v) => s + (v ?? 0), 0)
    assert.ok(Math.abs(sum - 100) < 1e-9)
    // Poids v2 gardés : 94 points sur 100 (formation 2, langue 2, TJM 2 retirés).
    assert.ok(Math.abs((w.poste ?? 0) - (35 * 100) / 94) < 1e-9)
    // Réglage extrême : tous les poids gardés à zéro → ceux du barème.
    const allOnUnavailable = { poste: 0, exigences: 0, projet: 0, competences: 0, localisation: 0, niveau: 0, domaine: 0, formation: 40, langue: 30, tjm: 30 }
    assert.ok(Math.abs(Object.values(apolloWeights(allOnUnavailable)).reduce((s, v) => s + (v ?? 0), 0) - 100) < 1e-9)
  })

  it('ni plafond des critères indisponibles, ni des compétences (non visibles ≠ absentes) ; celui du poste reste', () => {
    assert.deepEqual(Object.keys(APOLLO_CAPS).sort(), ['domaine', 'localisation', 'niveau', 'poste'])
  })

  it('score : compétences non visibles sans plafond, critères indisponibles « Non disponible » et hors du score', () => {
    const j = judgements()
    assert.equal(judgedScore(j), 60, 'pour un CV, des compétences absentes plafonnent à 60')
    const e = evaluationOf(j, { skills: ['Kafka', 'Spark'], requirements: [] }, SCALES.matching.weights, notes, { questions: ['Q1'], nextSteps: [] })
    // 74 points gardés sur 94 (poste 35, contexte 3, projet 3, localisation 12, séniorité 10, secteur 11) → 79 sur 100.
    assert.equal(e.score, 79)
    assert.equal(e.cap, null)
    const formation = e.parts.find(p => p.key === 'formation')
    assert.deepEqual([formation?.unavailable, formation?.detail, formation?.max], [true, 'Non disponible', 0])
    assert.deepEqual(e.missing, ['Kafka', 'Spark'])
    assert.deepEqual([e.reason, e.strengths, e.questions], ['Kafka non visible.', ['Spark'], ['Q1']])
  })

  it('un poste non exercé plafonne toujours le score', () => {
    // Compétences vues : 59 points sur 94 sans le poste (63 sur 100), ramenés au plafond du poste.
    const e = evaluationOf(judgements({ roles: [{ title: 'Data Engineer', fit: 'non' }], skills: ['oui', 'oui'] }), { skills: [], requirements: [] }, SCALES.matching.weights, notes, { questions: [], nextSteps: [] })
    assert.deepEqual(e.cap, { label: 'Poste', value: 50 })
    assert.equal(e.score, 50)
  })

  it('les poids du recruteur comptent', () => {
    const heavyRole = { poste: 60, exigences: 5, projet: 5, competences: 5, localisation: 5, niveau: 5, formation: 0, domaine: 5, langue: 5, tjm: 5 }
    const e = evaluationOf(judgements({ skills: ['oui', 'oui'] }), { skills: [], requirements: [] }, heavyRole, notes, { questions: [], nextSteps: [] })
    assert.equal(e.score, 100)
    assert.ok((e.parts.find(p => p.key === 'poste')?.max ?? 0) > 60)
  })
})

describe('MBC Search : profil et besoin tels que l\'IA les lit', () => {
  it('profil comme un CV, sans nom, e-mail ni lien', () => {
    const text = profileText(person)
    assert.ok(!text.includes('Camille Durand') && !text.includes('@') && !text.includes('linkedin') && !text.includes('https://'))
    assert.match(text, /Poste actuel : Senior Data Engineer chez Exemple SA/)
    assert.match(text, /Secteur de l'employeur actuel : Banking/)
    assert.match(text, /- Data Engineer chez Fictive Corp \(2019-03 – 2021-12\)/)
    assert.match(text, /Pipelines Spark sur AWS/)
  })

  it('besoin : premier intitulé comme poste, les autres acceptés, ★ d\'abord, lieu, séniorité et secteur en précisions', () => {
    const { offer, judged } = needAsOffer('Data engineer confirmé pour une banque.', criteria)
    assert.equal(offer.title, 'Data Engineer')
    assert.match(offer.description, /Intitulés acceptés : Data Engineer, Ingénieur Data/)
    assert.match(offer.description, /Compétences indispensables : Kafka/)
    assert.deepEqual(offer.details, ['Lieu : Lyon, France', 'Séniorité : Confirmé / senior', 'Secteur de l\'employeur : Banking'])
    assert.deepEqual(judged.skills, ['Kafka', 'Spark'])
  })

  it('besoin sans intitulé : un poste tiré des compétences', () => {
    assert.equal(needAsOffer('', { ...EMPTY_CRITERIA, skills: ['SAP FI', 'SAP CO'] }).offer.title, 'Profil SAP FI, SAP CO')
  })

  it('profils similaires : poste, secteur, lieu et postes récents, jamais le nom ni les coordonnées', () => {
    const brief = similarBrief(person)
    assert.ok(!brief.includes('Camille') && !brief.includes('@') && !brief.includes('linkedin'))
    assert.match(brief, /Poste actuel : Senior Data Engineer chez Exemple SA/)
    assert.match(brief, /Secteur de l'employeur : Banking/)
    assert.match(brief, /Postes récents : Senior Data Engineer chez Exemple SA ; Data Engineer chez Fictive Corp/)
  })

  it('questions d\'entretien et prochaines étapes bornées, réponse illisible : vides', () => {
    assert.deepEqual(parseEvaluationExtras({ questions_entretien: ['a', 'b', 'c', 'd', 4], prochaines_etapes: ['x', '', 'y', 'z'] }), { questions: ['a', 'b', 'c'], nextSteps: ['x', 'y'] })
    assert.deepEqual(parseEvaluationExtras(null), { questions: [], nextSteps: [] })
  })
})

describe('MBC Search : évaluation d\'un besoin sans intitulé, besoin gardé des profils similaires', () => {
  it('sans intitulé demandé, le poste ne départage personne et ne plafonne pas', () => {
    const e = evaluationOf(judgements({ roles: [{ title: 'Profil SAP FI', fit: 'partiel' }] }), { skills: [], requirements: [] }, SCALES.matching.weights, notes,
      { questions: [], nextSteps: [] }, { titleAsked: false })
    assert.equal(e.cap, null)
    const poste = e.parts.find(p => p.key === 'poste')
    assert.equal(poste?.detail, 'Non demandé')
    assert.equal(poste?.points, poste?.max)
  })

  it('besoin gardé (historique) tiré des critères seuls, sans le parcours de la personne de départ', () => {
    const need = similarNeed({ ...criteria, titles: ['Data Engineer'], skills: ['Spark'] })
    assert.equal(need, 'Profils proches d\'un profil révélé : Data Engineer, Spark')
    assert.ok(!need.includes('Exemple SA') && !need.includes('Lyon'))
  })
})
