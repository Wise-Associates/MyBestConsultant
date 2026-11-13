import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { csvCell, screeningCsv } from './screening-csv'

describe('export CSV du screening', () => {
  it('neutralise les formules et garde les virgules dans leur cellule', () => {
    assert.equal(csvCell('=HYPERLINK("https://x","Voir")'), `"'=HYPERLINK(""https://x"",""Voir"")"`)
    assert.equal(csvCell('-1+1'), `"'-1+1"`)
    assert.equal(csvCell('Dupont, Jean'), '"Dupont, Jean"')
  })

  it('écrit une ligne par résultat, colonnes alignées', () => {
    const csv = screeningCsv([{ candidateName: 'A, B', candidateEmail: 'a@b.fr', score: 80, recommendation: 'good', summary: 'ok', strengths: ['x', 'y'], concerns: [] }])
    const [header, row] = csv.split('\n')
    assert.equal(header.split('","').length, 7)
    assert.equal(row, '"A, B","a@b.fr","80","good","ok","x | y",""')
  })
})
