import 'server-only'
import { Query, type Models } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import type { MbcProfile, MbcRevealed } from './rules'
import { SAVED_PEOPLE_MAX, parseSavedPersonDoc, savedPersonDocId, savedPersonFields, type MbcSavedPerson } from './saved'
import { followFields, type MbcFollow } from './follow'

// Personnes enregistrées par un recruteur dans MBC Search (collection mbc_saved_people, sans permission client : seul
// le serveur la lit). Toute lecture et toute écriture portent sur le compte du recruteur de la session (`userId`,
// compte Auth comme l'historique des recherches), vérifié sur le document : celui d'un autre est « introuvable ».

export const isMbcSavedStoreConfigured = () => !!COLLECTIONS.MBC_SAVED_PEOPLE

export class MbcSavedStoreError extends Error {}

function collection(): string {
  if (!COLLECTIONS.MBC_SAVED_PEOPLE) throw new MbcSavedStoreError('Personnes enregistrées indisponibles : APPWRITE_COLLECTION_MBC_SAVED_PEOPLE non définie.')
  return COLLECTIONS.MBC_SAVED_PEOPLE
}

const codeOf = (err: unknown) => (err as { code?: number }).code
const typeOf = (err: unknown) => (err as { type?: string }).type

/** Personnes enregistrées par le recruteur, la plus récente d'abord. */
export async function listSavedPeople(userId: string): Promise<MbcSavedPerson[]> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, collection(), [
    // Marge au-delà de SAVED_PEOPLE_MAX : deux enregistrements simultanés peuvent la dépasser d'une ou deux personnes.
    Query.equal('userId', userId), Query.orderDesc('savedAt'), Query.limit(SAVED_PEOPLE_MAX + 10),
  ])
  const list: MbcSavedPerson[] = []
  const unreadable: string[] = []
  for (const d of res.documents) {
    const person = parseSavedPersonDoc(d as unknown as Record<string, unknown>)
    if (person) list.push(person)
    else unreadable.push(d.$id)
  }
  // Invisible à l'écran mais compté dans SAVED_PEOPLE_MAX : signalé (identifiants de document seulement, pas de profil).
  if (unreadable.length > 0) console.error('[mbc-search] personnes enregistrées illisibles écartées', unreadable.join(','))
  return list
}

/** La personne si le recruteur l'a déjà enregistrée, sinon null. */
export async function savedPerson(userId: string, apolloId: string): Promise<MbcSavedPerson | null> {
  const { databases } = createAdminClient()
  try {
    const doc = await databases.getDocument(DB_ID, collection(), savedPersonDocId(userId, apolloId))
    return doc.userId === userId ? parseSavedPersonDoc(doc as unknown as Record<string, unknown>) : null
  } catch (err) {
    if (codeOf(err) === 404) return null
    throw err
  }
}

/** Personnes déjà enregistrées par le recruteur parmi `apolloIds` (100 au plus : limite d'Appwrite par Query.equal). */
export async function savedPeopleAmong(userId: string, apolloIds: string[]): Promise<MbcSavedPerson[]> {
  if (apolloIds.length === 0) return []
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, collection(), [
    Query.equal('userId', userId), Query.equal('apolloId', apolloIds.slice(0, 100)), Query.limit(100),
  ])
  return res.documents.flatMap(d => parseSavedPersonDoc(d as unknown as Record<string, unknown>) ?? [])
}

/** Nombre de personnes enregistrées par le recruteur. */
export async function countSavedPeople(userId: string): Promise<number> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, collection(), [Query.equal('userId', userId), Query.select(['$id']), Query.limit(1)])
  return res.total
}

/**
 * Enregistre la personne pour le recruteur ; déjà enregistrée (deux clics simultanés) : la version déjà gardée.
 * 'full' : SAVED_PEOPLE_MAX dépassé par des enregistrements simultanés, le document vient d'être retiré.
 */
