// Recherche de noms dans un texte, casse, accents et ponctuation ignorés. Partagée par l'anonymisation des offres
// publiées (anonymize.ts, serveur) et par la relecture de la version publiée dans le navigateur (ao-offer-panel.tsx) :
// règles pures, sans dépendance serveur. Testées dans publication-copy.test.ts et ao.test.ts.

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

interface Token { start: number; end: number; word: string }

function tokens(text: string): Token[] {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map(m => ({ start: m.index, end: m.index + m[0].length, word: fold(m[0]) }))
}

/** Mots normalisés d'un nom (« Société Générale » → ['societe', 'generale']). */
export const words = (text: string) => tokens(text).map(t => t.word)

/** Chaque occurrence d'un des noms (suites de mots normalisés), les plus longs essayés d'abord par l'appelant. */
function occurrences(text: string, names: string[][]): { start: number; end: number }[] {
  const toks = tokens(text)
  const found: { start: number; end: number }[] = []
  for (let i = 0; i < toks.length; i++) {
    const name = names.find(n => n.every((w, k) => toks[i + k]?.word === w))
    if (!name) continue
    found.push({ start: toks[i].start, end: toks[i + name.length - 1].end })
    i += name.length - 1
  }
  return found
}

export function replaceNames(text: string, names: string[][], label: string): string {
  let out = ''
  let pos = 0
  for (const { start, end } of occurrences(text, names)) {
    out += text.slice(pos, start) + label
    pos = end
  }
  return out + text.slice(pos)
}

/**
 * Références d'appels d'offres (« RFC00094023 », « DH038970 », « AO-0042 ») : 1 à 6 majuscules puis au moins 4
 * chiffres, d'un seul tenant. Elles désignent la demande chez le client : jamais publiées. N'en sont pas, et restent :
 * les normes (« ISO27001 », « IEC61508 », « EN50128 », « AS9100 », « IATF16949 », « ISAE3402 », « MIL-STD-1553 ») et les
 * versions datées d'une année (« AX2012 », « ES2015 ») ; « Java 17 » ou « 2026 » ne correspondent pas.
 */
export const REFERENCE_CODE = /\b(?!(?:ISO|IEC|EN|AS|IATF|ISAE|ARP|NF|STD)[-_]?\d)(?![A-Z]{1,6}[-_]?(?:19|20)\d{2}\b)[A-Z]{1,6}[-_]?\d{4,}\b/g

/** Noms à masquer et références encore présents dans le texte, tels qu'écrits (relecture avant publication). */
export function findIdentifiers(text: string, names: string[][]): string[] {
  const found = [
    ...occurrences(text, names).map(({ start, end }) => text.slice(start, end)),
    ...[...text.matchAll(REFERENCE_CODE)].map(m => m[0]),
  ]
  return [...new Set(found)]
}
