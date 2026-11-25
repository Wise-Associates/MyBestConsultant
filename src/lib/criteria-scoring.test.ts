import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  criteriaBlock, criteriaBreakdown, criteriaJudgedScore, criteriaScoreOf, criteriaSummary, criteriaSystemPrompt, criteriaUserMessage,
  isCriteriaSummary, parseCriteriaJudgements, reasonWithoutCriteria,
} from './criteria-scoring'
import { withTitleRelations } from './match-scoring'
import { CRITERIA_LIMITS, criteriaFingerprint, defaultCriteriaSet, evenLabels, type OfferCriteriaSet } from './offer-criteria'

// Offre, critères et CV fictifs.
const SET: OfferCriteriaSet = {
  version: 1,
  criteria: [
    { id: 'poste', name: 'Poste', weight: 50, labels: [{ label: 'Développeur Java', weight: 70, required: true }, { label: 'Développeur Angular', weight: 30, required: false }] },
    { id: 'competences', name: 'Techno', weight: 30, labels: [{ label: 'Java', weight: 50, required: true }, { label: 'Kafka', weight: 50, required: false }] },
    { id: 'domaine', name: 'Secteur', weight: 10, labels: [{ label: 'Banque', weight: 100, required: false }] },
    { id: 'x1', name: 'Expérience bancaire', weight: 10, labels: [] },
  ],
  alternativeTitles: [],
}

const CV = `Développeur Java senior — Banque Fictive (2019-2024)
Développement des services de paiement en Java et Spring Boot pour la banque de détail
Migration des traitements batch vers une architecture microservices en Java
Compétences : Java, Spring, Kafka, Angular`

const ANSWER = {
  poste: [
    { metier: 'Développeur Java', exerce: 'oui', intitule: 'Développeur Java senior' },
    { metier: 'Développeur Angular', exerce: 'non', intitule: '' },
  ],
  competences: [
    { jugement: 'oui', citation: 'Développement des services de paiement en Java et Spring Boot pour la banque de détail' },
    // Kafka seulement listé : « oui » sans citation d'expérience devient « partiel ».
    { jugement: 'oui', citation: 'Compétences : Java, Spring, Kafka, Angular' },
  ],
  domaine: ['oui'],
  x1: { jugement: 'oui', citation: 'Développement des services de paiement en Java et Spring Boot pour la banque de détail' },
  raison: 'Pas d’Angular.',
}

const judged = () => {
  const j = parseCriteriaJudgements(ANSWER, SET, CV)
  assert.ok(j)
  // Seconde question de l'IA : l'intitulé du CV est bien le métier demandé.
  return withTitleRelations(j, ['meme'])
}

const withWeights = (posteJava: number, posteWeight: number): OfferCriteriaSet => ({
  ...SET,
  criteria: SET.criteria.map(c => (c.id === 'poste'
    ? { ...c, weight: posteWeight, labels: [{ ...c.labels[0], weight: posteJava }, { ...c.labels[1], weight: 100 - posteJava }] }
    : c.id === 'x1' ? { ...c, weight: c.weight + (50 - posteWeight) } : c)),
})