export async function saveSavedPerson(input: {
  userId: string; tenantId: string; search: MbcProfile; profile: MbcRevealed; now: Date
}): Promise<MbcSavedPerson | 'full'> {
  const { databases, users } = createAdminClient()
  const id = savedPersonDocId(input.userId, input.profile.id)
  let doc: Models.Document
  try {
    doc = await databases.createDocument(DB_ID, collection(), id, {
      userId: input.userId, tenantId: input.tenantId, apolloId: input.profile.id, savedAt: input.now.toISOString(),
      ...savedPersonFields(input.search, input.profile),
    })
  } catch (err) {
    if (codeOf(err) !== 409) throw err
    const existing = await savedPerson(input.userId, input.profile.id)
    if (!existing) throw new MbcSavedStoreError('Personne enregistrée illisible.')
    return existing
  }
  const remove = () => databases.deleteDocument(DB_ID, collection(), id).catch(e => { if (codeOf(e) !== 404) throw e })
  // Revérifié après l'écriture, la révélation ayant pu durer plusieurs secondes : un compte supprimé entre-temps a déjà
  // vidé cette collection (rien ne doit rester, sans limite de durée), et des enregistrements simultanés ont pu dépasser
  // le plafond. Vérification impossible : le document est gardé (la suppression du compte repasse après lui).
  try {
    await users.get(input.userId)
    if ((await countSavedPeople(input.userId)) > SAVED_PEOPLE_MAX) {
      await remove()
      return 'full'
    }
  } catch (err) {
    if (codeOf(err) !== 404) {
      console.error('[mbc-search] vérification après enregistrement impossible', err instanceof Error ? err.message : String(err))
    } else {
      await remove()
      throw new MbcSavedStoreError('Compte supprimé pendant l\'enregistrement.')
    }
  }
  const saved = parseSavedPersonDoc(doc as unknown as Record<string, unknown>)
  if (!saved) throw new MbcSavedStoreError('Personne enregistrée illisible.')
  return saved
}

/** Attributs du suivi pas encore créés sur ce projet (`schema:push`, ADR 0039) : enregistrer le suivi est impossible. */
export class MbcFollowUnavailableError extends Error {}

/**
 * Enregistre le suivi (statut, note, étiquettes) d'une personne de la liste du recruteur, si le document n'a pas changé
 * depuis que l'écran l'a lu (`expectedUpdatedAt`) : sinon 'stale' — un autre onglet a enregistré entre-temps, sa note
 * serait écrasée sans prévenir. 'missing' : elle n'est pas dans la liste (retirée, ou d'un autre recruteur). Appwrite
 * 1.7 n'a pas d'écriture conditionnelle : il reste un intervalle de quelques millisecondes, acceptable pour la liste
 * personnelle d'un seul recruteur.
 */
export async function updateSavedFollow(
  userId: string, apolloId: string, follow: MbcFollow, expectedUpdatedAt: string,
): Promise<'missing' | 'stale' | { updatedAt: string }> {
  const { databases } = createAdminClient()
  const id = savedPersonDocId(userId, apolloId)
  try {
    const doc = await databases.getDocument(DB_ID, collection(), id, [Query.select(['$id', '$updatedAt', 'userId'])])
    if (doc.userId !== userId) return 'missing'
    if (doc.$updatedAt !== expectedUpdatedAt) return 'stale'
    const updated = await databases.updateDocument(DB_ID, collection(), id, followFields(follow))
    return { updatedAt: updated.$updatedAt }
  } catch (err) {
    if (codeOf(err) === 404) return 'missing'
    // Attribut inconnu d'Appwrite : la structure n'a pas été poussée sur ce projet.
    const message = err instanceof Error ? err.message : String(err)
    if (typeOf(err) === 'document_invalid_structure' && message.includes('Unknown attribute')) throw new MbcFollowUnavailableError(message)
    throw err
  }
}

/** Retire la personne de la liste du recruteur ; false : elle n'y était pas. */
export async function deleteSavedPerson(userId: string, apolloId: string): Promise<boolean> {
  const { databases } = createAdminClient()
  const id = savedPersonDocId(userId, apolloId)
  try {
    const doc = await databases.getDocument(DB_ID, collection(), id)
    if (doc.userId !== userId) return false
  } catch (err) {
    if (codeOf(err) === 404) return false
    throw err
  }
  await databases.deleteDocument(DB_ID, collection(), id).catch(e => { if (codeOf(e) !== 404) throw e })
  return true
}

/**
 * Supprime toutes les personnes enregistrées par un compte (suppression du compte, retrait d'un membre : RGPD).
 * Collection absente (variable définie avant sa création) : rien n'est stocké, donc rien à supprimer.
 */
export async function deleteSavedPeopleForUser(userId: string): Promise<void> {
  if (!isMbcSavedStoreConfigured()) return
  const { databases } = createAdminClient()
  for (;;) {
    let page: Models.DocumentList<Models.Document>
    try {
      page = await databases.listDocuments(DB_ID, collection(), [Query.equal('userId', userId), Query.select(['$id']), Query.limit(100)])
    } catch (err) {
      if (typeOf(err) !== 'collection_not_found') throw err
      console.warn('[mbc-search] collection des personnes enregistrées absente : rien à supprimer')
      return
    }
    for (const doc of page.documents) {
      await databases.deleteDocument(DB_ID, collection(), doc.$id).catch(e => { if (codeOf(e) !== 404) throw e })
    }
    if (page.documents.length < 100) return
  }
}
