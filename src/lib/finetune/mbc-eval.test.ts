import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { scaleKeys } from '../match-scoring'
import { judgeStudent, summarize, type TestItem } from './mbc-eval'

// CV et offre inventés.
const CV = `Développeur Java senior chez Exemple Banque (2019-2024).
Conception de microservices Spring Boot pour la gestion des paiements en temps réel.
Migration de l'application de crédit vers Kubernetes avec une équipe de huit personnes.`

function answer(exerce: 'oui' | 'non') {
  const a: Record<string, unknown> = {}
  for (const key of scaleKeys('matching')) {
    if (key === 'poste') a.poste = [{ metier: 'Développeur Java', exerce, intitule: exerce === 'oui' ? 'Développeur Java senior' : '' }]
    else if (key === 'exigences') a.exigences = { jugement: 'partiel', citation: '' }
    else if (key === 'competences') a.competences = [{ jugement: 'oui', citation: 'Conception de microservices Spring Boot pour la gestion des paiements' }]
    else a[key] = 'oui'
  }
  return JSON.stringify(a)
}

const item: TestItem = {
  id: 'scoring-matching:x', group: 'g', project: 'p', system: 's', messages: [{ role: 'user', content: 'u' }],
  ctx: { task: 'scoring-matching', scale: 'matching', skills: ['Java'], description: 'Microservices bancaires.', cvText: CV },
  teacher: answer('oui'),
}

describe("mesure d'un élève face à l'enseignant", () => {
  it('compte une réponse illisible pour l’application comme non valide', () => {
    const r = judgeStudent(item, 'Je ne sais pas.', 1200)
    assert.equal(r.valid, false)
    assert.equal(r.latencyMs, 1200)
  })

  it('mesure l’accord sur la décision « correspond » et l’écart de score', () => {
    const same = judgeStudent(item, answer('oui'), 900)
    assert.deepEqual([same.valid, same.agreement, same.scoreGap], [true, 1, 0])
    const other = judgeStudent(item, answer('non'), 900)
    assert.equal(other.valid, true)
    assert.ok((other.scoreGap ?? 0) > 0)
  })

  it('résume par tâche : réponses valides, accord, temps médian', () => {
    const [s] = summarize([judgeStudent(item, answer('oui'), 1000), judgeStudent(item, 'rien', 3000), judgeStudent(item, answer('oui'), 2000)])
    assert.equal(s.items, 3)
    assert.equal(s.validRate, 2 / 3)
    assert.equal(s.agreement, 1)
    assert.equal(s.medianLatencyMs, 2000)
  })
})
