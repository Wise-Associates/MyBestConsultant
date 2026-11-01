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
// Libellé d'une référence d'appel d'offres : « Référence BOAMP », « Réf. AO », « N° de l'avis », « Numéro de l'avis »,
// « Avis BOAMP n° », « N° TED ». Espaces insécables admis (« n° 26-105130 » s'écrit souvent ainsi). Les espaces de ces
// expressions ne se suivent jamais sans un caractère obligatoire entre eux : une longue suite d'espaces ou d'étoiles ne
// se lit que d'une façon (pas de retour arrière démesuré sur un texte saisi ou rédigé par l'IA).
const SPACE = String.raw` \t  `
const REFERENCE_LABEL = String.raw`(?:r[ée]f(?:[ée]rence)?\.?(?:[${SPACE}]+(?:boamp|ted|joue|ao|de[${SPACE}]+l['’]avis|du[${SPACE}]+march[ée]|de[${SPACE}]+la[${SPACE}]+consultation))?`
  + String.raw`|(?:n[°o]|num[ée]ro)[${SPACE}]*(?:de[${SPACE}]+l['’]|d['’])avis|(?:avis|annonce)(?:[${SPACE}]+(?:boamp|ted|joue))?[${SPACE}]+n[°o]`
  + String.raw`|n[°o][${SPACE}]*(?:boamp|ted|joue))(?:[${SPACE}]*n[°o])?`
// Début de ligne (titre, puce, gras) : seule place, avec l'intérieur d'une parenthèse, où ces mots sont un libellé.
// Dans une phrase, « indiquez la référence DH038970 dans l'objet » garde « la référence ».
const LINE_START = String.raw`^[ \t]*(?:#{1,6}[ \t]*)?(?:[-*•][ \t]+)?(?:\*+[ \t]*)?`
// Référence retirée, marquée le temps de retirer son libellé avec elle : REFERENCE_CODE distingue les majuscules
// (« RFC00094023 », pas « java1234 »), son libellé non (« Référence », « RÉF. »).
const REFERENCE_MARK = '\u0000'
// « Réf. TED : 654321-2026 », « **Référence :** 26-105130 », « (référence : 26-105130) », « (Avis n° 26-105130) ».
const LABELLED_REFERENCE = new RegExp(String.raw`(?:${LINE_START}|(?<=[([])[ \t]*)${REFERENCE_LABEL}[${SPACE}*]*(?::[${SPACE}*]*)?\u0000`, 'gim')
// Titre ou libellé seul sur sa ligne dont la référence était sur la ligne suivante (« ### Référence BOAMP », puis
// « 26-105130 ») : retirés ensemble. Un titre « ### Référence » sans référence dessous reste, comme « Références ».
const REFERENCE_HEADING = new RegExp(
  String.raw`${LINE_START}${REFERENCE_LABEL}(?:[${SPACE}*]*:)?[${SPACE}*]*\n(?:[ \t]*\n)?[ \t*]*\u0000[ \t*]*$`,
  'gim',
)
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
 * Retire e-mails, liens, téléphones, lignes de contact et références d'appel d'offres (name-match.ts) avec leur
 * libellé ; remplace les noms à masquer par `label`.
 */
