import { strFromU8, unzipSync } from 'fflate'
import { stripInvisible } from './cv-data'

// Contrôle d'un CV rendu avant de le livrer : portage de la partie « fuites d'identité » de check_cv.py (skill
// cv-esn-anonymise). La pagination de check_cv.py demande LibreOffice, absent de Vercel : non portée.
// Différences voulues, pour pouvoir refuser automatiquement le fichier sans fausse alerte :
// - tout ce que contient déjà le template vierge appartient à l'ESN (bloc contact du commercial : nom, e-mail,
//   téléphone) : un terme n'est une fuite que s'il apparaît plus souvent dans le CV rendu que dans le template ;
// - les termes sont cherchés en mots entiers, sans accents ni casse (« Ali » ne correspond pas à « qualité ») ;
// - un téléphone connu est comparé sur ses chiffres (« 06/12/34/56/78 », « 06 12 345 678 ») ;
// - tout lien (site, profil, messagerie) absent du template bloque, pas seulement LinkedIn et GitHub.
// Fonction pure, testée dans leak-check.test.ts.

export type LeakKind = 'identity' | 'email' | 'phone' | 'link' | 'author' | 'comments' | 'revisions'

export interface Leak {
  kind: LeakKind
  value: string
}

const COMMENT_PARTS = ['word/comments.xml', 'word/people.xml']

