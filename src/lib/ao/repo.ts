import { ID, Query, type Models } from 'node-appwrite'
import { z } from 'zod'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { MAX_ATTEMPTS } from './attempts'
import type { AoOfferRow } from './filters'
import { parseSender } from './origin'
import type { AoEmail, AoEmailStatus, AoOffer, AoOfferDetails, AoOfferFields, AoOfferStatus } from './types'
import { engagementOf } from './parse'

// Accès aux collections AO_EMAILS et AO_OFFERS (clé API serveur : aucune permission côté client).
// À n'appeler que depuis le traitement planifié ou des actions admin vérifiées.

/** Un traitement interrompu (délai dépassé) reste « processing » : on le reprend après ce délai. */
const STALE_PROCESSING_MS = 15 * 60_000

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' ? v : 0)

export function docToAoEmail(d: Models.Document): AoEmail {
  const doc = d as Models.Document & Record<string, unknown>
  return {
    $id: d.$id,
    sourceId: str(doc.sourceId),
    messageId: str(doc.messageId),
    uid: num(doc.uid),
    fromAddress: str(doc.fromAddress),
    fromName: str(doc.fromName),
    origin: str(doc.origin),
    deadline: str(doc.deadline),
    citedClients: Array.isArray(doc.citedClients) ? (doc.citedClients as string[]) : [],
    subject: str(doc.subject),
    receivedAt: str(doc.receivedAt) || d.$createdAt,
    attachments: Array.isArray(doc.attachments) ? (doc.attachments as string[]) : [],
    status: (str(doc.status) || 'processing') as AoEmailStatus,
    error: str(doc.error),
    offerCount: num(doc.offerCount),
    duplicateCount: num(doc.duplicateCount),
    attempts: num(doc.attempts),
    updatedAt: d.$updatedAt,
  }
}

export function docToAoOffer(d: Models.Document): AoOffer {
  const doc = d as Models.Document & Record<string, unknown>
  return {
    $id: d.$id,
    createdAt: d.$createdAt,
    title: str(doc.title),
    companyName: str(doc.companyName),
    location: str(doc.location),
    contractType: (str(doc.contractType) || 'mission') as AoOffer['contractType'],
    remote: (str(doc.remote) || 'hybrid') as AoOffer['remote'],
    salary: typeof doc.salary === 'number' ? doc.salary : null,
    skills: Array.isArray(doc.skills) ? (doc.skills as string[]) : [],
    description: str(doc.description),
    duration: str(doc.duration),
    startDate: str(doc.startDate),
    experience: str(doc.experience),
    fingerprint: str(doc.fingerprint),
    emailId: str(doc.emailId),
    status: (str(doc.status) || 'to_review') as AoOfferStatus,
    jobId: str(doc.jobId) || null,
    sourceCount: num(doc.sourceCount) || 1,
  }
}

// ── E-mails ──────────────────────────────────────────────────────

/**
 * Que faire d'un e-mail déjà enregistré : le laisser (terminé, ou en cours dans un autre passage),
 * le réessayer (erreur, ou traitement interrompu), ou l'abandonner (MAX_ATTEMPTS essais sans succès).
 */
export function nextStepFor(email: AoEmail, now: Date): 'skip' | 'retry' | 'abandon' {
  const interrupted = email.status === 'processing' && now.getTime() - new Date(email.updatedAt).getTime() > STALE_PROCESSING_MS
  if (email.status !== 'failed' && !interrupted) return 'skip'
  if (email.attempts < MAX_ATTEMPTS) return 'retry'
  return interrupted ? 'abandon' : 'skip'
}

/**
 * Découpe une liste de valeurs en lots qui tiennent dans une requête Appwrite
 * (chaque requête est limitée à 4096 caractères, les Message-ID font souvent 50 à 100 caractères).
 */
export function batchByLength(values: string[], maxChars = 3000, maxItems = 25): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  let length = 0
  for (const value of values) {
    const size = JSON.stringify(value).length + 1
    if (current.length && (length + size > maxChars || current.length >= maxItems)) {
      batches.push(current)
      current = []
      length = 0
    }
    current.push(value)
    length += size
  }
  if (current.length) batches.push(current)
  return batches
}

/** Message-ID de la boîte à ne pas (re)traiter maintenant (voir nextStepFor). */
export async function settledMessageIds(sourceId: string, messageIds: string[], now: Date): Promise<Set<string>> {
  const { databases } = createAdminClient()
  const settled = new Set<string>()
  for (const batch of batchByLength(messageIds)) {
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.AO_EMAILS, [Query.equal('sourceId', sourceId), Query.equal('messageId', batch), Query.limit(batch.length)])
    for (const email of res.documents.map(docToAoEmail)) {
      if (nextStepFor(email, now) === 'skip') settled.add(email.messageId)
    }
  }
  return settled
}

