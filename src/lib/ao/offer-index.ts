import { Query } from 'node-appwrite'
import type { AoFilters } from './filters'
import { parseSender, type Sender } from './origin'
import type { AoEmail, AoOffer } from './types'

// Index de la liste des offres AO (collection ao_offer_index, ADR 0019) : un document par offre, de même identifiant,
// qui porte l'organisation et tout ce que filtrent la page et l'export. ao_offers n'a ni organisation ni place pour en
// ajouter (16/16 attributs) : sans cet index, chaque page relisait toutes les offres de toutes les organisations. Donnée
// dérivée, reconstruite à tout moment par `npm run ao:index` ; écrite à chaque création (sync.ts), changement de
// statut, doublon fusionné et suppression d'une offre (repo.ts). Règles pures, testées dans offer-index.test.ts.
// Taille des pages : filters.ts (sans dépendance, lu aussi par le navigateur).

/** Ce que l'index tire de l'e-mail d'origine de l'offre et de sa boîte. */
export interface AoIndexContext {
  tenantId: string
  receivedAt: string
  subject: string
  sender: Sender
}

export interface AoOfferIndexDoc {
  tenantId: string
  status: string
  contractType: string
  remote: string
  salary: number | null
  receivedAt: string
  sourceCount: number
  city: string
  skills: string
  sender: string
  search: string
}

/**
 * Expéditeur affiché (et filtré) d'une offre : celui du message d'origine pour un e-mail transféré, sinon celui de
 * l'e-mail. E-mails lus avant l'enregistrement de l'origine : l'expéditeur de l'e-mail.
 */
export function senderOf(email: Pick<AoEmail, 'origin' | 'fromName' | 'fromAddress'> | undefined): Sender {
  return parseSender(email?.origin ?? '') ?? { name: email?.fromName ?? '', address: email?.fromAddress ?? '' }
}

/** Document d'index d'une offre. Les tailles sont celles des attributs (appwrite.config.json). */
export function indexDocumentOf(offer: AoOffer, ctx: AoIndexContext): AoOfferIndexDoc {
  return {
    tenantId: ctx.tenantId,
    status: offer.status,
    contractType: offer.contractType,
    remote: offer.remote,
    salary: offer.salary,
    receivedAt: ctx.receivedAt || offer.createdAt,
    sourceCount: offer.sourceCount,
    city: offer.location.slice(0, 200),
    skills: offer.skills.join(' | ').slice(0, 1000),
    sender: `${ctx.sender.name} ${ctx.sender.address}`.trim().slice(0, 600),
    // Même champ de recherche qu'avant (intitulé, client, ville, objet, compétences, description). L'attribut fait
    // 100 000 : 25 000 caractères tiennent même tous sur 4 octets (texte plein d'emojis).
    search: [offer.title, offer.companyName, offer.location, ctx.subject, offer.skills.join(' '), offer.description].join('\n').slice(0, 25_000),
  }
}

/** Lendemain d'un jour AAAA-MM-JJ, à minuit UTC : borne exclue du filtre « au ». */
function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString()
}

/**
 * Requêtes Appwrite des filtres de la page, sur l'index : l'organisation d'abord (jamais celle d'une autre), puis chaque
 * filtre renseigné. `contains` sur un texte cherche une sous-chaîne sans tenir compte de la casse ni des accents
 * (interclassement de la base, vérifié sur Appwrite 1.7.4), comme le filtrage fait auparavant dans le navigateur.
 * Dates : jours UTC, comme la date de réception enregistrée.
 */
export function indexFilterQueries(tenantId: string, f: AoFilters): string[] {
  const queries = [Query.equal('tenantId', tenantId)]
  if (f.status !== 'all') queries.push(Query.equal('status', f.status))
  if (f.contractType !== 'all') queries.push(Query.equal('contractType', f.contractType))
  if (f.remote !== 'all') queries.push(Query.equal('remote', f.remote))
  const text: [keyof AoOfferIndexDoc, string][] = [['search', f.q], ['city', f.city], ['skills', f.skill], ['sender', f.sender]]
  for (const [attribute, value] of text) {
    if (value.trim()) queries.push(Query.contains(attribute, value.trim()))
  }
  if (f.salaryMin !== null) queries.push(Query.greaterThanEqual('salary', f.salaryMin))
  if (f.salaryMax !== null) queries.push(Query.lessThanEqual('salary', f.salaryMax))
  if (f.from) queries.push(Query.greaterThanEqual('receivedAt', `${f.from}T00:00:00.000Z`))
  if (f.to) queries.push(Query.lessThan('receivedAt', nextDay(f.to)))
  return queries
}

/** Ordre de la liste : la plus récemment reçue d'abord ; identifiant pour départager (pages stables). */
export const INDEX_ORDER = [Query.orderDesc('receivedAt'), Query.orderDesc('$id')]
