import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { withRecommendationBonus } from './recommendation-boost'

// Une seule règle pour les recommandations (ADR 0029) : un bonus sur les expertises de l'offre, pour la base candidats
// comme pour les candidatures. Il ne baisse jamais un score et ne fait pas passer le seuil de 65.
const job = 'Développeur Python — Python, Django, PostgreSQL'
const rec = (...endorsedExpertises: string[]) => ({ endorsedExpertises })

describe('bonus des recommandations', () => {
  it('sans recommandation sur une expertise de l\'offre, score et raison inchangés', () => {
    assert.deepEqual(withRecommendationBonus(72, 'Raison.', [], job), { score: 72, reason: 'Raison.', points: 0 })
    assert.deepEqual(withRecommendationBonus(72, 'Raison.', [rec('Cobol')], job), { score: 72, reason: 'Raison.', points: 0 })
  })

  it('ajoute les points et les dit dans la raison', () => {
    assert.deepEqual(withRecommendationBonus(72, 'Raison.', [rec('Python'), rec('Python')], job), {
      score: 76, reason: 'Raison. — Recommandé sur : Python ×2 (+4 pts)', points: 4,
    })
  })

  it('ne fait pas passer le seuil de 65 à un candidat noté en dessous', () => {
    assert.equal(withRecommendationBonus(60, 'R', [rec('Python'), rec('Python'), rec('Python'), rec('Django')], job).score, 64)
  })

  it('ne baisse jamais le score, même avec de mauvaises notes en étoiles', () => {
    const r = withRecommendationBonus(90, 'R', [{ endorsedExpertises: [], rating: 1 } as { endorsedExpertises: string[] }], job)
    assert.equal(r.score, 90)
  })
})
