// Texte d'une page d'annonce, confié à l'IA (ADR 0031) : d'abord les données structurées JobPosting (schema.org) que
// publient la plupart des sites d'emploi, puis le texte visible, sans scripts, styles ni menus. Règles pures, testées
// dans page-text.test.ts. Le HTML vient d'un site tiers : il n'est jamais exécuté ni affiché, seulement réduit en texte.
//
// Temps de calcul LINÉAIRE garanti : la page (3 Mo au plus) est choisie par l'expéditeur d'un e-mail, et ce calcul
// tourne sur le fil principal du serveur, hors de portée du délai de lecture. Une expression régulière avec `[^>]*`, ou
// un analyseur HTML qui empile les balises (sanitize-html), coûte le carré de la taille sur une page hostile (« <script »
// répété sans « > ») : plusieurs minutes de serveur figé pour tous les utilisateurs (revue de sécurité du 2026-11-12).
// D'où un parcours vers l'avant, indexOf par indexOf, qui ne revient jamais en arrière ; page-text.test.ts le mesure.

/** Texte confié à l'IA au plus (une annonce tient en quelques milliers de caractères ; le reste est menu ou pied de page). */
export const MAX_PAGE_TEXT_CHARS = 30_000

// Balises qui terminent une ligne de texte.
const BLOCK_TAGS = new Set([
  'p', 'br', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'td', 'th', 'dt', 'dd', 'section', 'article', 'blockquote',
  'pre', 'table', 'ul', 'ol', 'title', 'header', 'main', 'aside', 'form', 'hr', 'label',
])
// Contenu jamais lu : scripts et styles, mais aussi navigation et pied de page (liens vers d'autres offres).
const SKIPPED_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'nav', 'footer', 'textarea', 'select', 'button'])

// Entités nommées courantes des pages françaises ; une entité inconnue reste telle quelle.
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“',
  rdquo: '”', hellip: '…', ndash: '–', mdash: '—', euro: '€', deg: '°', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â', auml: 'ä', ccedil: 'ç', icirc: 'î', iuml: 'ï',
  ocirc: 'ô', ouml: 'ö', ugrave: 'ù', ucirc: 'û', uuml: 'ü', yuml: 'ÿ', oelig: 'œ', aelig: 'æ', Eacute: 'É', Egrave: 'È',
  Ecirc: 'Ê', Agrave: 'À', Acirc: 'Â', Ccedil: 'Ç', Icirc: 'Î', Ocirc: 'Ô', Ugrave: 'Ù', Ucirc: 'Û', OElig: 'Œ',
}

/** Entités HTML décodées (nommées courantes et numériques) ; quantificateurs bornés, calcul linéaire. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/gi, (entity, body: string) => {
    if (body[0] !== '#') return ENTITIES[body] ?? entity
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : entity
  })
}

/** Copie en minuscules des seules lettres ASCII : même longueur que l'original, les positions restent valables. */
const asciiLower = (html: string) => html.replace(/[A-Z]+/g, s => s.toLowerCase())

/** « < » suivi d'une lettre, de « / » ou de « ! » : début de balise (sinon du texte, « TJM < 600 € »). */
function opensTag(html: string, lt: number): boolean {
  const c = html.charCodeAt(lt + 1) | 0x20
  return (c >= 0x61 && c <= 0x7a) || html[lt + 1] === '/' || html[lt + 1] === '!'
}