export function scrubContacts(text: string, names: string[][], label = DEFAULT_CLIENT_LABEL): string {
  const out = text
    .replace(CONTACT_LINE, '')
    .replace(OBFUSCATED_EMAIL, '')
    .replace(EMAIL, '')
    .replace(URL, '')
    .replace(PHONE, '')
    .replace(REFERENCE_CODE, REFERENCE_MARK)
    .replace(REFERENCE_HEADING, '')
    .replace(LABELLED_REFERENCE, '')
    .replaceAll(REFERENCE_MARK, '')
    .replace(EMPTY_BRACKETS, '')
    .replace(DOUBLED_SEPARATOR, ' $1 ')
    .replace(/(\S)[ \t]{2,}(?=\S)/g, '$1 ')
  const masked = replaceNames(out, names, label, clientWithArticle)
  // Sigle et nom complet masqués tous deux : « ENSMIS (École nationale…) » donnerait « Client confidentiel (Client confidentiel) ».
  const labels = `(?:${escapeRegExp(label)}|${escapeRegExp(GENERIC_CLIENT)})`
  return masked
    .replace(new RegExp(`(${labels})[ \\t]*\\([ \\t]*(?:(?:le|du|au|un|ce)[ \\t]+)?${labels}[ \\t]*\\)`, 'gi'), '$1')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Libellé générique au fil du texte, après un article (« le client confidentiel »). */
const GENERIC_CLIENT = DEFAULT_CLIENT_LABEL.toLowerCase()
const MASCULINE_ARTICLE: Record<string, string> = {
  'l': 'le', 'la': 'le', 'd': 'du', 'de l': 'du', 'de la': 'du', 'à l': 'au', 'à la': 'au', 'une': 'un', 'cette': 'ce',
}

/**
 * Nom masqué précédé d'un article élidé ou féminin : « L'ENSMIS lance » → « Le client confidentiel lance », « offre
 * d'ENSMIS » ou « de la SNCF » → « du client confidentiel », « à l'ENSMIS » → « au client confidentiel », « lorsqu'ENSMIS »
 * → « lorsque le client confidentiel ». Toujours le libellé générique, quel que soit le libellé affiché : « client » est
 * masculin, un secteur proposé par l'IA ne l'est pas toujours (« le Banque de détail »).
 */
function clientWithArticle(article: string): string {
  const lower = article.toLowerCase().replace(/[ \t]+/g, ' ')
  const phrase = `${MASCULINE_ARTICLE[lower] ?? `${lower}e le`} ${GENERIC_CLIENT}`
  return article[0] === article[0].toLowerCase() ? phrase : phrase[0].toUpperCase() + phrase.slice(1)
}

/** Noms tels qu'écrits la première fois, sans doublon (casse, accents et ponctuation ignorés) : liste montrée à la relecture. */
export function distinctNames(names: string[]): string[] {
  const unique = new Map<string, string>()
  for (const name of names.map(n => n.trim())) {
    const key = words(name).join(' ')
    if (key && !unique.has(key)) unique.set(key, name)
  }
  return [...unique.values()]
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
  const scrub = (text: string) => {
    const known = scrubContacts(text, names, label)
    return extra.length ? scrubContacts(known, extra, label) : known
  }
  const description = descriptionWithTerms(offer)
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

/** Description suivie de la durée, du démarrage et de l'expérience, que l'offre publique n'a pas en champs à part. */
function descriptionWithTerms(offer: AoOfferFields): string {
  const terms = [
    offer.duration && `Durée de la mission : ${offer.duration}`,
    offer.startDate && `Démarrage : ${offer.startDate}`,
    offer.experience && `Expérience requise : ${offer.experience}`,
  ].filter(Boolean) as string[]
  return [offer.description, ...terms].filter(Boolean).join('\n\n')
}

/**
 * Coordonnées personnelles seules : e-mails (même déguisés), téléphones et lignes de contact (« Contact : Marie
 * Dupont »). Noms de sociétés, références et liens restent.
 */
export function removePersonalContacts(text: string): string {
  return text
    .replace(CONTACT_LINE, '')
    .replace(OBFUSCATED_EMAIL, '')
    .replace(EMAIL, '')
    .replace(PHONE, '')
    .replace(EMPTY_BRACKETS, '')
    .replace(/(\S)[ \t]{2,}(?=\S)/g, '$1 ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Version publique NON anonymisée (« Publier sans anonymiser », choix de la personne qui publie, décision du
 * 2026-10-30) : l'offre telle que reçue, client compris, sans les coordonnées personnelles de l'interlocuteur, qu'une
 * page publique n'a pas à exposer.
 */
export function rawPublicOffer(offer: AoOfferFields): PublicOffer {
  return {
    title: removePersonalContacts(offer.title).replace(TITLE_EDGES, ''),
    companyName: removePersonalContacts(offer.companyName),
    description: removePersonalContacts(descriptionWithTerms(offer)) || removePersonalContacts(offer.title),
    skills: offer.skills.map(removePersonalContacts).filter(Boolean),
    location: removePersonalContacts(offer.location),
  }
}
