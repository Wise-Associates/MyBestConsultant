import { ID, Query, type Models } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import type { AoOfferRow } from './filters'
import type { AoEmail, AoEmailStatus, AoOffer, AoOfferFields, AoOfferStatus } from './types'

// Accès aux collections AO_EMAILS et AO_OFFERS (clé API serveur : aucune permission côté client).
// À n'appeler que depuis le traitement planifié ou des actions admin vérifiées.

/** Nombre d'essais avant d'abandonner un e-mail en erreur. */
export const MAX_ATTEMPTS = 3
/** Un traitement interrompu (délai dépassé) reste « processing » : on le reprend après ce délai. */
const STALE_PROCESSING_MS = 15 * 60_000

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' ? v : 0)

export function docToAoEmail(d: Models.Document): AoEmail {
  const doc = d as Models.Document & Record<string, unknown>
  return {
    $id: d.$id,
    messageId: str(doc.messageId),
    uid: num(doc.uid),
    fromAddress: str(doc.fromAddress),
    fromName: str(doc.fromName),
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
 * le réessayer (erreur, ou traitement interrompu), ou l'abandonner (3 essais sans succès).
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

/** Message-ID à ne pas (re)traiter maintenant (voir nextStepFor). */
export async function settledMessageIds(messageIds: string[], now: Date): Promise<Set<string>> {
  const { databases } = createAdminClient()
  const settled = new Set<string>()
  for (const batch of batchByLength(messageIds)) {
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.AO_EMAILS, [Query.equal('messageId', batch), Query.limit(batch.length)])
    for (const email of res.documents.map(docToAoEmail)) {
      if (nextStepFor(email, now) === 'skip') settled.add(email.messageId)
    }
  }
  return settled
}

export async function findAoEmailByMessageId(messageId: string): Promise<AoEmail | null> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.AO_EMAILS, [Query.equal('messageId', messageId), Query.limit(1)])
  return res.documents[0] ? docToAoEmail(res.documents[0]) : null
}

/** Crée l'e-mail (index unique sur messageId : échoue si un autre traitement l'a déjà pris). */
export async function createAoEmail(data: Pick<AoEmail, 'messageId' | 'uid' | 'receivedAt'>): Promise<AoEmail> {
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

export async function listRecentAoEmails(limit: number): Promise<AoEmail[]> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.AO_EMAILS, [Query.orderDesc('$createdAt'), Query.limit(limit)])
  return res.documents.map(docToAoEmail)
}

/**
 * E-mails à réessayer (erreur, ou traitement interrompu) : relus par UID lors d'un passage incrémental.
 * Les e-mails abandonnés (3 essais) sont exclus ; un traitement interrompu au 3e essai est clos par le
 * rattrapage quotidien.
 */
export async function listRetryableAoEmails(now: Date, limit = 50): Promise<AoEmail[]> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.AO_EMAILS, [
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
  const doc = await databases.createDocument(DB_ID, COLLECTIONS.AO_OFFERS, ID.unique(), {
    ...fields,
    salary: fields.salary ?? null,
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

// ── Conservation (RGPD) ──────────────────────────────────────────

/** Supprime les e-mails et offres AO créés avant `before` (les offres publiques déjà créées restent). */
export async function purgeAoRecords(before: Date, maxDeletes = 100): Promise<number> {
  const { databases } = createAdminClient()
  let deleted = 0
  for (const collection of [COLLECTIONS.AO_OFFERS, COLLECTIONS.AO_EMAILS]) {
    const res = await databases.listDocuments(DB_ID, collection, [Query.lessThan('$createdAt', before.toISOString()), Query.limit(maxDeletes - deleted)])
    for (const doc of res.documents) {
      await databases.deleteDocument(DB_ID, collection, doc.$id)
      deleted++
    }
    if (deleted >= maxDeletes) break
  }
  return deleted
}

// ── Lignes de la page admin ──────────────────────────────────────

/** Offres récentes avec l'expéditeur, l'objet et la date de l'e-mail d'origine. */
export async function listAoOfferRows(max = 2000): Promise<AoOfferRow[]> {
  const offers = await listAoOffers(max)
  const emails = await listAoEmailsByIds(offers.map(o => o.emailId))
  return offers.map(offer => {
    const email = emails.get(offer.emailId)
    return {
      ...offer,
      senderAddress: email?.fromAddress ?? '',
      senderName: email?.fromName ?? '',
      subject: email?.subject ?? '',
      receivedAt: email?.receivedAt ?? offer.createdAt,
    }
  })
}
