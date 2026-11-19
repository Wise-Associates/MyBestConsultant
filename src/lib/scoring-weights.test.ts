import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MISSING_CAP, judgedScore, judgementSummary, type ActiveScale, type MatchJudgements } from './match-scoring'
import { scoreBreakdown } from './score-breakdown'
import {
  DEFAULT_WEIGHTS, ScaleWeightsSchemas, candidateWeightsKey, displayedScreening, isCandidateWeightsKey, mergeOverride, parseRecruiterWeights,
  parseWeightsOverride, personalScore, rescoreForRecruiter, withOverride, type RecruiterWeights,
} from './scoring-weights'

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
    // Poids v2 : poste 35 + techno 10 + localisation 12 + séniorité 5 + formation 1 + secteur 11 + langue 2 = 76.
    assert.equal(judgedScore(j), 76)
    // Poste 40 + techno 10 + localisation 8 + séniorité 5 + formation 3 + secteur 10 + langue 6 = 82.
    assert.equal(personalScore(76, reasonOf(j), CUSTOM), 82)
    assert.equal(personalScore(78, reasonOf(j), CUSTOM), 84, 'écart des recommandations gardé')
    assert.equal(scoreBreakdown(reasonOf(j), CUSTOM)?.parts.find(p => p.key === 'poste')?.max, 40, 'détail aux poids du recruteur')
  })

  it('score enregistré avant le 2026-11-19 (résumé sans version, poids v1) : affiché aux poids actuels, recommandations gardées', () => {
    const j = judged({ requirements: ['non'], skills: ['oui', 'non'] }, { projet: 'non', tjm: 'non', niveau: 'partiel', formation: 'partiel' })
    const before = reasonOf(j).replace('Poids v2 · ', '')
    // Aux poids v1, ces jugements donnaient 62 ; enregistré 64 avec 2 points de recommandations.
    assert.equal(personalScore(64, before, DEFAULT_WEIGHTS), 78, 'poids par défaut actuels (76) + 2')
    assert.equal(personalScore(64, before, CUSTOM), 84, 'poids du recruteur (82) + 2')
    assert.equal(personalScore(62, before, CUSTOM), 82)
  })

  it('poids remplaçants, barème par barème : offre sur les globaux, candidat sur l’offre', () => {
    const job = { ...DEFAULT_WEIGHTS.matching, poste: 25, tjm: 12 }
    const forJob = withOverride(CUSTOM, { matching: job })
    assert.deepEqual(forJob, { matching: job, final: CUSTOM.final }, 'offre : matching seulement')
    assert.equal(withOverride(CUSTOM, null).matching, CUSTOM.matching)
    const final = { ...DEFAULT_WEIGHTS.final, poste: 45, projet: 0, exigences: 2 }
    assert.deepEqual(withOverride(forJob, { final }), { matching: job, final }, 'candidat : son barème, l’autre reste celui de l’offre')
  })

  it('poids remplaçants relus (JSON du serveur) : un barème invalide est ignoré, illisibles : aucun', () => {
    assert.deepEqual(parseWeightsOverride(JSON.stringify({ matching: CUSTOM.matching })), { matching: CUSTOM.matching })
    assert.deepEqual(parseWeightsOverride(JSON.stringify(CUSTOM)), CUSTOM)
    assert.deepEqual(parseWeightsOverride(JSON.stringify({ matching: { ...CUSTOM.matching, poste: 41 }, final: CUSTOM.final })), { final: CUSTOM.final }, 'total différent de 100')
    assert.equal(parseWeightsOverride(JSON.stringify({ matching: DEFAULT_WEIGHTS.final })), null, 'poids du score final pour le matching')
    assert.equal(parseWeightsOverride(JSON.stringify(CUSTOM.matching)), null, 'barème non nommé')
    assert.equal(parseWeightsOverride('{coupé'), null)
    assert.equal(parseWeightsOverride(undefined), null)
  })

  it('clé d’un candidat : sa candidature (la même au Matching IA et au pipeline), son profil, son CV du vivier', () => {
    assert.equal(candidateWeightsKey({ source: 'application', id: 'app1', candidateId: 'user1' }), 'a:app1')
    assert.equal(candidateWeightsKey({ source: 'pool', id: 'match1', candidateId: 'user1' }), 'p:user1', 'pas la ligne du matching, recréée à chaque calcul')
    assert.equal(candidateWeightsKey({ source: 'vivier', id: 'cv1' }), 'v:cv1')
    for (const key of ['a:app1', 'p:user1', 'v:cv_1.2-3']) assert.ok(isCandidateWeightsKey(key), key)
    for (const key of ['x:app1', 'a:', 'a:../users', 'a:app1#x', `a:${'z'.repeat(37)}`, 'app1', 42]) assert.ok(!isCandidateWeightsKey(key), String(key))
  })

  it('score et avis affichés d’une candidature : avis de l’IA gardé au score enregistré, recalculé sinon', () => {
    const j = judged({ requirements: ['non'], skills: ['oui', 'non'] }, { projet: 'non', tjm: 'non', niveau: 'partiel', formation: 'partiel' })
    assert.deepEqual(displayedScreening(76, reasonOf(j), 'top', DEFAULT_WEIGHTS), { score: 76, recommendation: 'top' })
    assert.deepEqual(displayedScreening(76, reasonOf(j), 'average', CUSTOM), { score: 82, recommendation: 'good' })
  })

  it('enregistrer un barème d’un candidat garde l’autre ; retirer le dernier ne laisse rien', () => {
    const final = { ...DEFAULT_WEIGHTS.final, poste: 45, projet: 0, exigences: 2 }
    const both = mergeOverride({ final }, 'matching', CUSTOM.matching)
    assert.deepEqual(both, { final, matching: CUSTOM.matching })
    assert.deepEqual(mergeOverride(both, 'matching', null), { final })
    assert.equal(mergeOverride({ final }, 'final', null), null, 'plus aucun barème : document supprimé')
    assert.deepEqual(mergeOverride(null, 'final', final), { final })
  })

  it('liste du Matching IA : chaque candidat à ses poids (base, vivier, candidature), les autres à ceux de l’offre', () => {
    const j = judged({ requirements: ['non'], skills: ['oui', 'non'] }, { projet: 'non', tjm: 'non', niveau: 'partiel', formation: 'partiel' })
    const reason = reasonOf(j)
    const rows = [
      { source: 'pool' as const, id: 'match1', candidateId: 'user1', score: 76, reason },
      { source: 'vivier' as const, id: 'cv1', score: 76, reason },
      { source: 'application' as const, id: 'app1', score: null, reason: '' },
      { source: 'pool' as const, id: 'match2', candidateId: 'user2', score: 76, reason },
    ]
    const own = { 'p:user1': { matching: CUSTOM.matching }, 'v:cv1': { final: DEFAULT_WEIGHTS.final } }
    assert.deepEqual(rescoreForRecruiter(rows, DEFAULT_WEIGHTS, own).map(r => r.score), [82, 76, null, 76],
      'poids du candidat de la base ; poids du score final sans effet sur un score de matching ; score absent gardé')
  })

  it('poids d’un candidat pour l’autre barème : sans effet sur le score affiché', () => {
    const j = judged({ requirements: ['non'], skills: ['oui', 'non'] }, { projet: 'non', tjm: 'non', niveau: 'partiel', formation: 'partiel' })
    const finalOnly = withOverride(DEFAULT_WEIGHTS, { final: { ...DEFAULT_WEIGHTS.final, poste: 80, exigences: 0, projet: 0, client: 0, localisation: 0, niveau: 0 } })
    assert.deepEqual(displayedScreening(76, reasonOf(j), 'good', finalOnly), { score: 76, recommendation: 'good' })
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
