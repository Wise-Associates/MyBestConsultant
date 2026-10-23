import { createHash, randomUUID } from 'node:crypto'
import { Query } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import type { Checkpoint } from './checkpoint'
import { counterIdFor, type DailyCounter } from './tenancy'

// État de la synchronisation AO (collection AO_STATE, sans permission client) :
// - un verrou par organisation : une seule synchronisation à la fois de ses boîtes (Vercel Cron, boutons, ao:poll) ;
// - un point de reprise par boîte lue (voir checkpoint.ts) ;
// - les compteurs quotidiens de chaque organisation (lectures d'images / PDF scannés par l'IA, offres de tableaux).
// Ce sont des documents à identifiant fixe : la création échoue (409) si le document existe déjà,
// ce que la base garantit même entre plusieurs instances Vercel.

/** Plus long que la durée maximale d'un passage (300 s sur Vercel). */
export const SYNC_LOCK_TTL_MS = 6 * 60_000

const codeOf = (err: unknown) => (err as { code?: number }).code

export interface SyncLock {
  /** Document du verrou (tenancy.ts : lockIdFor). */
  id: string
  token: string
}

/**
 * Prend le verrou ; null si une autre synchronisation le détient encore. Un verrou expiré (passage
 * interrompu sans le rendre) est repris. `holder` : origine du passage (cron, admin…), pour le diagnostic.
 */
export async function acquireSyncLock(lockId: string, holder: string, now: Date): Promise<SyncLock | null> {
  const { databases } = createAdminClient()
  const token = randomUUID()
  const create = () => databases.createDocument(DB_ID, COLLECTIONS.AO_STATE, lockId, {
    kind: 'lock',
    holder: holder.slice(0, 200),
    token,
    expiresAt: new Date(now.getTime() + SYNC_LOCK_TTL_MS).toISOString(),
  })

  try {
    await create()
    return { id: lockId, token }
  } catch (err) {
    if (codeOf(err) !== 409) throw err
  }
  // Verrou présent : toujours valide → passage ignoré ; expiré → on le reprend.
  const current = await getOrNull(lockId)
  if (current && new Date(String(current.expiresAt)).getTime() > now.getTime()) return null
  await databases.deleteDocument(DB_ID, COLLECTIONS.AO_STATE, lockId).catch(err => { if (codeOf(err) !== 404) throw err })
  try {
    await create()
  } catch (err) {
    if (codeOf(err) === 409) return null // repris au même instant par un autre passage
    throw err
  }
  // Deux passages ont pu voir le même verrou expiré : le second à l'écrire l'emporte, l'autre s'efface.
  await new Promise(resolve => setTimeout(resolve, 500))
  return (await getOrNull(lockId))?.token === token ? { id: lockId, token } : null
}

/** Document d'état, ou null s'il n'existe pas (toute autre erreur est remontée). */
async function getOrNull(id: string) {
  const { databases } = createAdminClient()
  try {
    return await databases.getDocument(DB_ID, COLLECTIONS.AO_STATE, id)
  } catch (err) {
    if (codeOf(err) === 404) return null
    throw err
  }
}

/** Rend le verrou, seulement s'il est toujours le nôtre (il a pu expirer et être repris entre-temps). */
export async function releaseSyncLock(lock: SyncLock): Promise<void> {
  const { databases } = createAdminClient()
  // Un échec ici n'est pas bloquant : le verrou expire de lui-même après SYNC_LOCK_TTL_MS.
  const current = await getOrNull(lock.id).catch(() => null)
  if (current?.token === lock.token) await databases.deleteDocument(DB_ID, COLLECTIONS.AO_STATE, lock.id).catch(() => undefined)
}

const fullReadId = (sourceId: string) => `full_${createHash('sha1').update(sourceId).digest('hex').slice(0, 16)}`

/**
 * Lecture complète d'une boîte (checkpoint.ts : FULL_READ_DAYS) : un document marque qu'elle est en cours, d'un passage
 * à l'autre, jusqu'à ce qu'un rattrapage aille au bout. Sous le verrou de l'organisation de la boîte.
 */
export async function isFullReadPending(sourceId: string): Promise<boolean> {
  return (await getOrNull(fullReadId(sourceId))) !== null
}

export async function startFullRead(sourceId: string): Promise<void> {
  const { databases } = createAdminClient()
  await databases.createDocument(DB_ID, COLLECTIONS.AO_STATE, fullReadId(sourceId), { kind: 'flag' }).catch(err => { if (codeOf(err) !== 409) throw err })
}

export async function endFullRead(sourceId: string): Promise<void> {
  const { databases } = createAdminClient()
  await databases.deleteDocument(DB_ID, COLLECTIONS.AO_STATE, fullReadId(sourceId)).catch(err => { if (codeOf(err) !== 404) throw err })
}

/** Identifiant Appwrite stable d'une boîte lue (serveur + compte + dossier), 33 caractères. */
export function checkpointIdFor(source: string): string {
  return `cp_${createHash('sha1').update(source).digest('hex').slice(0, 30)}`
}

