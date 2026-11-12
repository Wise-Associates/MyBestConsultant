// Texte d'une page de PDF à partir des morceaux de texte de pdf.js (getTextContent), sans les copies superposées.
// Certains générateurs de CV dessinent toute la page plusieurs fois, chaque copie décalée de quelques points
// (CV du 2026-11-12 : page 1 dessinée 5 fois, page 2 7 fois, 4 pt d'écart ; 68 000 caractères extraits pour 11 400).
// Le lecteur n'en voit qu'une, mais l'extraction les rendait toutes : le texte, coupé à sa limite, partait à l'IA avec
// la page 1 répétée et la fin du CV manquante, et l'export « Format ESN » perdait trois expériences et la moitié des
// puces. Deux morceaux identiques qui se chevauchent (même texte, même abscisse, écart vertical inférieur à la taille
// du texte) sont une même ligne dessinée deux fois : deux vraies lignes identiques ne peuvent pas se chevaucher et
// rester lisibles. Pur, testé dans pdf-text.test.ts.

/** Morceau de texte de pdf.js : `transform` = [a, b, c, d, x, y] (taille du texte dans c et d). */
export interface PdfTextItem {
  str: string
  transform: number[]
  height?: number
}

// Une copie décalée pour simuler du gras est à quelques dixièmes de point.
const SAME_X_PT = 1
// Le PDF vient d'un candidat (non fiable) : chaque morceau ne compare sa position qu'à celles des cases voisines (texte,
// abscisse au point près, bande verticale de BAND_PT), au plus MAX_PER_CELL par case, et l'écart cherché est borné par
// MAX_SIZE_PT. Des milliers de morceaux identiques coûtent donc un temps proportionnel à leur nombre, jamais son carré.
const BAND_PT = 4
const MAX_SIZE_PT = 48
const MAX_PER_CELL = 4

/**
 * Texte de la page, une ligne par position verticale, comme le rendu par défaut de pdf-parse, sans les morceaux qui
 * chevauchent un morceau identique déjà vu (copie superposée). Sans copie, le texte est celui de pdf-parse.
 */
export function pageTextWithoutCopies(items: PdfTextItem[]): string {
  // Positions vues, copies comprises : une copie décalée de 4 pt d'une copie elle-même décalée est reconnue.
  const seen = new Map<string, { x: number; y: number }[]>()
  const cell = (str: string, cx: number, band: number) => `${cx}\u0000${band}\u0000${str}`
  let lastY: number | undefined
  let text = ''
  for (const item of items) {
    const [, , c = 0, d = 0, x = 0, y = 0] = item.transform
    const size = Math.min(Math.max(Math.hypot(c, d), item.height ?? 0), MAX_SIZE_PT)
    const cx = Math.round(x)
    const band = Math.floor(y / BAND_PT)
    const reach = Math.ceil(size / BAND_PT)
    let isCopy = false
    // Taille ou position illisible (NaN) : aucune case parcourue, le morceau est gardé.
    for (let dx = -1; dx <= 1 && !isCopy; dx++) {
      for (let db = -reach; db <= reach && !isCopy; db++) {
        isCopy = (seen.get(cell(item.str, cx + dx, band + db)) ?? []).some(p => Math.abs(p.x - x) < SAME_X_PT && Math.abs(p.y - y) < size)
      }
    }
    const own = seen.get(cell(item.str, cx, band)) ?? []
    if (own.length < MAX_PER_CELL) seen.set(cell(item.str, cx, band), [...own, { x, y }])
    if (isCopy) continue
    // Même jonction que render_page de pdf-parse (y compris son « !lastY ») : un PDF sans copie donne le même texte.
    text += lastY === y || !lastY ? item.str : `\n${item.str}`
    lastY = y
  }
  return text
}