/** Texte lisible d'un fragment HTML : un bloc par ligne (sans ligne vide), entités décodées, espaces réduits. */
export function htmlToPlainText(html: string): string {
  const lower = asciiLower(html)
  const chunks: string[] = []
  // `textStart` : début du texte pas encore recopié ; un « < » qui n'ouvre pas de balise y reste, sans coupure.
  let at = 0
  let textStart = 0
  while (at < html.length) {
    const lt = html.indexOf('<', at)
    if (lt < 0) break
    if (!opensTag(html, lt)) { at = lt + 1; continue }
    chunks.push(html.slice(textStart, lt))
    textStart = html.length
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      if (end < 0) break
      at = textStart = end + 3
      continue
    }
    const gt = html.indexOf('>', lt + 1)
    // Balise jamais refermée : la suite n'est pas du texte (et ne sera pas reparcourue).
    if (gt < 0) break
    const name = /^<\/?([a-z][a-z0-9-]*)/.exec(lower.slice(lt, Math.min(gt + 1, lt + 40)))?.[1] ?? ''
    const closing = html[lt + 1] === '/'
    at = textStart = gt + 1
    if (!closing && SKIPPED_TAGS.has(name) && html[gt - 1] !== '/') {
      // Contenu sauté jusqu'à la première balise fermante du même nom (toujours vers l'avant).
      const end = lower.indexOf(`</${name}`, at)
      if (end < 0) break
      const endGt = html.indexOf('>', end)
      at = textStart = endGt < 0 ? html.length : endGt + 1
      chunks.push('\n')
      continue
    }
    if (BLOCK_TAGS.has(name)) chunks.push('\n')
  }
  if (textStart < html.length) chunks.push(html.slice(textStart))
  return decodeEntities(chunks.join(''))
    .split('\n')
    // \s couvre aussi l'espace insécable (U+00A0).
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** Contenu des blocs <script type="application/ld+json"> (au plus `max`), en un parcours vers l'avant. */
function ldJsonBlocks(html: string, lower: string, max: number): string[] {
  const blocks: string[] = []
  for (let at = 0; blocks.length < max;) {
    const open = lower.indexOf('<script', at)
    if (open < 0) break
    const gt = lower.indexOf('>', open)
    if (gt < 0) break
    const close = lower.indexOf('</script', gt)
    if (close < 0) break
    if (lower.slice(open, gt).includes('application/ld+json')) blocks.push(html.slice(gt + 1, close))
    at = close + 8
  }
  return blocks
}

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const textOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const isJobPosting = (node: Json) => [node['@type']].flat().some(t => t === 'JobPosting')

/** Nœuds JobPosting d'un bloc JSON-LD (objet, tableau ou @graph). */
function jobPostingsIn(data: unknown, depth = 0): Json[] {
  if (depth > 3) return []
  if (Array.isArray(data)) return data.slice(0, 50).flatMap(d => jobPostingsIn(d, depth + 1))
  if (!isObject(data)) return []
  if (isJobPosting(data)) return [data]
  return Array.isArray(data['@graph']) ? jobPostingsIn(data['@graph'], depth + 1) : []
}

function placeOf(location: unknown): string {
  const address = isObject(location) && isObject(location.address) ? location.address : null
  if (!address) return ''
  return [address.addressLocality, address.addressRegion, address.addressCountry].map(v => textOf(isObject(v) ? v.name : v)).filter(Boolean).join(', ')
}

function salaryOf(salary: unknown): string {
  if (!isObject(salary)) return textOf(salary)
  const value = isObject(salary.value) ? salary.value : null
  const amount = value ? [textOf(value.minValue), textOf(value.maxValue)].filter(Boolean).join(' à ') || textOf(value.value) : textOf(salary.value)
  const unit = textOf(value?.unitText) || textOf(salary.unitText)
  return [amount, textOf(salary.currency), unit && `par ${unit}`].filter(Boolean).join(' ')
}

