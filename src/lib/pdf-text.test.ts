import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pageTextWithoutCopies, type PdfTextItem } from './pdf-text'

// Morceau de texte de 10 pt à la position (x, y), comme le donne pdf.js.
const at = (str: string, x: number, y: number, size = 10): PdfTextItem => ({ str, transform: [size, 0, 0, size, x, y], height: size })

/** Rendu par défaut de pdf-parse (render_page), la référence pour une page sans copie. */
function pdfParseDefault(items: PdfTextItem[]): string {
  let lastY: number | undefined
  let text = ''
  for (const item of items) {
    text += lastY === item.transform[5] || !lastY ? item.str : `\n${item.str}`
    lastY = item.transform[5]
  }
  return text
}

const PAGE = [
  at('Expériences', 190, 760),
  at('Entreprise Exemple', 190, 745), at(', Paris', 280, 745),
  at('• Pilotage du budget.', 200, 730),
  at('• Suivi des risques.', 200, 718),
]

describe('pageTextWithoutCopies', () => {
  it('rend une page sans copie exactement comme pdf-parse', () => {
    assert.equal(pageTextWithoutCopies(PAGE), pdfParseDefault(PAGE))
    assert.equal(pageTextWithoutCopies(PAGE), 'Expériences\nEntreprise Exemple, Paris\n• Pilotage du budget.\n• Suivi des risques.')
  })

  it('ne garde qu\'une fois une page dessinée plusieurs fois avec un décalage de quelques points (CV du 2026-11-12)', () => {
    // Même page dessinée 5 fois : deux fois au même endroit, puis 4, 8 et 12 pt plus bas.
    const shifts = [0, 0, 4, 8, 12]
    const drawn = shifts.flatMap(dy => PAGE.map(i => at(i.str, i.transform[4], i.transform[5] - dy)))
    assert.equal(pageTextWithoutCopies(drawn), pageTextWithoutCopies(PAGE))
  })

  it('retire la copie d\'un texte doublé pour faire du gras', () => {
    const bold = [at('Chef de projet', 190, 700), at('Chef de projet', 190.3, 700)]
    assert.equal(pageTextWithoutCopies(bold), 'Chef de projet')
  })

  it('garde deux lignes identiques qui se suivent sans se chevaucher (tableau, liste)', () => {
    const levels = [at('Courant', 300, 500), at('Courant', 300, 488), at('Courant', 300, 476)]
    assert.equal(pageTextWithoutCopies(levels), 'Courant\nCourant\nCourant')
  })

  it('reste linéaire sur un PDF hostile : 60 000 morceaux identiques empilés à 0,5 pt', () => {
    // Comparer chaque morceau à tous les précédents prendrait des secondes (1,8 milliard de comparaisons) ; borne large
    // pour une machine lente, l'algorithme borné prend quelques dizaines de millisecondes.
    const stacked = Array.from({ length: 60_000 }, (_, i) => at('x', 100, 30_000 - i * 0.5))
    const started = performance.now()
    assert.equal(pageTextWithoutCopies(stacked), 'x')
    assert.ok(performance.now() - started < 2_000, `${Math.round(performance.now() - started)} ms`)
    // Taille absurde ou illisible : morceau gardé, sans parcours démesuré.
    assert.equal(pageTextWithoutCopies([at('A', 10, 10, Number.NaN), at('A', 10, 10, 1e9), at('A', 10, 10, 1e9)]), 'A')
  })

  it('garde un même texte à une autre abscisse sur la même ligne', () => {
    const row = [at('Oui', 100, 400), at('Oui', 250, 400)]
    assert.equal(pageTextWithoutCopies(row), 'OuiOui')
  })
})