/** true si la boîte a au moins un e-mail suivi (sinon : boîte nouvelle, ou historique effacé → lecture complète). */
export async function hasAoEmails(sourceId: string): Promise<boolean> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.AO_EMAILS, [Query.equal('sourceId', sourceId), Query.limit(1)])
  return res.documents.length > 0
}

/** E-mail AO par identifiant ; null s'il n'existe pas (toute autre erreur est remontée). */
export async function getAoEmail(id: string): Promise<AoEmail | null> {
  const { databases } = createAdminClient()
  try {
    return docToAoEmail(await databases.getDocument(DB_ID, COLLECTIONS.AO_EMAILS, id))
  } catch (err) {
    if ((err as { code?: number }).code === 404) return null
    throw err
  }
}

export async function findAoEmailByMessageId(sourceId: string, messageId: string): Promise<AoEmail | null> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.AO_EMAILS, [Query.equal('sourceId', sourceId), Query.equal('messageId', messageId), Query.limit(1)])
  return res.documents[0] ? docToAoEmail(res.documents[0]) : null
}

/** Crée l'e-mail (index unique sur sourceId + messageId : échoue si un autre traitement l'a déjà pris). */
export async function createAoEmail(data: Pick<AoEmail, 'sourceId' | 'messageId' | 'uid' | 'receivedAt'>): Promise<AoEmail> {
  const { databases } = createAdminClient()
  const doc = await databases.createDocument(DB_ID, COLLECTIONS.AO_EMAILS, ID.unique(), {
    ...data,
    status: 'processing',
    attempts: 1,
  })
  return docToAoEmail(doc)
}

export async function updateAoEmail(id: string, patch: Partial<Omit<AoEmail, '$id'>>): Promise<void> {
  const { databases } = createAdminClient()
  await databases.updateDocument(DB_ID, COLLECTIONS.AO_EMAILS, id, patch)
}

export async function listAoEmailsByIds(ids: string[]): Promise<Map<string, AoEmail>> {
  const { databases } = createAdminClient()
  const map = new Map<string, AoEmail>()
  for (const batch of batchByLength([...new Set(ids.filter(Boolean))])) {
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.AO_EMAILS, [Query.equal('$id', batch), Query.limit(batch.length)])
    for (const doc of res.documents) map.set(doc.$id, docToAoEmail(doc))
  }
  return map
}

/** E-mails récents des boîtes `sourceIds` (aucun si la liste est vide). */
export async function listRecentAoEmails(sourceIds: string[], limit: number): Promise<AoEmail[]> {
  if (!sourceIds.length) return []
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.AO_EMAILS, [Query.equal('sourceId', sourceIds), Query.orderDesc('$createdAt'), Query.limit(limit)])
  return res.documents.map(docToAoEmail)
}

/**
 * E-mails à réessayer (erreur, ou traitement interrompu) : relus par UID lors d'un passage incrémental.
 * Les e-mails abandonnés (MAX_ATTEMPTS essais) sont exclus ; un traitement interrompu au dernier essai est clos par le
 * rattrapage quotidien.
 */
export async function listRetryableAoEmails(sourceId: string, now: Date, limit = 50): Promise<AoEmail[]> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.AO_EMAILS, [
    Query.equal('sourceId', sourceId),
    Query.equal('status', ['failed', 'processing']),
    Query.lessThan('attempts', MAX_ATTEMPTS),
    Query.orderAsc('$updatedAt'),
    Query.limit(limit),
  ])
  return res.documents.map(docToAoEmail).filter(email => nextStepFor(email, now) === 'retry')
}

// ── Offres ───────────────────────────────────────────────────────

/** Offre déjà reçue avec la même empreinte depuis `since` (la plus ancienne, qui sert de référence). */
export async function findAoDuplicate(fingerprint: string, since: Date): Promise<AoOffer | null> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.AO_OFFERS, [
    Query.equal('fingerprint', fingerprint),
    Query.greaterThanEqual('$createdAt', since.toISOString()),
    Query.orderAsc('$createdAt'),
    Query.limit(1),
  ])
  return res.documents[0] ? docToAoOffer(res.documents[0]) : null
}

