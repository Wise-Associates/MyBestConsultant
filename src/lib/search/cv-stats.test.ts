import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RISING_MIN_CVS, cvStatsView, risingSkills, sinceFilter, statsFilter } from './cv-stats'

const now = new Date('2026-11-18T10:00:00.000Z')

// Comptes fictifs, tels que Meilisearch les renvoie.
const raw = {
  facetDistribution: {
    kind: { candidate: 40 },
    jobFamily: { developpement: 18, pilotage_projet: 12, inconnue: 2 },
    skills: { Java: 15, SQL: 15, Jira: 9, ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`Outil ${i}`, 1])) },
    seniority: { senior: 10, junior: 5, expert: 2, confirme: 20, non_precise: 3 },
    educationLevel: { 'bac+5': 25, bac: 3, non_precise: 12 },
    city: { Paris: 20, '': 4 },
    yearsOfExperience: { 3: 1 },
  },
  facetStats: { yearsOfExperience: { min: 0.4, max: 31.6 }, dailyRate: { min: 350, max: 900 } },
}

describe('statistiques des CV classés (ADR 0044, phase 3)', () => {
  it('compte les CV du périmètre et nomme les valeurs des listes fermées', () => {
    const v = cvStatsView(raw, now)
    assert.equal(v.total, 40)
    assert.deepEqual(v.families.map(r => [r.label, r.count, r.share]), [['Développement', 18, 0.45], ['Pilotage de projet, PMO', 12, 0.3], ['inconnue', 2, 0.05]])
    assert.deepEqual(v.cities.map(r => r.label), ['Paris'])
    assert.deepEqual([v.years, v.dailyRate], [{ min: 0, max: 32 }, { min: 350, max: 900 }])
  })

  it('classe les listes ouvertes par nombre, et garde l\'ordre des échelles', () => {
    const v = cvStatsView(raw, now)
    assert.equal(v.skills.length, 20)
    assert.deepEqual(v.skills.slice(0, 3).map(r => r.label), ['Java', 'SQL', 'Jira'])
    assert.deepEqual(v.seniority.map(r => r.key), ['junior', 'confirme', 'senior', 'expert', 'non_precise'])
    assert.deepEqual(v.education.map(r => r.label), ['Bac', 'Bac +5', 'Non précisé'])
  })

  it('reste lisible sans aucun CV', () => {
    const v = cvStatsView({}, now)
    assert.equal(v.total, 0)
    assert.deepEqual([v.families, v.skills, v.years], [[], [], null])
  })

  it('limite le vivier au recruteur et n\'accepte que des identifiants Appwrite', () => {
    assert.equal(statsFilter({ kind: 'pool' }), 'kind = "candidate" AND role = "candidate"')
    assert.equal(statsFilter({ kind: 'vivier', tenantId: 'orgA', ownerId: 'profilB' }), 'kind = "vivier" AND tenantId = "orgA" AND ownerId = "profilB"')
    assert.equal(statsFilter({ kind: 'vivier', tenantId: 'orgA" OR kind = "candidate', ownerId: 'profilB' }), null)
  })

  it('donne à l\'admin la plateforme entière, les profils des chasseurs et tous les viviers', () => {
    assert.equal(statsFilter({ kind: 'platform' }), 'kind IN ["candidate", "vivier"]')
    assert.equal(statsFilter({ kind: 'hunters' }), 'kind = "candidate" AND role = "hunter_profile"')
    assert.equal(statsFilter({ kind: 'viviers' }), 'kind = "vivier"')
  })

  it('réunit les viviers de tous les recruteurs d\'une organisation, et elle seule', () => {
    assert.equal(statsFilter({ kind: 'tenant', tenantId: 'orgA' }), 'kind = "vivier" AND tenantId = "orgA"')
    assert.equal(statsFilter({ kind: 'tenant', tenantId: '' }), null)
    assert.equal(statsFilter({ kind: 'tenant', tenantId: 'orgA" OR kind = "candidate' }), null)
  })
})

describe('fraîcheur et tendances des CV (dates de dépôt)', () => {
  const dated = {
    facetDistribution: {
      kind: { candidate: 50 },
      // Mois de dépôt : 2 ce mois-ci, 10 il y a 2 mois, 8 il y a 5 mois, 12 il y a 18 mois, 13 il y a 3 ans, 5 sans date.
      cvMonth: { '2026-11': 2, '2026-09': 10, '2026-06': 8, '2025-05': 12, '2023-11': 13, 'pas-un-mois': 4 },
    },
  }

  it('range les CV par âge, la date inconnue à part', () => {
    const v = cvStatsView(dated, now)
    assert.deepEqual(v.freshness.map(r => [r.label, r.count]), [
      ['Moins de 3 mois', 12], ['3 à 12 mois', 8], ['1 à 2 ans', 12], ['Plus de 2 ans', 13], ['Date inconnue', 5],
    ])
    assert.equal(v.lastYearShare, 20 / 50)
  })

  it('donne les dépôts des 12 derniers mois, mois vides compris', () => {
    const v = cvStatsView(dated, now)
    assert.equal(v.monthly.length, 12)
    assert.deepEqual([v.monthly[0].month, v.monthly[11].month], ['2025-12', '2026-11'])
    assert.deepEqual(v.monthly.filter(m => m.count > 0).map(m => [m.month, m.count]), [['2026-06', 8], ['2026-09', 10], ['2026-11', 2]])
    assert.match(v.monthly[11].label, /nov\.? 2026/)
  })

  it('repère les compétences en hausse, seulement avec assez de CV de chaque côté', () => {
    const recent = { facetDistribution: { kind: { candidate: 20 }, skills: { Python: 10, Java: 4, Kotlin: 2, SQL: 6 } } }
    const older = { facetDistribution: { kind: { candidate: 40 }, skills: { Python: 4, Java: 16, SQL: 12 } } }
    // Python : 50 % contre 10 % ; SQL : 30 % contre 30 % (pas en hausse) ; Java en baisse ; Kotlin : trop peu de CV.
    assert.deepEqual(risingSkills(recent, older), [{ label: 'Python', recentShare: 0.5, olderShare: 0.1, delta: 40 }])
    assert.equal(risingSkills({ facetDistribution: { kind: { candidate: RISING_MIN_CVS - 1 } } }, older), null)
  })

  it('sépare les CV récents des anciens par leur date de dépôt', () => {
    const cut = Math.floor(Date.UTC(2026, 4, 18) / 1000)
    assert.equal(sinceFilter('kind = "candidate"', 6, now, 'recent'), `kind = "candidate" AND cvDate >= ${cut}`)
    assert.equal(sinceFilter('kind = "candidate"', 6, now, 'older'), `kind = "candidate" AND cvDate < ${cut}`)
  })
})
