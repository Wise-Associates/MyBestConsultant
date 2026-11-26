import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { featureLabel, outcomeLabel } from './usage-labels'

/** Fichiers .ts et .tsx de src, sans les tests. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

describe('libellés de la page « Consommation IA »', () => {
  it('chaque fonction écrite dans le code a un libellé en français', () => {
    const features = new Set<string>()
    for (const file of sources(join(process.cwd(), 'src'))) {
      const text = readFileSync(file, 'utf-8')
      for (const m of text.matchAll(/feature: '([a-z0-9-]+)'/g)) features.add(m[1])
      // Étapes de MBC Search (askAi, apollo.ts) et barèmes de la notation (askScoring, sourcing-core.ts).
      for (const m of text.matchAll(/askAi\('([a-z0-9-]+)'/g)) features.add(`mbc-search-${m[1]}`)
    }
    for (const scale of ['matching', 'final']) features.add(`scoring-${scale}`)
    assert.ok(features.size > 30, `${features.size} fonctions trouvées`)
    assert.deepEqual([...features].filter(f => featureLabel(f) === f), [])
  })

  it('décrit chaque résultat sans le message d’erreur', () => {
    assert.equal(outcomeLabel('ok'), 'Réussi')
    assert.equal(outcomeLabel('http-529'), 'Erreur HTTP 529')
    assert.equal(outcomeLabel('timeout'), 'Délai dépassé')
    assert.equal(outcomeLabel('autre'), 'Erreur')
  })
})
