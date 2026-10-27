import { LEGAL_SUFFIXES } from './fingerprint'
import { REFERENCE_CODE, replaceNames, words } from './name-match'
import { identifyingLabel, type Sender } from './origin'
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
// Restes d'une référence retirée : « (DH038970) » vide, « BNPP - RFC00094023 - Analyste » aux séparateurs doublés.
const EMPTY_BRACKETS = /[ \t]*(?:\([ \t]*\)|\[[ \t]*\])/g
const DOUBLED_SEPARATOR = /[ \t]+([-–—|])(?:[ \t]+[-–—|])+[ \t]+/g
const TITLE_EDGES = /^[\s\-–—|:,]+|[\s\-–—|:,]+$/g

/**
 * Noms à masquer, sous forme de suites de mots normalisés (casse, accents et ponctuation ignorés) : chaque client
 * (celui de l'offre et ceux que cite l'appel d'offres) tel qu'extrait, sans forme juridique, son sigle entre
 * parenthèses, puis le nom et le domaine de chaque expéditeur (celui de l'e-mail et celui du message d'origine),
 * sauf ceux de l'organisation elle-même (`ownDomains`) et des messageries grand public.
 */
export function namesToHide(clients: string[], senders: Partial<Sender>[] = [], ownDomains: string[] = []): string[][] {
  const variants: string[][] = []
  for (const client of clients) {
    const full = words(client)
    variants.push(full, full.filter(w => !LEGAL_SUFFIXES.has(w)))
    for (const m of client.matchAll(/\(([^)]+)\)/g)) variants.push(words(m[1]))
    variants.push(words(client.replace(/\([^)]*\)/g, ' ')).filter(w => !LEGAL_SUFFIXES.has(w)))
  }
  for (const sender of senders) {
    // Un nom d'expéditeur d'un seul mot (« Recrutement », « Contact ») est trop générique pour être masqué partout.
    const senderName = words(sender.name ?? '')
    if (senderName.length >= 2) variants.push(senderName)
    // Outlook écrit « Dupont, Marie » ; le texte, lui, dit « Marie Dupont ».
    const [last, first] = (sender.name ?? '').split(',', 2)
    if (first && words(`${first} ${last}`).length >= 2) variants.push(words(`${first} ${last}`))
    const domain = identifyingLabel(sender.address ?? '', ownDomains)
    if (domain) variants.push(words(domain))
  }

  const unique = new Map(variants.filter(v => v.join('').length >= 2).map(v => [v.join(' '), v]))
  return [...unique.values()].sort((a, b) => b.length - a.length) // les noms les plus longs d'abord
}

/**
 * Retire e-mails, liens, téléphones, lignes de contact et références d'appel d'offres (name-match.ts) ; remplace les
 * noms à masquer par `label`.
 */
export function scrubContacts(text: string, names: string[][], label = DEFAULT_CLIENT_LABEL): string {
  const out = text
    .replace(CONTACT_LINE, '')
    .replace(OBFUSCATED_EMAIL, '')
    .replace(EMAIL, '')
    .replace(URL, '')
    .replace(PHONE, '')
    .replace(REFERENCE_CODE, '')
    .replace(EMPTY_BRACKETS, '')
    .replace(DOUBLED_SEPARATOR, ' $1 ')
    .replace(/(\S)[ \t]{2,}(?=\S)/g, '$1 ')
  return replaceNames(out, names, label).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Vrai si le texte contient un des noms à masquer (ex. libellé « entreprise affichée » saisi par l'admin). */
export function revealsName(text: string, names: string[][]): boolean {
  return replaceNames(text, names, '\u0000') !== text
}

/**
 * « Entreprise affichée » publiable : ni nom à masquer, ni coordonnée ou référence (texte que le nettoyage laisse
 * intact), sinon le libellé générique. Proposée par l'IA à partir d'un e-mail non fiable, elle est aussi insérée à la
 * place de chaque nom masqué dans le texte : elle doit être aussi propre que lui.
 */
export function publicLabel(label: string, names: string[][]): string {
  const value = label.trim()
  return value.length >= 2 && scrubContacts(value, []) === value && !revealsName(value, names) ? value : DEFAULT_CLIENT_LABEL
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
 * `extra` : noms que l'IA dit avoir retirés (publication-copy.ts), masqués APRÈS les noms connus : un terme qui en
 * chevauche un (« Groupe BNP » dans « Groupe BNP Paribas ») ne peut pas empêcher son masquage.
 */
export function toPublicOffer(offer: AoOfferFields, names: string[][], label = DEFAULT_CLIENT_LABEL, extra: string[][] = []): PublicOffer {
  const extras = [
    offer.duration && `Durée de la mission : ${offer.duration}`,
    offer.startDate && `Démarrage : ${offer.startDate}`,
    offer.experience && `Expérience requise : ${offer.experience}`,
  ].filter(Boolean) as string[]
  const scrub = (text: string) => {
    const known = scrubContacts(text, names, label)
    return extra.length ? scrubContacts(known, extra, label) : known
  }
  const description = [offer.description, ...extras].filter(Boolean).join('\n\n')
  return {
    // « RFC00094758 - Consultant SEO » : le séparateur qui suivait la référence retirée ne reste pas en tête.
    title: scrub(offer.title).replace(TITLE_EDGES, ''),
    companyName: label,
    description: scrub(description) || scrub(offer.title),
    // Une compétence qui nomme le client (« Outil interne BNP ») est retirée plutôt que remplacée.
    skills: offer.skills.filter(s => !revealsName(s, names) && !revealsName(s, extra)).map(scrub).filter(Boolean),
    location: scrub(offer.location),
  }
}