export async function createAoOffer(fields: AoOfferFields, meta: { fingerprint: string; emailId: string }): Promise<AoOffer> {
  const { databases } = createAdminClient()
  // Attributs listés un à un : une offre lue dans un e-mail porte aussi sa date limite (ExtractedOffer), qu'Appwrite
  // refuserait ici (attribut inconnu) ; elle est enregistrée sur l'e-mail.
  const { title, companyName, location, contractType, remote, salary, skills, description, duration, startDate, experience } = fields
  const doc = await databases.createDocument(DB_ID, COLLECTIONS.AO_OFFERS, ID.unique(), {
    title, companyName, location, contractType, remote, skills, description, duration, startDate, experience,
    salary: salary ?? null,
    fingerprint: meta.fingerprint,
    emailId: meta.emailId,
    status: 'to_review',
    sourceCount: 1,
  })
  return docToAoOffer(doc)
}

/** Une offre déjà connue revient dans un nouvel e-mail (lecture puis écriture : un passage à la fois). */
export async function incrementAoSources(offer: AoOffer): Promise<void> {
  const { databases } = createAdminClient()
  await databases.updateDocument(DB_ID, COLLECTIONS.AO_OFFERS, offer.$id, { sourceCount: offer.sourceCount + 1 })
}

export async function getAoOffer(id: string): Promise<AoOffer | null> {
  const { databases } = createAdminClient()
  try {
    return docToAoOffer(await databases.getDocument(DB_ID, COLLECTIONS.AO_OFFERS, id))
  } catch {
    return null
  }
}

export async function updateAoOffer(id: string, patch: Partial<Omit<AoOffer, '$id' | 'createdAt'>>): Promise<AoOffer> {
  const { databases } = createAdminClient()
  return docToAoOffer(await databases.updateDocument(DB_ID, COLLECTIONS.AO_OFFERS, id, patch))
}

/** Offres les plus récentes (pagination par curseur), pour la page admin et l'export. */
export async function listAoOffers(max = 2000): Promise<AoOffer[]> {
  const { databases } = createAdminClient()
  const offers: AoOffer[] = []
  let cursor: string | undefined
  while (offers.length < max) {
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.AO_OFFERS, [
      Query.orderDesc('$createdAt'),
      Query.limit(Math.min(500, max - offers.length)),
      ...(cursor ? [Query.cursorAfter(cursor)] : []),
    ])
    offers.push(...res.documents.map(docToAoOffer))
    if (res.documents.length === 0 || offers.length >= res.total) break
    cursor = res.documents[res.documents.length - 1].$id
  }
  return offers
}

// ── Détails des offres (assistance / forfait, technologies) ─────

/** Enregistre les détails d'une offre (document de même identifiant ; mis à jour s'il existe déjà). */
export async function saveAoOfferDetails(offerId: string, details: AoOfferDetails): Promise<void> {
  const { databases } = createAdminClient()
  const data = { engagement: details.engagement, technologies: details.technologies }
  try {
    await databases.createDocument(DB_ID, COLLECTIONS.AO_OFFER_DETAILS, offerId, data)
  } catch (err) {
    if ((err as { code?: number }).code !== 409) throw err
    await databases.updateDocument(DB_ID, COLLECTIONS.AO_OFFER_DETAILS, offerId, data)
  }
}

const SourcingRecordSchema = z.object({
  at: z.string(),
  scanned: z.number(),
  candidates: z.array(z.object({ candidateId: z.string(), score: z.number(), reason: z.string() })),
})
/** Dernier sourcing d'une offre AO non publiée : candidats retenus (identifiant, score, raison), sans nom ni e-mail. */
export type AoSourcingRecord = z.infer<typeof SourcingRecordSchema>

/** Sourcing enregistré d'une offre ; null s'il n'a jamais été fait (ou s'il est illisible : il sera recalculé). */
export async function getAoOfferSourcing(offerId: string): Promise<AoSourcingRecord | null> {
  const { databases } = createAdminClient()
  let raw: unknown
  try {
    raw = (await databases.getDocument(DB_ID, COLLECTIONS.AO_OFFER_DETAILS, offerId)).sourcing
  } catch (err) {
    if ((err as { code?: number }).code === 404) return null
    throw err
  }
  if (typeof raw !== 'string' || !raw) return null
  try {
    const parsed = SourcingRecordSchema.safeParse(JSON.parse(raw))
    if (parsed.success) return parsed.data
  } catch {
    // JSON illisible : traité comme absent (journalisé ci-dessous), le prochain sourcing le remplace.
  }
  console.warn('AO: sourcing enregistré illisible, ignoré', offerId)
  return null
}

