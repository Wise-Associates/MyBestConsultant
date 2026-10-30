import { ID, Query, type Models } from 'node-appwrite'
import { z } from 'zod'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { MAX_ATTEMPTS } from './attempts'
import type { AoOfferCounts } from './dashboard-types'
import type { AoFilters, AoOfferRow } from './filters'
import { AO_MAX_LISTED } from './filters'
import { INDEX_ORDER, indexDocumentOf, indexFilterQueries, senderOf, type AoIndexContext, type AoOfferIndexDoc } from './offer-index'
import { parseSender } from './origin'
import type { AoChannel, AoContact, AoEmail, AoEmailStatus, AoOffer, AoOfferDetails, AoOfferFields, AoOfferStatus } from './types'
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
  // Lots lus en parallèle : chaque appel à Appwrite coûte un aller-retour réseau.
  const pages = await Promise.all(batchByLength([...new Set(ids.filter(Boolean))]).map(batch =>
    databases.listDocuments(DB_ID, COLLECTIONS.AO_EMAILS, [Query.equal('$id', batch), Query.limit(batch.length)])))
  for (const doc of pages.flatMap(res => res.documents)) map.set(doc.$id, docToAoEmail(doc))
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
  await mirrorAoOfferIndex(offer.$id, { sourceCount: offer.sourceCount + 1 })
}

/** Offre AO par identifiant ; null si elle n'existe pas (toute autre erreur est remontée). */
export async function getAoOffer(id: string): Promise<AoOffer | null> {
  const { databases } = createAdminClient()
  try {
    return docToAoOffer(await databases.getDocument(DB_ID, COLLECTIONS.AO_OFFERS, id))
  } catch (err) {
    if ((err as { code?: number }).code === 404) return null
    throw err
  }
}

/** Met à jour une offre ; son statut est aussi recopié dans l'index de la liste (mirrorAoOfferIndex). */
export async function updateAoOffer(id: string, patch: Partial<Omit<AoOffer, '$id' | 'createdAt'>>): Promise<AoOffer> {
  const { databases } = createAdminClient()
  const offer = docToAoOffer(await databases.updateDocument(DB_ID, COLLECTIONS.AO_OFFERS, id, patch))
  if (patch.status) await mirrorAoOfferIndex(id, { status: offer.status })
  return offer
}

/** Document déjà supprimé : ignoré. Une collection ou une base introuvable (configuration) reste une erreur. */
const ignoreMissing = (err: unknown) => { if ((err as { type?: string }).type !== 'document_not_found') throw err }

/**
 * Supprime une offre AO, ses détails (assistance / forfait, technologies, sourcing, contact) et sa ligne d'index.
 * L'e-mail reste enregistré : l'offre n'est pas recréée par la synchronisation suivante.
 */
export async function deleteAoOfferAndDetails(offerId: string): Promise<void> {
  const { databases } = createAdminClient()
  // L'offre d'abord : si la suite échoue, il reste des détails ou une ligne d'index sans offre (ignorés à la lecture,
  // supprimés par npm run ao:index), jamais une offre vivante absente de la liste.
  await databases.deleteDocument(DB_ID, COLLECTIONS.AO_OFFERS, offerId).catch(ignoreMissing)
  await databases.deleteDocument(DB_ID, COLLECTIONS.AO_OFFER_DETAILS, offerId).catch(ignoreMissing)
  await databases.deleteDocument(DB_ID, COLLECTIONS.AO_OFFER_INDEX, offerId).catch(ignoreMissing)
}

// ── Index de la liste (offer-index.ts, ADR 0019) ─────────────────

/** Écrit la ligne d'index d'une offre (créée, ou remplacée si elle existe). */
export async function saveAoOfferIndex(offer: AoOffer, ctx: AoIndexContext): Promise<void> {
  const { databases } = createAdminClient()
  const data = indexDocumentOf(offer, ctx)
  try {
    await databases.createDocument(DB_ID, COLLECTIONS.AO_OFFER_INDEX, offer.$id, data)
  } catch (err) {
    if ((err as { code?: number }).code !== 409) throw err
    await databases.updateDocument(DB_ID, COLLECTIONS.AO_OFFER_INDEX, offer.$id, data)
  }
}

