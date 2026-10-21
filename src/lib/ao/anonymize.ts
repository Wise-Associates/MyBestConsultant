import { LEGAL_SUFFIXES } from './fingerprint'
import type { AoOfferFields } from './types'

// Anonymisation des offres publiées depuis AO Offers : le client final et l'intermédiaire qui a envoyé
// l'appel d'offres ne doivent pas apparaître sur le site, ni les coordonnées des interlocuteurs.
// L'admin relit l'aperçu avant publication ; ces règles sont le filet de sécurité appliqué côté serveur
// à tout ce qui est publié (titre, description, ville, compétences).

export const DEFAULT_CLIENT_LABEL = 'Client confidentiel'

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g
// Adresses déguisées : « jean.dupont [at] esn [dot] fr », « contact(arobase)esn.fr ».
const OBFUSCATED_EMAIL = /[\w.+-]+\s*[[({]\s*(?:at|arobase)\s*[\])}]\s*[\w-]+(?:\s*(?:[[({]\s*(?:dot|point)\s*[\])}]|\.)\s*[\w-]+)+/gi
const URL = /\b(?:https?:\/\/|www\.)[^\s)>\]]+/gi
// Numéros français (01 23 45 67 89, +33 6 12 34 56 78, 0612345678) et internationaux (+44 20 7946 0958).
const PHONE = /(?:(?:\+|00)33\s?\(?0?\)?\s?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b|(?:\+|00)\d{2,3}(?:[\s.-]?\d{2,4}){3,5}/g
// Lignes de contact typiques des appels d'offres : « Contact : Marie Dupont », « Tél. : … », « Réf. interne … ».
// Préfixe « ### » admis : les tableaux joints donnent une section titrée par colonne (spreadsheet.ts).
const CONTACT_LINE = /^\s*(?:#{1,6}\s*)?[-*•]?\s*\**\s*(contact|interlocut\w*|responsable du recrutement|recruteur|t[ée]l(?:[ée]phone)?\.?|mobile|portable|e-?mail|courriel|mail|r[ée]f(?:[ée]rence)?\.?\s*interne)\b.*$/gim

/** Messageries grand public et notre propre domaine : leur nom n'identifie pas l'expéditeur. */
const NON_IDENTIFYING_DOMAINS = new Set([
  'gmail', 'googlemail', 'outlook', 'hotmail', 'live', 'msn', 'yahoo', 'icloud', 'me', 'aol', 'gmx', 'proton', 'protonmail',
  'orange', 'wanadoo', 'free', 'sfr', 'neuf', 'laposte', 'bbox', 'yopmail', 'wise-associates',
])

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

interface Token { start: number; end: number; word: string }

function tokens(text: string): Token[] {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map(m => ({ start: m.index, end: m.index + m[0].length, word: fold(m[0]) }))
}

const words = (text: string) => tokens(text).map(t => t.word)

/**
 * Noms à masquer, sous forme de suites de mots normalisés (casse, accents et ponctuation ignorés) :
 * le client tel qu'extrait, sans forme juridique, son sigle entre parenthèses, puis le nom et le domaine
 * de l'expéditeur (intermédiaire ou interlocuteur).
 */
export function namesToHide(companyName: string, sender?: { name?: string; address?: string }): string[][] {
  const variants: string[][] = []
  const full = words(companyName)
  variants.push(full, full.filter(w => !LEGAL_SUFFIXES.has(w)))
  for (const m of companyName.matchAll(/\(([^)]+)\)/g)) variants.push(words(m[1]))
  variants.push(words(companyName.replace(/\([^)]*\)/g, ' ')).filter(w => !LEGAL_SUFFIXES.has(w)))
  // Un nom d'expéditeur d'un seul mot (« Recrutement », « Contact ») est trop générique pour être masqué partout.
  const senderName = words(sender?.name ?? '')
  if (senderName.length >= 2) variants.push(senderName)
  const labels = sender?.address?.split('@')[1]?.toLowerCase().split('.') ?? []
  const domain = labels.length >= 2 ? labels[labels.length - 2] : ''
  if (domain && !NON_IDENTIFYING_DOMAINS.has(domain)) variants.push(words(domain))

  const unique = new Map(variants.filter(v => v.join('').length >= 2).map(v => [v.join(' '), v]))
  return [...unique.values()].sort((a, b) => b.length - a.length) // les noms les plus longs d'abord
}

function replaceNames(text: string, names: string[][], label: string): string {
  const toks = tokens(text)
  let out = ''
  let pos = 0
  for (let i = 0; i < toks.length; i++) {
    const name = names.find(n => n.every((w, k) => toks[i + k]?.word === w))
    if (!name) continue
    out += text.slice(pos, toks[i].start) + label
    pos = toks[i + name.length - 1].end
    i += name.length - 1
  }
  return out + text.slice(pos)
}

/** Retire e-mails, liens, téléphones et lignes de contact ; remplace les noms à masquer par `label`. */
export function scrubContacts(text: string, names: string[][], label = DEFAULT_CLIENT_LABEL): string {
  const out = text
    .replace(CONTACT_LINE, '')
    .replace(OBFUSCATED_EMAIL, '')
    .replace(EMAIL, '')
    .replace(URL, '')
    .replace(PHONE, '')
  return replaceNames(out, names, label).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Vrai si le texte contient un des noms à masquer (ex. libellé « entreprise affichée » saisi par l'admin). */
export function revealsName(text: string, names: string[][]): boolean {
  return replaceNames(text, names, '\u0000') !== text
}

export interface PublicOffer {
  title: string
  companyName: string
  description: string
  location: string
  skills: string[]
}

/**
 * Version publique d'une offre : client remplacé par un libellé générique, coordonnées et noms retirés,
 * durée / démarrage / expérience ajoutés en fin de description (comme l'import par tableur).
 */
export function toPublicOffer(offer: AoOfferFields, names: string[][], label = DEFAULT_CLIENT_LABEL): PublicOffer {
  const extras = [
    offer.duration && `Durée de la mission : ${offer.duration}`,
    offer.startDate && `Démarrage : ${offer.startDate}`,
    offer.experience && `Expérience requise : ${offer.experience}`,
  ].filter(Boolean) as string[]
  const scrub = (text: string) => scrubContacts(text, names, label)
  const description = [offer.description, ...extras].filter(Boolean).join('\n\n')
  return {
    title: scrub(offer.title),
    companyName: label,
    description: scrub(description) || scrub(offer.title),
    // Une compétence qui nomme le client (« Outil interne BNP ») est retirée plutôt que remplacée.
    skills: offer.skills.filter(s => !revealsName(s, names)).map(scrub).filter(Boolean),
    location: scrub(offer.location),
  }
}
