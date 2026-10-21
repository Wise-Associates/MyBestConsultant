import { createHash, randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import type { Checkpoint } from './checkpoint'

// État de la synchronisation AO (collection AO_STATE, sans permission client) :
// - le verrou qui garantit une seule synchronisation à la fois (Vercel Cron, bouton admin, ao:poll) ;
// - un point de reprise par boîte lue (voir checkpoint.ts) ;
// - le compteur quotidien des lectures par l'IA (images, PDF scannés).
// Ce sont des documents à identifiant fixe : la création échoue (409) si le document existe déjà,
// ce que la base garantit même entre plusieurs instances Vercel.

const LOCK_ID = 'sync_lock'
/** Plus long que la durée maximale d'un passage (300 s sur Vercel). */
export const SYNC_LOCK_TTL_MS = 6 * 60_000

const codeOf = (err: unknown) => (err as { code?: number }).code

export interface SyncLock {
  token: string
}

/**
 * Prend le verrou ; null si une autre synchronisation le détient encore. Un verrou expiré (passage
 * interrompu sans le rendre) est repris. `holder` : origine du passage (cron, admin…), pour le diagnostic.
 */
export async function acquireSyncLock(holder: string, now: Date): Promise<SyncLock | null> {
  const { databases } = createAdminClient()
  const token = randomUUID()
  const create = () => databases.createDocument(DB_ID, COLLECTIONS.AO_STATE, LOCK_ID, {
    kind: 'lock',
    holder: holder.slice(0, 200),
    token,
    expiresAt: new Date(now.getTime() + SYNC_LOCK_TTL_MS).toISOString(),
  })

  try {
    await create()
    return { token }
  } catch (err) {
    if (codeOf(err) !== 409) throw err
  }
  // Verrou présent : toujours valide → passage ignoré ; expiré → on le reprend.
  const current = await getOrNull(LOCK_ID)
  if (current && new Date(String(current.expiresAt)).getTime() > now.getTime()) return null
  await databases.deleteDocument(DB_ID, COLLECTIONS.AO_STATE, LOCK_ID).catch(err => { if (codeOf(err) !== 404) throw err })
  try {
    await create()
  } catch (err) {
    if (codeOf(err) === 409) return null // repris au même instant par un autre passage
    throw err
  }
  // Deux passages ont pu voir le même verrou expiré : le second à l'écrire l'emporte, l'autre s'efface.
  await new Promise(resolve => setTimeout(resolve, 500))
  return (await getOrNull(LOCK_ID))?.token === token ? { token } : null
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
  const current = await getOrNull(LOCK_ID).catch(() => null)
  if (current?.token === lock.token) await databases.deleteDocument(DB_ID, COLLECTIONS.AO_STATE, LOCK_ID).catch(() => undefined)
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

const visionCounterId = (now: Date) => `vision_${now.toISOString().slice(0, 10)}`

/**
 * Compte une lecture par l'IA pour la journée (UTC) ; false si `limit` est atteinte. Appelé sous le
 * verrou de synchronisation : pas d'écritures concurrentes sur le compteur.
 */
export async function takeDailyVisionCall(now: Date, limit: number): Promise<boolean> {
  return takeDaily(visionCounterId(now), 1, limit)
}

/**
 * Compte `amount` offres lues dans des tableaux joints pour la journée (UTC) ; false si `limit` serait dépassée.
 * Sous le verrou de synchronisation, comme takeDailyVisionCall.
 */
export async function takeDailyTableOffers(now: Date, amount: number, limit: number): Promise<boolean> {
  return takeDaily(`tables_${now.toISOString().slice(0, 10)}`, amount, limit)
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
export async function releaseDailyVisionCall(now: Date): Promise<void> {
  const { databases } = createAdminClient()
  const id = visionCounterId(now)
  const used = Number((await getOrNull(id))?.count ?? 0)
  if (used > 0) await databases.updateDocument(DB_ID, COLLECTIONS.AO_STATE, id, { count: used - 1 })
}