/** Contexte d'index d'une offre tiré de son e-mail d'origine (date, objet, expéditeur) et de l'organisation de sa boîte. */
export function indexContextOf(offer: AoOffer, email: AoEmail | undefined, tenantId: string): AoIndexContext {
  return { tenantId, receivedAt: email?.receivedAt ?? offer.createdAt, subject: email?.subject ?? '', sender: senderOf(email) }
}

/**
 * Reconstruit la ligne d'index d'une offre depuis l'offre, son e-mail et sa boîte (organisation). Offre disparue : sa
 * ligne est supprimée. Boîte introuvable : rien n'est écrit (une offre sans organisation connue ne doit apparaître à
 * personne), signalé dans les journaux.
 */
export async function reindexAoOffer(offerId: string): Promise<void> {
  const { databases } = createAdminClient()
  const offer = await getAoOffer(offerId)
  if (!offer) {
    await databases.deleteDocument(DB_ID, COLLECTIONS.AO_OFFER_INDEX, offerId).catch(ignoreMissing)
    return
  }
  const email = offer.emailId ? await getAoEmail(offer.emailId) : null
  // Import différé : sources.ts est réservé au serveur (server-only) et ce module est aussi chargé par les tests.
  const { getAoSource } = await import('./sources')
  const source = email?.sourceId ? await getAoSource(email.sourceId) : null
  if (!source) {
    console.error('AO: offre sans boîte connue, absente de la liste', offerId)
    return
  }
  await saveAoOfferIndex(offer, indexContextOf(offer, email ?? undefined, source.tenantId))
}

/**
 * Rattrapage de l'index (passages planifiés) : les offres modifiées depuis `since` dont la ligne manque ou dont le
 * statut ou le nombre d'e-mails diffère sont reconstruites — une recopie qui a échoué, une offre écrite par l'ancien code
 * pendant un déploiement — sans attendre `npm run ao:index`. Renvoie le nombre de lignes reconstruites.
 */
export async function reconcileAoOfferIndex(since: Date, max = 500): Promise<number> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.AO_OFFERS, [
    Query.greaterThanEqual('$updatedAt', since.toISOString()), Query.orderDesc('$updatedAt'), Query.limit(max),
  ])
  const offers = res.documents.map(docToAoOffer)
  const lines = new Map<string, Models.Document & Record<string, unknown>>()
  for (const batch of batchByLength(offers.map(o => o.$id), 3000, 100)) {
    const found = await databases.listDocuments(DB_ID, COLLECTIONS.AO_OFFER_INDEX, [
      Query.equal('$id', batch), Query.select(['$id', 'status', 'sourceCount']), Query.limit(batch.length),
    ])
    for (const doc of found.documents) lines.set(doc.$id, doc as Models.Document & Record<string, unknown>)
  }
  let rebuilt = 0
  for (const offer of offers) {
    const line = lines.get(offer.$id)
    if (line && line.status === offer.status && num(line.sourceCount) === offer.sourceCount) continue
    await reindexAoOffer(offer.$id)
    rebuilt++
  }
  return rebuilt
}

/**
 * Recopie dans l'index ce qui vient de changer sur l'offre (statut, nombre d'e-mails). Ligne absente (offre créée avant
 * l'index et pas encore reprise par `npm run ao:index`) : reconstruite entière. Un échec n'annule pas la modification de
 * l'offre, déjà faite : il est journalisé, la liste se corrige à la prochaine écriture ou par `npm run ao:index`.
 */
async function mirrorAoOfferIndex(offerId: string, patch: Partial<Pick<AoOfferIndexDoc, 'status' | 'sourceCount'>>): Promise<void> {
  const { databases } = createAdminClient()
  try {
    await databases.updateDocument(DB_ID, COLLECTIONS.AO_OFFER_INDEX, offerId, patch)
  } catch (err) {
    try {
      if ((err as { code?: number }).code !== 404) throw err
      await reindexAoOffer(offerId)
    } catch (reindexError) {
      console.error('AO: index de la liste non mis à jour (vérifier la collection ao_offer_index, puis npm run ao:index)', offerId, reindexError instanceof Error ? reindexError.message : String(reindexError))
    }
  }
}