describe('notation sur les critères d’une offre (v3)', () => {
  it('l’IA reçoit les libellés, jamais les poids ni ★ : une notation vaut pour toute pondération', () => {
    const offer = { title: 'Développeur Java Angular', description: 'Développement d’applications bancaires.' }
    const other = withWeights(50, 40)
    other.criteria[1].labels[1].required = true
    assert.equal(criteriaSystemPrompt(other), criteriaSystemPrompt(SET))
    assert.equal(criteriaUserMessage(offer, other, CV), criteriaUserMessage(offer, SET, CV))
    const message = criteriaUserMessage(offer, SET, CV)
    assert.match(message, /Poste \(réponds dans cet ordre\) :\n1\. Développeur Java\n2\. Développeur Angular/)
    assert.match(message, /Critère x1 — Expérience bancaire \(réponds dans cet ordre\) :\n1\. Expérience bancaire/)
    assert.match(criteriaSystemPrompt(SET), /"x1":\[\{"jugement"/)
    assert.match(criteriaSystemPrompt(SET), /"x1" : critère propre à l'offre \(« Critère x1 » des critères de l'offre\)/)
    // Nom saisi dans le navigateur : jamais dans les consignes, seulement dans les données du message.
    assert.ok(!criteriaSystemPrompt(SET).includes('Expérience bancaire'))
  })

  it('lit les jugements, vérifie les citations dans le CV, nomme les métiers par leurs libellés', () => {
    const j = judged()
    assert.deepEqual(j.roles.map(r => [r.title, r.fit]), [['Développeur Java', 'oui'], ['Développeur Angular', 'non']])
    assert.deepEqual(j.criteria.find(c => c.id === 'competences')?.values, ['oui', 'partiel'])
    assert.deepEqual(j.criteria.find(c => c.id === 'domaine')?.values, ['oui'])
    assert.deepEqual(j.criteria.find(c => c.id === 'x1')?.values, ['oui'])
    assert.equal(j.fingerprint, criteriaFingerprint(SET))
  })

  it('un critère absent ou illisible : pas de score (null) ; un libellé oublié vaut « non »', () => {
    const missing = Object.fromEntries(Object.entries(ANSWER).filter(([key]) => key !== 'domaine'))
    assert.equal(parseCriteriaJudgements(missing, SET, CV), null)
    assert.equal(parseCriteriaJudgements({ ...ANSWER, x1: 'peut-être' }, SET, CV), null)
    const short = parseCriteriaJudgements({ ...ANSWER, competences: [ANSWER.competences[0]] }, SET, CV)
    assert.deepEqual(short?.criteria.find(c => c.id === 'competences')?.values, ['oui', 'non'])
  })

  it('sous-poids : Java 70 / Angular 30, sans plafond pour un libellé non requis', () => {
    // Poste 0,7 × 50 = 35 ; Techno (1 + 0,5) / 2 × 30 = 22,5 ; Secteur 10 ; Expérience bancaire 10 → 77,5 → 78.
    assert.equal(criteriaJudgedScore(judged(), SET), 78)
    // Mêmes jugements, Java 90 / Angular 10 : 0,9 × 50 = 45 → 87,5 → 88.
    assert.equal(criteriaJudgedScore(judged(), withWeights(90, 50)), 88)
  })

  it('★ manquant : 50 pour un métier du poste, 60 sinon ; secteur ★ voisin : 80 ; technologies sous un tiers : 60', () => {
    const values = (poste: string[], techno: string[], domaine: string[]) => new Map([
      ['poste', poste], ['competences', techno], ['domaine', domaine], ['x1', ['oui']],
    ] as [string, never][])
    assert.equal(criteriaScoreOf(SET, values(['non', 'oui'], ['oui', 'oui'], ['oui'])).score, 50)
    const requiredKafka = structuredClone(SET)
    requiredKafka.criteria[1].labels[1].required = true
    const kafka = criteriaScoreOf(requiredKafka, values(['oui', 'oui'], ['oui', 'non'], ['oui']))
    assert.equal(kafka.score, 60)
    assert.match(kafka.cap?.reason ?? '', /« Kafka » \(Techno\) absent du parcours/)
    const requiredBank = structuredClone(SET)
    requiredBank.criteria[2].labels[0].required = true
    assert.equal(criteriaScoreOf(requiredBank, values(['oui', 'oui'], ['oui', 'oui'], ['partiel'])).score, 80)
    // Libellés non requis mais Techno couverte à 25 % (sous un tiers) : plafond 60. Java (★) est « partiel », sans plafond.
    assert.equal(criteriaScoreOf(SET, values(['oui', 'oui'], ['partiel', 'non'], ['oui'])).score, 60)
    // Valeur neutre : jamais de plafond, toute la part.
    assert.equal(criteriaScoreOf(requiredBank, values(['oui', 'oui'], ['oui', 'oui'], ['non requis'])).score, 100)
  })

  it('résumé relu : même score, recalculé pour d’autres poids et ★ ; d’autres libellés : à renoter', () => {
    const j = judged()
    const reason = `${criteriaSummary(j)} — Pas d’Angular.`
    assert.equal(reason, `Critères v1#${criteriaFingerprint(SET)} · on · op · o · o — Pas d’Angular.`)
    const breakdown = criteriaBreakdown(reason, SET)
    assert.equal(breakdown?.score, criteriaJudgedScore(j, SET))
    assert.equal(breakdown?.rest, 'Pas d’Angular.')
    assert.deepEqual(breakdown?.parts.map(p => [p.name, p.percent, p.detail]), [
      ['Poste', 70, 'Développeur Java oui, Développeur Angular non'], ['Techno', 75, 'Java oui, Kafka partiel'],
      ['Secteur', 100, 'Banque oui'], ['Expérience bancaire', 100, 'Expérience bancaire oui'],
    ])
    assert.equal(criteriaBreakdown(reason, withWeights(90, 50))?.score, 88)
    const relabelled = structuredClone(SET)
    relabelled.criteria[1].labels[1].label = 'RabbitMQ'
    assert.equal(criteriaBreakdown(reason, relabelled), null)
    assert.equal(criteriaBreakdown('Poids v2 · Poste : oui', SET), null)
    assert.equal(criteriaBreakdown(`Critères v1#${criteriaFingerprint(SET)} · on · ox · o · o`, SET), null)
    assert.ok(isCriteriaSummary(reason))
    assert.equal(reasonWithoutCriteria(reason), 'Pas d’Angular.')
  })

  it('le prompt de notation nomme la liste du poste comme le bloc des critères (« Intitulé », ADR 0062)', () => {
    const set = defaultCriteriaSet({ title: 'Développeur Java', skills: ['Java'], location: 'Paris' })
    const prompt = criteriaSystemPrompt(set)
    assert.match(criteriaBlock(set), /^Intitulé \(réponds dans cet ordre\) :\n1\. Développeur Java/)
    assert.match(prompt, /une par métier de la liste « Intitulé »/)
    assert.match(prompt, /les métiers de la liste « Intitulé » sont la référence/)
    assert.ok(!prompt.includes('« Poste »'))
  })

  it('critères par défaut : un lieu éloigné plafonne toujours à 60, comme le barème (revue de code du 2026-11-24)', () => {
    const set = defaultCriteriaSet({ title: 'Développeur Java', skills: ['Java', 'Spring'], location: 'Paris' })
    const values = new Map(set.criteria.map(c => [c.id, c.id === 'localisation' ? ['non'] : c.labels.length > 0 ? c.labels.map(() => 'oui') : ['oui']] as [string, never]))
    const result = criteriaScoreOf(set, values)
    // Tout sauf le lieu (14 sur 100, ADR 0062).
    assert.equal(result.total, 86)
    assert.equal(result.score, 60)
  })

  it('bonus des recommandations ajouté après le résumé : la phrase de l’IA et le bonus restent lisibles', () => {
    const reason = `${criteriaSummary(judged())} — Pas d’Angular. — Recommandé sur : Java (+4 pts)`
    assert.equal(criteriaBreakdown(reason, SET)?.rest, 'Pas d’Angular. — Recommandé sur : Java (+4 pts)')
    assert.equal(reasonWithoutCriteria(reason), 'Pas d’Angular. — Recommandé sur : Java (+4 pts)')
  })

  it('raison coupée par son stockage : jamais les lettres du résumé à l’écran', () => {
    const cut = `Critères v1#${criteriaFingerprint(SET)} · on · o`
    assert.equal(criteriaBreakdown(cut, SET), null)
    assert.ok(isCriteriaSummary(cut))
    assert.equal(reasonWithoutCriteria(cut), '')
    assert.equal(reasonWithoutCriteria('Poids v2 · Poste : oui — Bon profil.'), 'Poids v2 · Poste : oui — Bon profil.')
  })

  it('résumé court même pour des critères au maximum : il tient dans les 300 caractères d’une raison du vivier', () => {
    const big: OfferCriteriaSet = {
      version: 1,
      criteria: Array.from({ length: CRITERIA_LIMITS.criteria }, (_, i) => ({
        id: i === 0 ? 'poste' : `x${i}`, name: `Critère ${i}`, weight: i < 2 ? 8 : 7,
        labels: evenLabels(Array.from({ length: i === 0 ? 4 : CRITERIA_LIMITS.labels }, (_, k) => `Libellé ${i}-${k}`)),
      })),
      alternativeTitles: [],
    }
    const values = big.criteria.map(c => ({ id: c.id, values: c.labels.map(() => 'non précisé' as const) }))
    const summary = criteriaSummary({ fingerprint: criteriaFingerprint(big), roles: big.criteria[0].labels.map(l => ({ title: l.label, fit: 'non' })), criteria: values })
    assert.ok(summary.length < 300, `${summary.length} caractères`)
  })
})
