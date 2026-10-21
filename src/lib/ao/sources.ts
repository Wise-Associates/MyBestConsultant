import 'server-only'
import { Query, type Models } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { batchByLength } from './repo'
import { canUseAoSourcing, PLATFORM_NAME, PLATFORM_TENANT_ID } from './tenancy'

// Boîtes de réception lues par AO Offers (collection AO_SOURCES, sans permission client) : celles de la plateforme
// (ao@wise-associates.fr…) et celles que chaque organisation configure. Le mot de passe y est chiffré (credentials.ts)
// et n'est jamais renvoyé au navigateur.

export interface AoSource {
  $id: string
  tenantId: string
  label: string
  /** Nom d'hôte du serveur IMAP (port 993, TLS) ; vérifié à chaque connexion (imap-host.ts). */
  host: string
  username: string
  /** Mot de passe chiffré, lié à cette boîte (credentials.ts). */
  passwordSealed: string
  /** Dossier lu, en lecture seule (INBOX par défaut). */
  mailbox: string
  enabled: boolean
  /** Domaines de l'organisation : ses adresses transfèrent les AO, elles n'en sont jamais l'origine (origin.ts). */
  ownDomains: string[]
  lastSyncAt: string | null
  /** Dernière erreur de lecture de la boîte ('' si la dernière lecture a réussi). */
  lastError: string
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export function docToAoSource(d: Models.Document): AoSource {
  const doc = d as Models.Document & Record<string, unknown>
  return {
    $id: d.$id,
    tenantId: str(doc.tenantId),
    label: str(doc.label),
    host: str(doc.host),
    username: str(doc.username),
    passwordSealed: str(doc.passwordSealed),
    mailbox: str(doc.mailbox) || 'INBOX',
    enabled: doc.enabled === true,
    ownDomains: Array.isArray(doc.ownDomains) ? (doc.ownDomains as string[]) : [],
    lastSyncAt: str(doc.lastSyncAt) || null,
    lastError: str(doc.lastError),
  }
}

/**
 * Boîtes actives, de toutes les organisations ou d'une seule ; les moins récemment tentées d'abord (jamais lues en
 * tête) : chaque passage reprend là où le précédent s'est arrêté.
 */
export async function listEnabledSources(tenantId?: string): Promise<AoSource[]> {
  const { databases } = createAdminClient()
  const sources: AoSource[] = []
  let cursor: string | null = null
  for (;;) {
    const res: Models.DocumentList<Models.Document> = await databases.listDocuments(DB_ID, COLLECTIONS.AO_SOURCES, [
      Query.equal('enabled', true),
      ...(tenantId ? [Query.equal('tenantId', tenantId)] : []),
      Query.orderAsc('lastSyncAt'),
      Query.orderAsc('$id'),
      Query.limit(100),
      ...(cursor ? [Query.cursorAfter(cursor)] : []),
    ])
    sources.push(...res.documents.map(docToAoSource))
    if (res.documents.length < 100) return sources
    cursor = res.documents[res.documents.length - 1].$id
  }
}

/** Toutes les boîtes d'une organisation, actives ou non (leurs e-mails et offres restent consultables). */
export async function listSources(tenantId: string): Promise<AoSource[]> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.AO_SOURCES, [Query.equal('tenantId', tenantId), Query.orderAsc('$createdAt'), Query.limit(100)])
  return res.documents.map(docToAoSource)
}

/** Boîte par identifiant ; null si elle n'existe pas (toute autre erreur est remontée). */
export async function getAoSource(id: string): Promise<AoSource | null> {
  const { databases } = createAdminClient()
  try {
    return docToAoSource(await databases.getDocument(DB_ID, COLLECTIONS.AO_SOURCES, id))
  } catch (err) {
    if ((err as { code?: number }).code === 404) return null
    throw err
  }
}

/** Tentative de lecture d'une boîte (début de la tentative) et son résultat (affichés à l'organisation et à l'admin). */
export async function recordSourceSync(id: string, result: { at: Date; error: string }): Promise<void> {
  const { databases } = createAdminClient()
  await databases.updateDocument(DB_ID, COLLECTIONS.AO_SOURCES, id, { lastSyncAt: result.at.toISOString(), lastError: result.error.slice(0, 1000) })
}

/** Raison pour laquelle une boîte n'est pas lue (abonnement inactif…), sans changer la date de sa dernière lecture. */
export async function recordSourceError(id: string, error: string): Promise<void> {
  const { databases } = createAdminClient()
  await databases.updateDocument(DB_ID, COLLECTIONS.AO_SOURCES, id, { lastError: error.slice(0, 1000) })
}

/** Organisation qui lit une ou plusieurs boîtes. */
export interface AoOrganization {
  tenantId: string
  name: string
  /** Abonnement actif (ou plateforme) : ses boîtes sont lues (tenancy.ts : canUseAoSourcing). */
  entitled: boolean
}

/** Organisations (nom, droit de lecture) ; une organisation supprimée n'apparaît pas. */
export async function loadOrganizations(tenantIds: string[]): Promise<Map<string, AoOrganization>> {
  const { databases } = createAdminClient()
  const orgs = new Map<string, AoOrganization>()
  if (tenantIds.includes(PLATFORM_TENANT_ID)) orgs.set(PLATFORM_TENANT_ID, { tenantId: PLATFORM_TENANT_ID, name: PLATFORM_NAME, entitled: true })
  for (const batch of batchByLength([...new Set(tenantIds.filter(id => id && id !== PLATFORM_TENANT_ID))])) {
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.TENANTS, [Query.equal('$id', batch), Query.limit(batch.length)])
    for (const doc of res.documents) {
      orgs.set(doc.$id, { tenantId: doc.$id, name: str(doc.name), entitled: canUseAoSourcing(doc.$id, str(doc.subscriptionStatus)) })
    }
  }
  return orgs
}