/** Données d'une annonce JobPosting, sous des libellés que la consigne d'extraction reconnaît (« Date limite… »). */
function jobPostingText(node: Json): string {
  const organisation = isObject(node.hiringOrganization) ? textOf(node.hiringOrganization.name) : textOf(node.hiringOrganization)
  const experience = isObject(node.experienceRequirements) ? textOf(node.experienceRequirements.monthsOfExperience) && `${textOf(node.experienceRequirements.monthsOfExperience)} mois` : textOf(node.experienceRequirements)
  const lines: [string, string][] = [
    ['Intitulé', textOf(node.title)],
    ['Employeur', organisation],
    ['Lieu', [node.jobLocation].flat().slice(0, 5).map(placeOf).filter(Boolean).join(' ; ')],
    ['Télétravail', textOf(node.jobLocationType) === 'TELECOMMUTE' ? 'télétravail possible' : ''],
    ['Type de contrat', [node.employmentType].flat().slice(0, 10).map(textOf).filter(Boolean).join(', ')],
    ['Rémunération', salaryOf(node.baseSalary)],
    ['Expérience demandée', experience],
    ['Compétences', [node.skills].flat().slice(0, 50).map(textOf).filter(Boolean).join(', ')],
    ['Date de publication', textOf(node.datePosted)],
    ['Date limite de candidature', textOf(node.validThrough)],
  ]
  const description = htmlToPlainText(textOf(node.description).slice(0, MAX_PAGE_TEXT_CHARS))
  return [
    'Données structurées de l’annonce (JobPosting) :',
    // Valeurs parfois encodées en HTML par le site (« exp&eacute;rience ») : entités décodées, une ligne chacune.
    ...lines.filter(([, value]) => value).map(([label, value]) => `${label} : ${htmlToPlainText(value.slice(0, 1000)).replace(/\n/g, ' ').slice(0, 500)}`),
    description && `Description :\n${description}`,
  ].filter(Boolean).join('\n')
}

/** Texte de l'annonce : données JobPosting d'abord (au plus deux), puis le texte visible de la page. */
export function pageTextOf(html: string, maxChars = MAX_PAGE_TEXT_CHARS): string {
  const postings: string[] = []
  for (const block of ldJsonBlocks(html, asciiLower(html), 10)) {
    if (postings.length >= 2) break
    try {
      postings.push(...jobPostingsIn(JSON.parse(block)).slice(0, 2 - postings.length).map(jobPostingText))
    } catch {
      // Bloc JSON-LD mal formé (fréquent) ou trop imbriqué : la page est lue sans lui, son texte visible reste.
    }
  }
  const visible = htmlToPlainText(html)
  return [...postings, visible && `Texte de la page :\n${visible}`].filter(Boolean).join('\n\n').slice(0, maxChars)
}

const LOGIN_PATH = /\/(login|log-in|signin|sign-in|connexion|se-connecter|auth|authentification|account\/login)(\/|$|\?)/i
/** En dessous, une page avec un champ de mot de passe n'est qu'un formulaire de connexion. */
const LOGIN_TEXT_CHARS = 1500

/** Champ de mot de passe : chaque balise <input> examinée une seule fois, vers l'avant. */
function hasPasswordField(html: string): boolean {
  const lower = asciiLower(html)
  for (let at = 0; ;) {
    const open = lower.indexOf('<input', at)
    if (open < 0) return false
    const gt = lower.indexOf('>', open)
    if (gt < 0) return false
    if (/\btype\s*=\s*["']?password\b/.test(lower.slice(open, gt))) return true
    at = gt + 1
  }
}

/**
 * Page de connexion : adresse de connexion (souvent la cible d'une redirection), ou champ de mot de passe sur une page
 * presque sans texte. Un formulaire « Se connecter » dans l'en-tête d'une annonce publique ne compte pas.
 */
export function isLoginPage({ html, path, textLength }: { html: string; path: string; textLength: number }): boolean {
  if (LOGIN_PATH.test(path)) return true
  return textLength < LOGIN_TEXT_CHARS && hasPasswordField(html)
}

/** Encodage de la page : en-tête Content-Type, sinon balise <meta> des 4 premiers ko du document, sinon UTF-8. */
export function charsetOf(contentType: string, head: string): string {
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType.slice(0, 200))?.[1]
  const fromMeta = /<meta\b[^>]*charset\s*=\s*["']?([\w-]+)/i.exec(head.slice(0, 4096))?.[1]
  return (fromHeader ?? fromMeta ?? 'utf-8').toLowerCase()
}

/** Octets reçus décodés selon `charset` ; encodage inconnu : UTF-8 (les caractères accentués seront peut-être abîmés). */
export function decodePage(body: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(body)
  } catch {
    return new TextDecoder('utf-8').decode(body)
  }
}