export async function getCheckpoint(id: string): Promise<Checkpoint | null> {
  const doc = await getOrNull(id)
  if (!doc) return null
  return {
    uidValidity: String(doc.uidValidity ?? ''),
    lastUid: Number(doc.lastUid ?? 0),
    reconciledAt: typeof doc.reconciledAt === 'string' ? doc.reconciledAt : null,
  }
}

export async function saveCheckpoint(id: string, checkpoint: Checkpoint): Promise<void> {
  const { databases } = createAdminClient()
  const data = { kind: 'checkpoint', ...checkpoint }
  try {
    await databases.updateDocument(DB_ID, COLLECTIONS.AO_STATE, id, data)
  } catch (err) {
    if (codeOf(err) !== 404) throw err
    await databases.createDocument(DB_ID, COLLECTIONS.AO_STATE, id, data)
  }
}

/**
 * Compte une lecture par l'IA pour la journée (UTC) de l'organisation ; false si `limit` est atteinte. Appelé sous le
 * verrou de l'organisation : pas d'écritures concurrentes sur son compteur.
 */
export async function takeDailyVisionCall(tenantId: string, now: Date, limit: number): Promise<boolean> {
  return takeDaily(counterIdFor('vision', tenantId, now), 1, limit)
}

/**
 * Compte `amount` offres lues dans des tableaux joints pour la journée (UTC) de l'organisation ; false si `limit`
 * serait dépassée. Sous le verrou de l'organisation, comme takeDailyVisionCall.
 */
export async function takeDailyTableOffers(tenantId: string, now: Date, amount: number, limit: number): Promise<boolean> {
  return takeDaily(counterIdFor('tables', tenantId, now), amount, limit)
}

/**
 * Prend une place parmi `limit` pour la journée (compteur `counter` de `key`) ; false si toutes sont prises. Chaque
 * place est un document à identifiant fixe, créé de façon atomique (409 s'il existe déjà) : même lancées en parallèle,
 * jamais plus de `limit` demandes ne passent. Pour les limites appelées hors du verrou de synchronisation (tests de
 * connexion), où takeDaily, qui lit puis réécrit un total, laisserait passer des rafales.
 */
export async function takeDailySlot(counter: DailyCounter, key: string, now: Date, limit: number): Promise<boolean> {
  const { databases } = createAdminClient()
  const base = counterIdFor(counter, key, now)
  // Places déjà prises : on commence la recherche après elles (sinon chaque demande essaierait toutes les places).
  const used = (await databases.listDocuments(DB_ID, COLLECTIONS.AO_STATE, [Query.equal('holder', base), Query.limit(1)])).total
  for (let slot = used; slot < limit; slot++) {
    try {
      await databases.createDocument(DB_ID, COLLECTIONS.AO_STATE, `${base}_${slot}`, { kind: 'slot', holder: base })
      return true
    } catch (err) {
      if (codeOf(err) !== 409) throw err
    }
  }
  return false
}

/**
 * Supprime les compteurs et places quotidiens créés avant `before` (passages planifiés ; 100 au plus par appel).
 * Renvoie le nombre de documents trouvés : 100 signifie qu'il en reste peut-être (la purge de l'assistant IA rappelle
 * alors la fonction, ses places de quota étant bien plus nombreuses).
 */
export async function purgeDailyState(before: Date): Promise<number> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.AO_STATE, [
    Query.equal('kind', ['counter', 'slot']), Query.lessThan('$createdAt', before.toISOString()), Query.limit(100),
  ])
  for (const doc of res.documents) {
    await databases.deleteDocument(DB_ID, COLLECTIONS.AO_STATE, doc.$id).catch(err => { if (codeOf(err) !== 404) throw err })
  }
  return res.documents.length
}

/** Compteur quotidien (document à identifiant fixe de AO_STATE) : ajoute `amount` si `limit` n'est pas dépassée. */
async function takeDaily(id: string, amount: number, limit: number): Promise<boolean> {
  const { databases } = createAdminClient()
  const current = await getOrNull(id)
  const used = Number(current?.count ?? 0)
  if (used + amount > limit) return false
  if (current) await databases.updateDocument(DB_ID, COLLECTIONS.AO_STATE, id, { count: used + amount })
  else await databases.createDocument(DB_ID, COLLECTIONS.AO_STATE, id, { kind: 'counter', count: amount })
  return true
}

/**
 * Rend une lecture comptée par takeDailyVisionCall avec le même `now` (même journée), quand aucun service
 * ne l'a facturée. Sous le verrou de synchronisation, comme takeDailyVisionCall.
 */
export async function releaseDailyVisionCall(tenantId: string, now: Date): Promise<void> {
  const { databases } = createAdminClient()
  const id = counterIdFor('vision', tenantId, now)
  const used = Number((await getOrNull(id))?.count ?? 0)
  if (used > 0) await databases.updateDocument(DB_ID, COLLECTIONS.AO_STATE, id, { count: used - 1 })
}
