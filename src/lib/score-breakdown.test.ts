import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_REQUIRED_SKILLS, MAX_REQUIREMENTS, NEUTRAL, SCALES, judgedScore, judgementSummary, scaleKeys,
  type ActiveScale, type Fit, type FitKey, type Judgement, type MatchJudgements, type RoleFit,
} from './match-scoring'
import { criteriaOf, scoreAdjustment, scoreBreakdown } from './score-breakdown'

const ALL_YES: MatchJudgements['fits'] = { projet: 'oui', client: 'oui', localisation: 'oui', niveau: 'oui', formation: 'oui', domaine: 'oui', langue: 'oui', tjm: 'oui' }
const judged = (over: Partial<MatchJudgements> = {}, fits: MatchJudgements['fits'] = {}, scale: ActiveScale = 'matching'): MatchJudgements => ({
  scale, roles: [{ title: 'Développeur Full Stack', fit: 'oui' }], requirements: ['oui', 'oui'], requirementsListed: true,
  skills: ['oui', 'oui'], skillsListed: true, fits: { ...ALL_YES, ...fits }, ...over,
})

const roleSets: RoleFit[][] = [
  [{ title: '', fit: 'oui' }], [{ title: '', fit: 'partiel' }], [{ title: 'Chef de projet', fit: 'non' }],
  [{ title: 'Scrum Master', fit: 'oui' }, { title: 'Développeur Full Stack', fit: 'non' }],
  [{ title: 'Product Owner', fit: 'partiel' }, { title: 'Business Analyst', fit: 'oui' }],
]
const lists: { values: Judgement[]; listed: boolean }[] = [
  { values: ['oui'], listed: false }, { values: ['partiel'], listed: false }, { values: ['non'], listed: false },
  { values: ['oui', 'partiel', 'non'], listed: true }, { values: ['oui', 'oui', 'partiel', 'non', 'non', 'partiel', 'oui'], listed: true },
  { values: ['non', 'non'], listed: true }, { values: ['oui', 'non', 'non'], listed: true },
]

/** Critères à une seule valeur d'un barème : chacun pris dans ses quatre valeurs (les autres à « oui »), puis tous neutres, tous à « non ». */
function fitVariants(scale: ActiveScale): MatchJudgements['fits'][] {
  const keys = scaleKeys(scale).filter((k): k is FitKey => k in NEUTRAL)
  const each = keys.flatMap(key => (['oui', 'partiel', 'non', NEUTRAL[key]] as Fit[]).map(fit => ({ [key]: fit })))
  return [...each, Object.fromEntries(keys.map(k => [k, NEUTRAL[k]])), Object.fromEntries(keys.map(k => [k, 'non']))]
}

