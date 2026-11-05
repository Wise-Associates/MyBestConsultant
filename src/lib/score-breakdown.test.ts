import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { judgedScore, judgementSummary, type DomainFit, type Judgement, type LevelFit, type MatchJudgements, type RoleFit } from './match-scoring'
import { CRITERIA, scoreAdjustment, scoreBreakdown } from './score-breakdown'
import { MAX_REQUIRED_SKILLS, MAX_REQUIREMENTS, SCORE_WEIGHTS } from './match-scoring'

const judged = (over: Partial<MatchJudgements> = {}): MatchJudgements => ({
  roles: [{ title: 'Développeur Full Stack', fit: 'oui' }], requirements: ['oui', 'oui'], requirementsListed: true,
  skills: ['oui', 'oui'], skillsListed: true, domain: 'oui', level: 'oui', ...over,
})

describe('détail d’un score du Matching IA', () => {
  it('redonne exactement le score calculé, pour toutes les combinaisons de jugements', () => {
    const roleSets: RoleFit[][] = [
      [{ title: '', fit: 'oui' }], [{ title: '', fit: 'partiel' }], [{ title: 'Chef de projet', fit: 'non' }],
      [{ title: 'Scrum Master', fit: 'oui' }, { title: 'Développeur Full Stack', fit: 'non' }],
      [{ title: 'Product Owner', fit: 'partiel' }, { title: 'Business Analyst', fit: 'oui' }],
    ]
    const lists: { values: Judgement[]; listed: boolean }[] = [
      { values: ['oui'], listed: false }, { values: ['partiel'], listed: false }, { values: ['non'], listed: false },
      { values: ['oui', 'partiel', 'non'], listed: true }, { values: ['oui', 'oui', 'partiel', 'non', 'non', 'partiel', 'oui'], listed: true },
      { values: ['non', 'non'], listed: true },
    ]
    const domains: DomainFit[] = ['oui', 'partiel', 'non', 'non requis']
    const levels: LevelFit[] = ['oui', 'partiel', 'non', 'non précisé']
    let checked = 0
    for (const roles of roleSets) for (const req of lists) for (const sk of lists) for (const domain of domains) for (const level of levels) {
      const j: MatchJudgements = {
        roles, requirements: req.values, requirementsListed: req.listed, skills: sk.values, skillsListed: sk.listed, domain, level,
      }
      const b = scoreBreakdown(`${judgementSummary(j)} — Raison fictive.`)
      assert.ok(b, judgementSummary(j))
      assert.equal(b.score, judgedScore(j), judgementSummary(j))
      checked++
    }
    assert.equal(checked, 5 * 6 * 6 * 4 * 4)
  })

  it('donne la part de chaque critère en pourcentage et en points', () => {
    const b = scoreBreakdown(judgementSummary(judged({
      requirements: ['oui', 'partiel', 'non', 'oui'], skills: ['oui', 'non'], domain: 'non requis', level: 'partiel',
    })))
    assert.deepEqual(b?.parts.map(p => [p.key, p.percent, p.points, p.max]), [
      ['poste', 100, 30, 30], ['exigences', 63, 18.75, 30], ['competences', 50, 10, 20], ['domaine', 100, 15, 15], ['niveau', 50, 2.5, 5],
    ])
    assert.equal(b?.total, 76)
    assert.equal(b?.cap, null)
    assert.equal(b?.score, 76)
  })

  it('dit quel plafond abaisse le score : poste non exercé avant domaine absent', () => {
    const b = scoreBreakdown(judgementSummary(judged({
      roles: [{ title: 'Scrum Master', fit: 'oui' }, { title: 'Développeur Full Stack', fit: 'non' }], domain: 'non',
    })))
    assert.equal(b?.total, 70)
    assert.deepEqual(b?.cap, { value: 50, reason: 'un métier du titre de l’offre n’a pas été exercé' })
    assert.equal(b?.score, 50)
    assert.equal(b?.parts[0].detail, 'Scrum Master oui, Développeur Full Stack non')
  })

  it('ne signale pas un plafond qui n’abaisse rien', () => {
    const b = scoreBreakdown(judgementSummary(judged({ domain: 'partiel', requirements: ['non', 'non'], skills: ['non', 'non'] })))
    // Poste 30 + domaine voisin 7,5 + niveau 5 = 42,5 : sous le plafond de 80.
    assert.equal(b?.total, 43)
    assert.equal(b?.cap, null)
  })

  it('garde la suite de la raison : phrase de l’IA, recommandations', () => {
    const summary = judgementSummary(judged())
    assert.equal(scoreBreakdown(`${summary} — Manque l’expérience bancaire. — Recommandé sur : Java ×2 (+3 pts)`)?.rest,
      'Manque l’expérience bancaire. — Recommandé sur : Java ×2 (+3 pts)')
    assert.equal(scoreBreakdown(summary)?.rest, '')
  })

  it('lit un intitulé qui contient une virgule', () => {
    const b = scoreBreakdown(judgementSummary(judged({ roles: [{ title: 'Développeur Java, Spring', fit: 'partiel' }] })))
    assert.equal(b?.parts[0].percent, 50)
  })

  it('pas de détail pour un score d’avant la notation par jugements ou une raison coupée', () => {
    assert.equal(scoreBreakdown('Bon profil Java, 5 ans d’expérience.'), null)
    assert.equal(scoreBreakdown('Compétences : 6 sur 9 · Domaine : non · Niveau : oui'), null)
    assert.equal(scoreBreakdown(judgementSummary(judged()).slice(0, 60)), null)
    assert.equal(scoreBreakdown('Poste : oui · Exigences : 7 sur 3 · Compétences : oui · Domaine : oui · Niveau : oui'), null)
  })
})

describe('écart entre le score affiché et celui des jugements', () => {
  it('aucun écart, rien à dire', () => {
    assert.equal(scoreAdjustment('vivier', 62, 62, false), null)
  })

  it('base candidats et candidatures : les recommandations reçues', () => {
    assert.deepEqual(scoreAdjustment('pool', 66, 63, true), { label: 'Recommandations', value: 3 })
    assert.deepEqual(scoreAdjustment('application', 58, 60, false), { label: 'Recommandations', value: -2 })
  })

  it('ailleurs : un score enregistré par une version précédente de la notation', () => {
    assert.deepEqual(scoreAdjustment('vivier', 70, 66, false), { label: 'Écart avec une version précédente de la notation', value: 4 })
    assert.deepEqual(scoreAdjustment('pool', 70, 66, false), { label: 'Écart avec une version précédente de la notation', value: 4 })
  })
})

describe('ce que mesure chaque critère (aide affichée au recruteur)', () => {
  it('décrit les cinq critères, dans l’ordre et avec le poids du barème', () => {
    assert.deepEqual(CRITERIA.map(c => [c.key, c.weight]), Object.entries(SCORE_WEIGHTS))
    for (const c of CRITERIA) assert.ok(c.help.length > 80, c.key)
  })

  it('reprend les limites du code', () => {
    assert.ok(CRITERIA.find(c => c.key === 'exigences')?.help.includes(`${MAX_REQUIREMENTS} au plus`))
    assert.ok(CRITERIA.find(c => c.key === 'competences')?.help.includes(`${MAX_REQUIRED_SKILLS} au plus`))
  })
})
