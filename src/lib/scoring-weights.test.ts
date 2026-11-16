import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MISSING_CAP, judgedScore, judgementSummary, type ActiveScale, type MatchJudgements } from './match-scoring'
import { scoreBreakdown } from './score-breakdown'
import { DEFAULT_WEIGHTS, ScaleWeightsSchemas, parseRecruiterWeights, personalScore, type RecruiterWeights } from './scoring-weights'

const ALL_YES: MatchJudgements['fits'] = { projet: 'oui', client: 'oui', localisation: 'oui', niveau: 'oui', formation: 'oui', domaine: 'oui', langue: 'oui', tjm: 'oui' }
const judged = (over: Partial<MatchJudgements> = {}, fits: MatchJudgements['fits'] = {}, scale: ActiveScale = 'matching'): MatchJudgements => ({
  scale, roles: [{ title: 'Développeur Java', fit: 'oui' }], requirements: ['oui', 'oui'], requirementsListed: true,
  skills: ['oui', 'oui'], skillsListed: true, fits: { ...ALL_YES, ...fits }, ...over,
})
const reasonOf = (j: MatchJudgements) => `${judgementSummary(j)} — Raison fictive.`

// Contexte, projet et TJM sans importance pour ce recruteur, poste doublé.
const CUSTOM: RecruiterWeights = {
  matching: { poste: 40, exigences: 0, projet: 0, competences: 20, localisation: 8, niveau: 10, formation: 6, domaine: 10, langue: 6, tjm: 0 },
  final: DEFAULT_WEIGHTS.final,
}

describe('poids personnels d’un recruteur', () => {
  it('poids par défaut : le score enregistré, recommandations comprises', () => {
    const samples = [judged(), judged({ requirements: ['non'], skills: ['oui', 'non'] }, { projet: 'non', tjm: 'non', niveau: 'partiel', formation: 'partiel' }),
      judged({ roles: [{ title: '', fit: 'non' }] }), judged({}, { client: 'partiel' }, 'final')]
    for (const j of samples) {
      for (const bonus of [0, 2, 7]) {
        const stored = Math.min(100, judgedScore(j) < 65 ? Math.min(judgedScore(j) + bonus, 64) : judgedScore(j) + bonus)
        assert.equal(personalScore(stored, reasonOf(j), DEFAULT_WEIGHTS), stored, `${judgementSummary(j)} +${bonus}`)
      }
    }
  })

  it('recalcule le score avec les poids du recruteur, sans nouvel appel d’IA', () => {
    const j = judged({ requirements: ['non'], skills: ['oui', 'non'] }, { projet: 'non', tjm: 'non', niveau: 'partiel', formation: 'partiel' })
    assert.equal(judgedScore(j), 62)
    // Poste 40 + techno 10 + localisation 8 + séniorité 5 + formation 3 + secteur 10 + langue 6 = 82.
    assert.equal(personalScore(62, reasonOf(j), CUSTOM), 82)
    assert.equal(personalScore(64, reasonOf(j), CUSTOM), 84, 'écart des recommandations gardé')
    assert.equal(scoreBreakdown(reasonOf(j), CUSTOM)?.parts.find(p => p.key === 'poste')?.max, 40, 'détail aux poids du recruteur')
  })

  it('les plafonds des critères essentiels restent appliqués', () => {
    const j = judged({}, { langue: 'non' })
    assert.equal(personalScore(MISSING_CAP, reasonOf(j), CUSTOM), MISSING_CAP)
  })

  it('score sans résumé lisible ou du barème d’avant : le score enregistré', () => {
    assert.equal(personalScore(71, 'Bon profil Java.', CUSTOM), 71)
    assert.equal(personalScore(66, 'Poste : oui · Exigences : 1 sur 3 · Compétences : oui · Domaine : oui · Niveau : oui', CUSTOM), 66)
  })

  it('préférences du compte (écrites par l’utilisateur) : un barème invalide garde ses poids par défaut', () => {
    assert.deepEqual(parseRecruiterWeights(CUSTOM), CUSTOM)
    assert.deepEqual(parseRecruiterWeights(undefined), DEFAULT_WEIGHTS)
    assert.deepEqual(parseRecruiterWeights('texte'), DEFAULT_WEIGHTS)
    const wrongTotal = { ...CUSTOM, matching: { ...CUSTOM.matching, poste: 50 } }
    assert.deepEqual(parseRecruiterWeights(wrongTotal).matching, DEFAULT_WEIGHTS.matching)
    assert.deepEqual(parseRecruiterWeights({ ...CUSTOM, final: { ...CUSTOM.final, formation: 0 } }).final, DEFAULT_WEIGHTS.final, 'critère hors du barème')
    assert.deepEqual(parseRecruiterWeights({ matching: CUSTOM.matching, final: { ...CUSTOM.final, poste: 24.5, client: 15.5 } }).final, DEFAULT_WEIGHTS.final, 'entiers seulement')
  })

  it('refuse à l’enregistrement (un barème par page) un total différent de 100, un critère manquant ou d’un autre barème', () => {
    assert.ok(ScaleWeightsSchemas.matching.safeParse(CUSTOM.matching).success)
    assert.ok(ScaleWeightsSchemas.final.safeParse(DEFAULT_WEIGHTS.final).success)
    assert.ok(!ScaleWeightsSchemas.matching.safeParse({ ...CUSTOM.matching, poste: 41 }).success)
    const { tjm: _tjm, ...missing } = CUSTOM.matching
    void _tjm
    assert.ok(!ScaleWeightsSchemas.matching.safeParse(missing).success)
    assert.ok(!ScaleWeightsSchemas.matching.safeParse({ ...CUSTOM.matching, poste: -10, exigences: 10 }).success)
    assert.ok(!ScaleWeightsSchemas.final.safeParse(CUSTOM.matching).success, 'poids du matching envoyés pour le screening')
  })
})
