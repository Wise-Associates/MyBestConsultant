import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { skillKey } from './cvtheque-search'
import { SKILL_IMPLIES, SKILL_VARIANTS } from './skill-equivalences'

// Cohérence des tables d'équivalences (ADR 0057) : une erreur de saisie y rapprocherait des profils sans rapport.
describe('Tables d\'équivalences de compétences', () => {
  it('chaque écriture n\'appartient qu\'à un groupe', () => {
    const seen = new Map<string, string>()
    for (const group of SKILL_VARIANTS) {
      for (const v of group) {
        const k = skillKey(v)
        assert.ok(k, `écriture vide dans ${group[0]}`)
        const owner = seen.get(k)
        assert.ok(!owner || owner === group[0], `« ${v} » est à la fois dans ${owner} et ${group[0]}`)
        seen.set(k, group[0])
      }
    }
  })

  it('aucune implication ne revient à son point de départ (sens unique)', () => {
    const usual = new Map(SKILL_VARIANTS.flatMap(g => g.map(v => [skillKey(v), skillKey(g[0])] as const)))
    const key = (s: string) => usual.get(skillKey(s)) ?? skillKey(s)
    const next = new Map<string, string[]>()
    for (const [from, targets] of SKILL_IMPLIES) {
      assert.ok(targets.length > 0, `${from} n'implique rien`)
      next.set(key(from), [...(next.get(key(from)) ?? []), ...targets.map(key)])
    }
    for (const start of next.keys()) {
      const reached = [...(next.get(start) ?? [])]
      for (let i = 0; i < reached.length; i++) {
        assert.notEqual(reached[i], start, `boucle depuis ${start}`)
        for (const n of next.get(reached[i]) ?? []) if (!reached.includes(n)) reached.push(n)
      }
    }
  })

  it('ne relie jamais Java et JavaScript', () => {
    const javaLike = (s: string) => ['java', 'javascript'].includes(skillKey(s))
    for (const group of SKILL_VARIANTS) assert.ok(group.filter(javaLike).length <= 1, group.join(', '))
    for (const [from, targets] of SKILL_IMPLIES) {
      if (skillKey(from) === 'javascript') assert.ok(!targets.some(t => skillKey(t) === 'java'))
      if (skillKey(from) === 'java') assert.ok(!targets.some(t => skillKey(t) === 'javascript'))
    }
  })
})