/** Enregistre le dernier sourcing d'une offre (document de détails créé s'il n'existe pas encore). */
export async function saveAoOfferSourcing(offerId: string, record: AoSourcingRecord): Promise<void> {
  const { databases } = createAdminClient()
  const sourcing = JSON.stringify(record).slice(0, 5000)
  try {
    await databases.updateDocument(DB_ID, COLLECTIONS.AO_OFFER_DETAILS, offerId, { sourcing })
  } catch (err) {
    if ((err as { code?: number }).code !== 404) throw err
    await databases.createDocument(DB_ID, COLLECTIONS.AO_OFFER_DETAILS, offerId, { engagement: '', technologies: [], sourcing })
  }
}

/** Détails des offres `offerIds` (absents : offre reçue avant ces détails, ou sans assistance / forfait ni technologie). */
export async function listAoOfferDetails(offerIds: string[]): Promise<Map<string, AoOfferDetails>> {
  const { databases } = createAdminClient()
  const map = new Map<string, AoOfferDetails>()
  for (const batch of batchByLength([...new Set(offerIds.filter(Boolean))])) {
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.AO_OFFER_DETAILS, [Query.equal('$id', batch), Query.limit(batch.length)])
    for (const doc of res.documents as (Models.Document & Record<string, unknown>)[]) {
      map.set(doc.$id, { engagement: engagementOf(str(doc.engagement)), technologies: Array.isArray(doc.technologies) ? (doc.technologies as string[]) : [] })
    }
  }
  return map
}

// ── Conservation (RGPD) ──────────────────────────────────────────

/** Supprime les e-mails et offres AO créés avant `before` (les offres publiques déjà créées restent). */
export async function purgeAoRecords(before: Date, maxDeletes = 100): Promise<number> {
  const { databases } = createAdminClient()
  let deleted = 0
  // Commentaires : fonction facultative, purgés seulement si leur collection est configurée (sans elle, rien à purger).
  const collections = [COLLECTIONS.AO_COMMENTS, COLLECTIONS.AO_OFFER_DETAILS, COLLECTIONS.AO_OFFERS, COLLECTIONS.AO_EMAILS].filter(Boolean)
  for (const collection of collections) {
    const res = await databases.listDocuments(DB_ID, collection, [Query.lessThan('$createdAt', before.toISOString()), Query.limit(maxDeletes - deleted)])
    for (const doc of res.documents) {
      // 404 : déjà supprimé par le passage d'une autre organisation, lancé en même temps.
      await databases.deleteDocument(DB_ID, collection, doc.$id).catch(err => { if ((err as { code?: number }).code !== 404) throw err })
      deleted++
    }
    if (deleted >= maxDeletes) break
  }
  return deleted
}

// ── Lignes de la page admin ──────────────────────────────────────

/**
 * Offres récentes des boîtes `sourceIds`, avec l'expéditeur, l'objet et la date de l'e-mail d'origine. Une offre n'a
 * pas d'attribut d'organisation (ao_offers est à 16/16) : elle appartient à la boîte de son e-mail.
 */
export async function listAoOfferRows(sourceIds: string[], max = 2000): Promise<AoOfferRow[]> {
  const offers = await listAoOffers(max)
  const [emails, details] = await Promise.all([listAoEmailsByIds(offers.map(o => o.emailId)), listAoOfferDetails(offers.map(o => o.$id))])
  const scope = new Set(sourceIds)
  return offers.filter(offer => scope.has(emails.get(offer.emailId)?.sourceId ?? '')).map(offer => {
    const email = emails.get(offer.emailId)
    // E-mail transféré : l'expéditeur affiché (et filtré) est celui du message d'origine ; le collaborateur qui l'a
    // transféré est indiqué à part. E-mails lus avant l'enregistrement de l'origine : l'expéditeur de l'e-mail.
    const origin = parseSender(email?.origin ?? '')
    const sender = origin ?? { name: email?.fromName ?? '', address: email?.fromAddress ?? '' }
    return {
      ...offer,
      engagement: details.get(offer.$id)?.engagement ?? '',
      technologies: details.get(offer.$id)?.technologies ?? [],
      senderAddress: sender.address,
      senderName: sender.name,
      forwardedBy: email && origin && origin.address !== email.fromAddress.trim().toLowerCase() ? email.fromName || email.fromAddress : '',
      deadline: email?.deadline ?? '',
      attachments: email?.attachments ?? [],
      subject: email?.subject ?? '',
      receivedAt: email?.receivedAt ?? offer.createdAt,
    }
  })
}