// ── Détails des offres (assistance / forfait, technologies) ─────

/**
 * Enregistre les détails d'une offre (document de même identifiant ; mis à jour s'il existe déjà). Le canal n'est écrit
 * que pour la veille : absent, l'offre vient d'un e-mail (et les e-mails ordinaires n'exigent pas l'attribut `channel`).
 * Contact et lien d'origine : écrits seulement s'ils existent (même raison).
 */
export async function saveAoOfferDetails(offerId: string, details: AoOfferDetails, channel?: AoChannel): Promise<void> {
  const { databases } = createAdminClient()
  const data = {
    engagement: details.engagement,
    technologies: details.technologies,
    ...(channel === 'scraping' ? { channel } : {}),
    ...(contactJson(offerId, details.contact)),
    ...(details.sourceUrl ? { sourceUrl: details.sourceUrl } : {}),
  }
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

/**
 * Détails des offres `offerIds` (absents : offre reçue avant ces détails, ou e-mail sans assistance / forfait ni
 * technologie). Canal absent ou inconnu : e-mail.
 */
export async function listAoOfferDetails(offerIds: string[]): Promise<Map<string, AoOfferDetails & { channel: AoChannel }>> {
  const { databases } = createAdminClient()
  const map = new Map<string, AoOfferDetails & { channel: AoChannel }>()
  // Lots lus en parallèle : chaque appel à Appwrite coûte un aller-retour réseau.
  const pages = await Promise.all(batchByLength([...new Set(offerIds.filter(Boolean))]).map(batch =>
    databases.listDocuments(DB_ID, COLLECTIONS.AO_OFFER_DETAILS, [Query.equal('$id', batch), Query.limit(batch.length)])))
  for (const doc of pages.flatMap(res => res.documents) as (Models.Document & Record<string, unknown>)[]) {
    map.set(doc.$id, {
      engagement: engagementOf(str(doc.engagement)),
      technologies: Array.isArray(doc.technologies) ? (doc.technologies as string[]) : [],
      channel: doc.channel === 'scraping' ? 'scraping' : 'email',
      contact: storedContact(str(doc.contact), doc.$id),
      sourceUrl: str(doc.sourceUrl),
    })
  }
  return map
}

/** Contact enregistré en JSON, s'il tient dans son attribut (1 000 caractères) ; sinon écarté et journalisé. */
function contactJson(offerId: string, contact: AoContact | null): { contact?: string } {
  if (!contact) return {}
  const json = JSON.stringify(contact)
  if (json.length <= 1000) return { contact: json }
  console.warn('AO: contact trop long pour être enregistré, écarté', offerId)
  return {}
}

const StoredContactSchema = z.object({ name: z.string(), role: z.string(), email: z.string(), phone: z.string() })

/** Contact enregistré (JSON) ; null s'il n'y en a pas ou s'il est illisible (journalisé). */
export function storedContact(raw: string, offerId: string): AoContact | null {
  if (!raw) return null
  try {
    const parsed = StoredContactSchema.safeParse(JSON.parse(raw))
    if (parsed.success) return parsed.data
  } catch {
    // JSON illisible : traité comme absent (journalisé ci-dessous) ; la page montre alors l'expéditeur.
  }
  console.warn('AO: contact enregistré illisible, ignoré', offerId)
  return null
}

// ── Conservation (RGPD) ──────────────────────────────────────────

/** Supprime les e-mails et offres AO créés avant `before` (les offres publiques déjà créées restent). */
export async function purgeAoRecords(before: Date, maxDeletes = 100): Promise<number> {
  const { databases } = createAdminClient()
  // 404 : déjà supprimé par le passage d'une autre organisation, lancé en même temps.
  const remove = (collection: string, id: string) => databases.deleteDocument(DB_ID, collection, id).catch(ignoreMissing)
  let deleted = 0
  // Commentaires : fonction facultative, purgés seulement si leur collection est configurée (sans elle, rien à purger).
  const collections = [COLLECTIONS.AO_COMMENTS, COLLECTIONS.AO_OFFER_DETAILS, COLLECTIONS.AO_OFFER_INDEX, COLLECTIONS.AO_OFFERS, COLLECTIONS.AO_EMAILS].filter(Boolean)
  for (const collection of collections) {
    const res = await databases.listDocuments(DB_ID, collection, [Query.lessThan('$createdAt', before.toISOString()), Query.limit(maxDeletes - deleted)])
    for (const doc of res.documents) {
      // Détails et ligne d'index partent avec leur offre : écrits après elle (sourcing calculé plus tard, index
      // reconstruit par npm run ao:index), ils ne seraient sinon purgés que bien après, d'après leur propre date.
      if (collection === COLLECTIONS.AO_OFFERS) {
        await remove(COLLECTIONS.AO_OFFER_DETAILS, doc.$id)
        await remove(COLLECTIONS.AO_OFFER_INDEX, doc.$id)
      }
      await remove(collection, doc.$id)
      deleted++
    }
    if (deleted >= maxDeletes) break
  }
  return deleted
}

// ── Lignes du tableau, de l'export et des statistiques ──────────

/** Offres par identifiant, dans l'ordre demandé (une offre supprimée entre-temps est omise). */
async function listAoOffersByIds(ids: string[], tenantId: string): Promise<AoOffer[]> {
  const { databases } = createAdminClient()
  const found = new Map<string, AoOffer>()
  const pages = await Promise.all(batchByLength(ids, 3000, 100).map(batch =>
    databases.listDocuments(DB_ID, COLLECTIONS.AO_OFFERS, [Query.equal('$id', batch), Query.limit(batch.length)])))
  for (const doc of pages.flatMap(res => res.documents)) found.set(doc.$id, docToAoOffer(doc))
  const offers = ids.map(id => found.get(id)).filter((o): o is AoOffer => !!o)
  if (offers.length < ids.length) {
    console.warn('AO: lignes d\'index sans offre, ignorées (npm run ao:index les supprime)', tenantId, ids.filter(id => !found.has(id)).join(','))
  }
  return offers
}

/**
 * Lignes du tableau : chaque offre avec l'expéditeur, l'objet et la date de son e-mail, ses détails et ses commentaires.
 * Seules les offres dont l'e-mail a été lu dans une boîte de l'organisation `tenantId` sont gardées : l'index donne déjà
 * l'organisation, ce second contrôle (celui d'avant l'index, ADR 0005) empêche qu'une ligne erronée montre l'offre d'une
 * autre organisation.
 */
async function aoOfferRowsOf(offers: AoOffer[], tenantId: string): Promise<AoOfferRow[]> {
  if (!offers.length) return []
  const offerIds = offers.map(o => o.$id)
  // Imports différés : comments.ts et sources.ts sont réservés au serveur (server-only) et ce module est aussi chargé
  // par les tests.
  const [{ countAoComments }, { listSources }] = await Promise.all([import('./comments'), import('./sources')])
  const [emails, details, comments, sources] = await Promise.all([
    listAoEmailsByIds(offers.map(o => o.emailId)), listAoOfferDetails(offerIds), countAoComments(offerIds), listSources(tenantId),
  ])
  const own = new Set(sources.map(source => source.$id))
  const outside = offers.filter(offer => !own.has(emails.get(offer.emailId)?.sourceId ?? ''))
  if (outside.length) console.error('AO: lignes d\'index d\'une autre organisation écartées (npm run ao:index)', tenantId, outside.map(o => o.$id).join(','))
  return offers.filter(offer => !outside.includes(offer)).map(offer => {
    const email = emails.get(offer.emailId)
    // E-mail transféré : l'expéditeur affiché (et filtré) est celui du message d'origine ; le collaborateur qui l'a
    // transféré est indiqué à part.
    const origin = parseSender(email?.origin ?? '')
    const sender = senderOf(email)
    return {
      ...offer,
      engagement: details.get(offer.$id)?.engagement ?? '',
      technologies: details.get(offer.$id)?.technologies ?? [],
      contact: details.get(offer.$id)?.contact ?? null,
      sourceUrl: details.get(offer.$id)?.sourceUrl ?? '',
      senderAddress: sender.address,
      senderName: sender.name,
      forwardedBy: email && origin && origin.address !== email.fromAddress.trim().toLowerCase() ? email.fromName || email.fromAddress : '',
      deadline: email?.deadline ?? '',
      attachments: email?.attachments ?? [],
      commentCount: comments.get(offer.$id) ?? 0,
      subject: email?.subject ?? '',
      receivedAt: email?.receivedAt ?? offer.createdAt,
      channel: details.get(offer.$id)?.channel ?? 'email',
    }
  })
}

/**
 * Identifiants des offres de l'organisation qui passent les filtres, dans l'ordre de la liste (la plus récemment reçue
 * d'abord), AO_MAX_LISTED au plus : la liste elle-même, et les offres précédente et suivante d'une page d'offre.
 */
export async function listAoOfferIds(tenantId: string, filters: AoFilters): Promise<string[]> {
  const { databases } = createAdminClient()
  // Par décalage plutôt que par curseur : les offres d'un même e-mail ont la même date de réception, et un curseur sur
  // deux critères de tri pourrait sauter ou répéter des lignes à la jointure des lots. Le premier lot donne le total, les
  // suivants sont lus en parallèle. Doublons écartés quand même.
  const batch = (offset: number) => databases.listDocuments(DB_ID, COLLECTIONS.AO_OFFER_INDEX, [
    ...indexFilterQueries(tenantId, filters),
    ...INDEX_ORDER,
    Query.select(['$id']),
    Query.limit(Math.min(500, AO_MAX_LISTED - offset)),
    Query.offset(offset),
  ])
  const first = await batch(0)
  const offsets: number[] = []
  for (let offset = 500; offset < Math.min(first.total, AO_MAX_LISTED); offset += 500) offsets.push(offset)
  const rest = await Promise.all(offsets.map(batch))
  return [...new Set([first, ...rest].flatMap(res => res.documents.map(doc => doc.$id)))]
}

/** Offres de l'organisation qui passent les filtres (tableau, export Excel, statistiques), dans l'ordre de la liste. */
export async function listAllAoOfferRows(tenantId: string, filters: AoFilters): Promise<AoOfferRow[]> {
  return aoOfferRowsOf(await listAoOffersByIds(await listAoOfferIds(tenantId, filters), tenantId), tenantId)
}

/** Une offre de l'organisation, en ligne du tableau (panneau ouvert sur une offre absente de la liste filtrée). */
export async function getAoOfferRow(offer: AoOffer, tenantId: string): Promise<AoOfferRow | null> {
  const [row] = await aoOfferRowsOf([offer], tenantId)
  return row ?? null
}

/** Indicateurs du haut de la page, sur toutes les offres de l'organisation (pas seulement celles qui passent les filtres). */
export async function aoOfferCounts(tenantId: string): Promise<AoOfferCounts> {
  const { databases } = createAdminClient()
  const count = async (status: string) => (await databases.listDocuments(DB_ID, COLLECTIONS.AO_OFFER_INDEX, [
    Query.equal('tenantId', tenantId), Query.equal('status', status), Query.select(['$id']), Query.limit(1),
  ])).total
  // Doublons : peu d'offres en ont, on les lit toutes (nombre d'e-mails seulement).
  const duplicates = async () => {
    let sum = 0
    let cursor: string | undefined
    for (;;) {
      const res = await databases.listDocuments(DB_ID, COLLECTIONS.AO_OFFER_INDEX, [
        Query.equal('tenantId', tenantId), Query.greaterThan('sourceCount', 1), Query.select(['$id', 'sourceCount']), Query.limit(500),
        ...(cursor ? [Query.cursorAfter(cursor)] : []),
      ])
      sum += res.documents.reduce((n, d) => n + num((d as Models.Document & Record<string, unknown>).sourceCount) - 1, 0)
      if (res.documents.length < 500) return sum
      cursor = res.documents[res.documents.length - 1].$id
    }
  }
  const [toReview, published, ignored, merged] = await Promise.all([count('to_review'), count('published'), count('ignored'), duplicates()])
  return { toReview, published, ignored, duplicates: merged }
}
