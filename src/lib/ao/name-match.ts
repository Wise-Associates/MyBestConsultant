// Recherche de noms dans un texte, casse, accents et ponctuation ignorés. Partagée par l'anonymisation des offres
// publiées (anonymize.ts, serveur) et par la relecture de la version publiée dans le navigateur (ao-offer-detail.tsx) :
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

// Article juste avant un nom, qui ne s'accorde pas forcément avec le libellé qui le remplace : élidé (« L'ENSMIS »,
// « d’ENSMIS », « de l'ENSMIS », « à l' ENSMIS », « lorsqu'ENSMIS » : « L'Client confidentiel ») ou féminin (« la SNCF »,
// « de la SNCF », « une ESN », « cette école » : « la Grand groupe bancaire »). Les articles masculins restent.
const ARTICLE_BEFORE = /(?<![\p{L}\p{N}])(?:((?:(?:à|de)[ \t]+)?l|d|\p{L}*qu)['’‘][ \t]?|((?:(?:à|de)[ \t]+)?la|une|cette)[ \t]+)$/iu

/**
 * Remplace chaque nom par `label`. `withArticle` : texte qui remplace un nom précédé d'un article élidé ou féminin,
 * article compris ; reçoit l'article tel qu'écrit, sans l'apostrophe (« L », « d », « de l », « à l », « lorsqu », « la »,
 * « de la », « une », « cette »).
 */
export function replaceNames(text: string, names: string[][], label: string, withArticle?: (article: string) => string): string {
  let out = ''
  let pos = 0
  for (const { start, end } of occurrences(text, names)) {
    const before = text.slice(pos, start)
    const article = withArticle ? ARTICLE_BEFORE.exec(before) : null
    out += article && withArticle ? before.slice(0, article.index) + withArticle(article[1] ?? article[2]) : before + label
    pos = end
  }
  return out + text.slice(pos)
}

/**
 * Références d'appels d'offres, qui désignent la demande chez le client : jamais publiées.
 * - Codes de demande (« RFC00094023 », « DH038970 », « AO-0042 ») : 1 à 6 majuscules puis au moins 4 chiffres, d'un seul
 *   tenant. N'en sont pas, et restent : les normes (« ISO27001 », « IEC61508 », « EN50128 », « AS9100 », « IATF16949 »,
 *   « ISAE3402 », « MIL-STD-1553 ») et les versions datées d'une année (« AX2012 », « ES2015 ») ; « Java 17 » ou « 2026 »
 *   ne correspondent pas.
 * - Numéros d'avis et d'offres relevés par la veille : BOAMP « 26-105130 » (année sur deux chiffres, tiret, 6 chiffres),
 *   TED « 654321-2026 » (6 à 8 chiffres : les normes datées « ISO 27001-2022 », de 5 chiffres, restent) et, avant 2024,
 *   « 2023/S 123-456789 », Choisir le service public « 2026-2442607 » et « MEF_2026-33005 ». Restent aussi les dates
 *   (« 2026-01-15 »), les périodes (« 2025-2026 ») et les fourchettes de montants (« 45-550000 € »).
 */
export const REFERENCE_CODE = new RegExp([
  String.raw`\b(?!(?:ISO|IEC|EN|AS|IATF|ISAE|ARP|NF|STD)[-_]?\d)(?![A-Z]{1,6}[-_]?(?:19|20)\d{2}\b)[A-Z]{1,6}[-_]?\d{4,}\b`,
  String.raw`\b[A-Z]{2,6}_20\d{2}-\d{4,}\b`,
  String.raw`\b20\d{2}\/S[ \t]?\d{3}-\d{6}\b`,
  String.raw`\b\d{6,8}-20\d{2}\b`,
  String.raw`\b20\d{2}-\d{5,8}\b`,
  String.raw`\b\d{2}-\d{6}\b(?![ \t  ]*(?:€|[kK]€|[eE]uros?\b|EUR\b))`,
].join('|'), 'g')

/** Noms encore présents dans le texte, tels qu'écrits (relecture d'une version non anonymisée : noms de personnes). */
export function findNames(text: string, names: string[][]): string[] {
  return [...new Set(occurrences(text, names).map(({ start, end }) => text.slice(start, end)))]
}

/** Noms à masquer et références encore présents dans le texte, tels qu'écrits (relecture avant publication). */
export function findIdentifiers(text: string, names: string[][]): string[] {
  return [...new Set([...findNames(text, names), ...[...text.matchAll(REFERENCE_CODE)].map(m => m[0])])]
}