const PHONE = /(?<![\w+])(?:(?:\+|00)[1-9]\d{0,2}[\s.()-]*(?:\(0\)[\s.-]*)?\d(?:[\s.()-]?\d){6,12}|0[1-9](?:[ .-]?\d{2}){4})(?!\d)/g
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
// Adresse web, ou profil / prise de contact sur un site connu écrit sans « https:// ». Pas de domaine nu en général :
// « ASP.NET » ou « Node.js » ne sont pas des liens.
const LINK = /(?:https?:\/\/|www\.)[^\s"'<>]+|\b(?:linkedin\.com|github\.com|gitlab\.com|malt\.(?:fr|com)|calendly\.com|wa\.me|t\.me|behance\.net|dribbble\.com|medium\.com|about\.me|twitter\.com|x\.com|stackoverflow\.com|kaggle\.com)\/[^\s"'<>]*/gi
// Suite de chiffres d'un numéro, quel que soit le découpage (espaces, points, barres obliques, parenthèses).
const DIGIT_RUN = /\+?\d[\d\s./()-]{6,}\d/g

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const digits = (s: string) => s.replace(/\D/g, '')
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function unescapeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

interface PackageText {
  /** Texte visible (balises remplacées par des espaces) + texte d'un paragraphe recollé (mots coupés en plusieurs runs). */
  visible: string
  /** Valeurs d'attributs : auteurs de révisions, cibles de liens (mailto:, LinkedIn), propriétés. */
  attributes: string
  authors: string[]
  parts: string[]
  hasRevisions: boolean
}

function packageText(docx: Uint8Array): PackageText {
  const files = unzipSync(docx)
  const parts = Object.keys(files)
  const xml = stripInvisible(parts.filter(name => /\.(xml|rels)$/.test(name)).map(name => strFromU8(files[name])).join(' '))
  const spaced = xml.replace(/<[^>]+>/g, ' ')
  const joined = xml.replace(/<\/w:p>|<w:tab\/>|<w:br\/>/g, ' ').replace(/<[^>]+>/g, '')
  const attributes = [...xml.matchAll(/=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => m[1] ?? m[2]).join(' ')
  return {
    visible: unescapeXml(`${spaced} ${joined}`),
    attributes: unescapeXml(attributes),
    authors: [...xml.matchAll(/w:author\s*=\s*"([^"]*)"/g)].map(m => unescapeXml(m[1])),
    parts,
    hasRevisions: /<w:(ins|del)\b/.test(xml),
  }
}

/** Termes d'identité du candidat : nom dans les deux ordres et collé (« camillefontaine.fr »), coordonnées, termes relevés par l'IA. */
export function identityTerms(candidate: { firstName: string; lastName: string; email: string; phone: string }, extra: string[]): string[] {
  const { firstName, lastName } = candidate
  const glued = (s: string) => s.replace(/[\s'’.-]+/g, '')
  return [
    firstName, lastName, `${firstName} ${lastName}`, `${lastName} ${firstName}`, glued(firstName + lastName), glued(lastName + firstName),
    candidate.email, candidate.phone, ...extra,
  ].filter(t => t.trim())
}

/** Un terme qui est un numéro (au moins 8 chiffres, surtout des chiffres) se compare sur ses 9 derniers chiffres. */
function phoneDigits(term: string): string | null {
  const d = digits(term)
  return d.length >= 8 && d.length >= term.replace(/\s/g, '').length * 0.6 ? d.slice(-9) : null
}

const countPhone = (text: string, nine: string) => [...text.matchAll(DIGIT_RUN)].filter(m => digits(m[0]).includes(nine)).length

function countTerm(haystack: string, term: string): number {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, 'gu')
  return haystack.match(pattern)?.length ?? 0
}

/**
 * Fuites d'identité dans le CV rendu. `terms` : identité du candidat (prénom, nom, e-mail, téléphone, adresse,
 * société personnelle…) ; `esn` : seul auteur admis dans les métadonnées et révisions. Liste vide = rien trouvé.
 */
export function findLeaks(docx: Uint8Array, template: Uint8Array, terms: string[], esn: string): Leak[] {
  const out = packageText(docx)
  const base = packageText(template)
  const leaks = new Map<string, Leak>()
  const add = (kind: LeakKind, value: string) => leaks.set(`${kind}:${fold(value)}`, { kind, value })

  const outText = fold(`${out.visible} ${out.attributes}`)
  const baseText = fold(`${base.visible} ${base.attributes}`)
  for (const term of terms) {
    const nine = phoneDigits(term)
    if (nine) {
      if (countPhone(out.visible, nine) > countPhone(base.visible, nine)) add('phone', term.trim())
      continue
    }
    const t = fold(term)
    if (t.length < 2) continue
    if (countTerm(outText, t) > countTerm(baseText, t)) add('identity', term.trim())
  }

  for (const author of out.authors) if (author.trim() && fold(author) !== fold(esn)) add('author', author)
  for (const part of COMMENT_PARTS) if (out.parts.includes(part)) add('comments', part)
  if (out.hasRevisions) add('revisions', 'révisions suivies')

  const allText = `${out.visible} ${out.attributes}`
  const templateEmails = new Set([...`${base.visible} ${base.attributes}`.matchAll(EMAIL)].map(m => m[0].toLowerCase()))
  for (const [email] of allText.matchAll(EMAIL)) if (!templateEmails.has(email.toLowerCase())) add('email', email)

  // Téléphones : texte visible et liens tel: seulement (les attributs Word sont pleins de suites de chiffres).
  const phoneText = (t: PackageText) => `${t.visible} ${[...t.attributes.matchAll(/tel:([^\s]+)/g)].map(m => m[1]).join(' ')}`
  const templatePhones = [...phoneText(base).matchAll(PHONE)].map(m => digits(m[0]).slice(-9))
  for (const [phone] of phoneText(out).matchAll(PHONE)) {
    if (!templatePhones.some(known => digits(phone).includes(known))) add('phone', phone.trim())
  }

  // Liens : ceux du template (espaces de noms XML, adresse du commercial) sont à l'ESN, tout autre lien bloque.
  const templateLinks = new Set([...`${base.visible} ${base.attributes}`.matchAll(LINK)].map(m => m[0].toLowerCase()))
  for (const [link] of allText.matchAll(LINK)) if (!templateLinks.has(link.toLowerCase())) add('link', link)
  return [...leaks.values()]
}

const LEAK_LABEL: Record<LeakKind, string> = {
  identity: 'élément d\'identité du candidat',
  email: 'adresse e-mail',
  phone: 'numéro de téléphone',
  link: 'lien (site, profil, messagerie)',
  author: 'auteur dans les métadonnées',
  comments: 'commentaires',
  revisions: 'révisions suivies',
}

/** Message pour l'admin : ce qui a bloqué l'export (l'admin voit déjà ces données dans la CV Thèque). */
export function leakMessage(leaks: Leak[]): string {
  const list = leaks.slice(0, 5).map(l => `${LEAK_LABEL[l.kind]} « ${l.value} »`).join(', ')
  return `Export bloqué : le document contient encore ${list}. Réessayez ; si le terme est un nom de client ou d'employeur, choisissez l'anonymisation renforcée. Si c'est un mot ordinaire du CV identique au nom du candidat (homonyme), l'export ne peut pas être fait automatiquement : préparez ce dossier dans Word.`
}