describe('détail d’un score du Matching IA', () => {
  it('redonne exactement le score calculé, pour les deux barèmes et toutes les combinaisons de jugements', () => {
    let checked = 0
    for (const scale of ['matching', 'final'] as const) {
      for (const roles of roleSets) for (const req of lists) for (const sk of lists) for (const fits of fitVariants(scale)) {
        const j = judged({ roles, requirements: req.values, requirementsListed: req.listed, skills: sk.values, skillsListed: sk.listed }, fits, scale)
        const b = scoreBreakdown(`${judgementSummary(j)} — Raison fictive.`)
        assert.ok(b, judgementSummary(j))
        assert.equal(b.scale, scale)
        assert.equal(b.score, judgedScore(j), judgementSummary(j))
        checked++
      }
    }
    assert.equal(checked, roleSets.length * lists.length ** 2 * (fitVariants('matching').length + fitVariants('final').length))
  })

  it('relit les scores enregistrés avec le barème d’avant (ADR 0028) : même calcul qu’alors', () => {
    // Calcul du barème d'avant le 2026-11-15, recopié ici : poste 30, exigences 30, compétences 20, domaine 15, niveau 5.
    const points = { oui: 1, partiel: 0.5, non: 0, 'non requis': 1, 'non précisé': 1 } as const
    const mean = (v: Judgement[]) => v.reduce((s, x) => s + points[x], 0) / v.length
    const tally = (v: Judgement[], listed: boolean) => {
      if (!listed) return v[0]
      const partial = v.filter(x => x === 'partiel').length
      return `${v.filter(x => x === 'oui').length} sur ${v.length}${partial ? `, ${partial} partielle${partial > 1 ? 's' : ''}` : ''}`
    }
    for (const roles of roleSets) for (const req of lists) for (const sk of lists) {
      for (const domain of ['oui', 'partiel', 'non', 'non requis'] as const) for (const level of ['oui', 'partiel', 'non', 'non précisé'] as const) {
        const fits = roles.map(r => r.fit)
        const total = Math.round(30 * mean(fits) + 30 * mean(req.values) + 20 * mean(sk.values) + 15 * points[domain] + 5 * points[level])
        const cap = Math.min(fits.includes('non') ? 50 : fits.includes('partiel') ? 75 : 100, domain === 'non' ? 60 : domain === 'partiel' ? 80 : 100)
        const summary = `Poste : ${roles.map(r => (r.title ? `${r.title} ${r.fit}` : r.fit)).join(', ')} · Exigences : ${tally(req.values, req.listed)}`
          + ` · Compétences : ${tally(sk.values, sk.listed)} · Domaine : ${domain} · Niveau : ${level}`
        const b = scoreBreakdown(`${summary} — Raison fictive.`)
        assert.equal(b?.scale, 'legacy', summary)
        assert.equal(b?.score, Math.min(total, cap), summary)
      }
    }
    const old = scoreBreakdown('Poste : oui · Exigences : 1 sur 3, 1 partielle · Compétences : 1 sur 2 · Domaine : non requis · Niveau : oui')
    assert.deepEqual(old?.parts.map(p => p.label), ['Poste', 'Exigences', 'Compétences', 'Domaine', 'Niveau'])
  })

  it('donne la part de chaque critère en pourcentage et en points', () => {
    const b = scoreBreakdown(judgementSummary(judged({ requirements: ['oui', 'partiel', 'non', 'oui'], skills: ['oui', 'non'] }, { domaine: 'non requis', niveau: 'partiel' })))
    assert.deepEqual(b?.parts.map(p => [p.key, p.label, p.percent, p.points, p.max]), [
      ['poste', 'Poste', 100, 20, 20], ['exigences', 'Contexte', 63, 6.25, 10], ['projet', 'Projet', 100, 5, 5],
      ['competences', 'Techno', 50, 10, 20], ['localisation', 'Localisation', 100, 8, 8], ['niveau', 'Séniorité', 50, 5, 10],
      ['formation', 'Formation', 100, 6, 6], ['domaine', 'Secteur', 100, 10, 10], ['langue', 'Langue', 100, 6, 6], ['tjm', 'TJM', 100, 5, 5],
    ])
    assert.equal(b?.total, 81)
    assert.equal(b?.cap, null)
    assert.equal(b?.score, 81)
  })

  it('dit quel plafond abaisse le score : poste non exercé avant secteur absent', () => {
    const b = scoreBreakdown(judgementSummary(judged({
      roles: [{ title: 'Scrum Master', fit: 'oui' }, { title: 'Développeur Full Stack', fit: 'non' }],
    }, { domaine: 'non' })))
    assert.equal(b?.total, 80)
    assert.deepEqual(b?.cap, { value: 50, reason: 'un métier du titre de l’offre n’a pas été exercé' })
    assert.equal(b?.score, 50)
    assert.equal(b?.parts[0].detail, 'Scrum Master oui, Développeur Full Stack non')
  })

  it('nomme le critère rouge qui manque : technologies, environnement du client', () => {
    assert.deepEqual(scoreBreakdown(judgementSummary(judged({ skills: ['oui', 'non', 'non', 'non'] })))?.cap,
      { value: 60, reason: 'moins d’un tiers des technologies et outils demandés' })
    assert.deepEqual(scoreBreakdown(judgementSummary(judged({}, { client: 'non' }, 'final')))?.cap,
      { value: 60, reason: 'aucune expérience de l’environnement du client' })
  })

  it('ne signale pas un plafond qui n’abaisse rien', () => {
    const b = scoreBreakdown(judgementSummary(judged({ roles: [{ title: '', fit: 'non' }], requirements: ['non'], skills: ['non'] }, { domaine: 'non' })))
    // Projet 5 + localisation 8 + séniorité 10 + formation 6 + langue 6 + TJM 5 = 40 : sous tous les plafonds.
    assert.equal(b?.total, 40)
    assert.equal(b?.cap, null)
  })

  it('garde la suite de la raison : phrase de l’IA, recommandations', () => {
    const summary = judgementSummary(judged())
    assert.equal(scoreBreakdown(`${summary} — Manque l’expérience bancaire. — Recommandé sur : Java ×2 (+3 pts)`)?.rest,
      'Manque l’expérience bancaire. — Recommandé sur : Java ×2 (+3 pts)')
    assert.equal(scoreBreakdown(summary)?.rest, '')
  })

  it('lit un intitulé qui contient une virgule', () => {
    const b = scoreBreakdown(judgementSummary(judged({ roles: [{ title: 'Développeur Java, Spring', fit: 'partiel' }] }, {}, 'final')))
    assert.equal(b?.parts[0].percent, 50)
  })

  it('pas de détail pour un score d’avant la notation par jugements ou une raison coupée', () => {
    assert.equal(scoreBreakdown('Bon profil Java, 5 ans d’expérience.'), null)
    assert.equal(scoreBreakdown('Compétences : 6 sur 9 · Domaine : non · Niveau : oui'), null)
    assert.equal(scoreBreakdown(judgementSummary(judged()).slice(0, 120)), null)
    assert.equal(scoreBreakdown('Poste : oui · Exigences : 7 sur 3 · Compétences : oui · Domaine : oui · Niveau : oui'), null)
    assert.equal(scoreBreakdown(judgementSummary(judged({}, {}, 'final')).replace('Client : oui', 'Client : non requis')), null, 'valeur neutre d’un autre critère')
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
  it('décrit les critères de chaque barème, dans l’ordre, avec leur poids et les critères essentiels', () => {
    for (const scale of ['matching', 'final'] as const) {
      assert.deepEqual(criteriaOf(scale).map(c => [c.key, c.weight]), Object.entries(SCALES[scale].weights))
      for (const c of criteriaOf(scale)) assert.ok(c.help.length > 80, c.key)
    }
    assert.deepEqual(criteriaOf('final').filter(c => c.capped).map(c => c.key), ['poste', 'competences', 'client'])
    assert.deepEqual(criteriaOf('matching').filter(c => !c.capped).map(c => c.key), ['exigences', 'projet', 'tjm'])
  })

  it('reprend les limites du code', () => {
    assert.ok(criteriaOf('matching').find(c => c.key === 'exigences')?.help.includes(`${MAX_REQUIREMENTS} au plus`))
    assert.ok(criteriaOf('final').find(c => c.key === 'competences')?.help.includes(`${MAX_REQUIRED_SKILLS} au plus`))
  })
})
