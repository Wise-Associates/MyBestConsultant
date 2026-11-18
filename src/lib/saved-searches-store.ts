import 'server-only'
import { ID, Query, type Models } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { listAllByValues, listAllDocuments } from '@/lib/appwrite/list-all'
import { mapLimit } from '@/lib/concurrency'
import { wrapEmailHtml } from '@/lib/email-template'
import { filterCandidates } from '@/lib/cvtheque-search'
import { SEARCHABLE_FIELDS, searchableCandidateOf } from '@/lib/cvtheque-candidate'
import { alertProfilePath } from '@/lib/recruiter-alerts'
import {
  SAVED_SEARCHES_MAX, candidateHighlights, isRetryDue, newMatchCount, savedSearchEmail, savedSearchOf, searchAlertDocId, shouldAlert,
  type SavedSearch, type SavedSearchInput,
} from '@/lib/saved-searches'

// Recherches enregistrées de la CV Thèque et leurs alertes (ADR 0046) : lecture et écriture des recherches (appelées par
// des actions qui ont vérifié le recruteur), comparaison d'un candidat aux recherches actives et e-mail à leurs auteurs
// (appelées après le dépôt d'un CV ou par le cron de rattrapage, jamais depuis le navigateur). Historique des alertes :
// collection recruiter_alerts (ADR 0045), source « recherche ». Une alerte ne fait jamais échouer le dépôt d'un CV.

export const isSavedSearchesConfigured = () => !!COLLECTIONS.SAVED_SEARCHES && !!COLLECTIONS.RECRUITER_ALERTS

const origin = () => process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
const codeOf = (err: unknown) => (err as { code?: unknown } | null)?.code
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
const str = (v: unknown) => (typeof v === 'string' ? v : '')
/** Document absent, à distinguer d'une collection absente (variable définie avant schema:push), qui reste une erreur. */
const isDocumentMissing = (err: unknown) => (err as { type?: unknown } | null)?.type === 'document_not_found'

// ── Recherches du recruteur ─────────────────────────────────────────────────────────────────────────────────────────

export async function listOwnSavedSearches(ownerId: string): Promise<SavedSearch[]> {
  const docs = await listAllDocuments(createAdminClient().databases, DB_ID, COLLECTIONS.SAVED_SEARCHES, [
    Query.equal('ownerId', ownerId), Query.orderDesc('$createdAt'),
  ])
  return docs.map(d => savedSearchOf(d as unknown as Record<string, unknown>))
}

/** La recherche, seulement si elle est à ce recruteur (sinon null : « introuvable », comme si elle n'existait pas). */
export async function getOwnSavedSearch(ownerId: string, id: string): Promise<SavedSearch | null> {
  try {
    const doc = await createAdminClient().databases.getDocument(DB_ID, COLLECTIONS.SAVED_SEARCHES, id)
    return doc.ownerId === ownerId ? savedSearchOf(doc as unknown as Record<string, unknown>) : null
  } catch (err) {
    if (isDocumentMissing(err)) return null
    throw err
  }
}

const fieldsOf = (input: SavedSearchInput) => ({
  name: input.name, description: input.description || null, emailAlerts: input.emailAlerts, filtersJson: JSON.stringify(input.filters),
})

export async function createSavedSearch(owner: { ownerId: string; tenantId: string }, input: SavedSearchInput): Promise<SavedSearch | 'full'> {
  const { databases } = createAdminClient()
  const mine = [Query.equal('ownerId', owner.ownerId), Query.select(['$id'])]
  const count = await databases.listDocuments(DB_ID, COLLECTIONS.SAVED_SEARCHES, [...mine, Query.limit(1)])
  if (count.total >= SAVED_SEARCHES_MAX) return 'full'
  const doc = await databases.createDocument(DB_ID, COLLECTIONS.SAVED_SEARCHES, ID.unique(), {
    tenantId: owner.tenantId, ownerId: owner.ownerId, active: true, ...fieldsOf(input),
  })
  // Plafond revérifié après l'écriture : des demandes parallèles passent toutes le premier contrôle. Seules les
  // SAVED_SEARCHES_MAX plus anciennes restent.
  const kept = await databases.listDocuments(DB_ID, COLLECTIONS.SAVED_SEARCHES, [...mine, Query.orderAsc('$createdAt'), Query.limit(SAVED_SEARCHES_MAX)])
  if (!kept.documents.some(d => d.$id === doc.$id)) {
    await databases.deleteDocument(DB_ID, COLLECTIONS.SAVED_SEARCHES, doc.$id)
    return 'full'
  }
  return savedSearchOf(doc as unknown as Record<string, unknown>)
}

/** Nom, description, e-mails et filtres remplacés ; null si la recherche n'est pas à ce recruteur. */
export async function updateSavedSearch(ownerId: string, id: string, input: SavedSearchInput): Promise<SavedSearch | null> {
  if (!await getOwnSavedSearch(ownerId, id)) return null
  const doc = await createAdminClient().databases.updateDocument(DB_ID, COLLECTIONS.SAVED_SEARCHES, id, fieldsOf(input))
  return savedSearchOf(doc as unknown as Record<string, unknown>)
}

export async function setSavedSearchFlags(ownerId: string, id: string, flags: { active?: boolean; emailAlerts?: boolean }): Promise<SavedSearch | null> {
  if (!await getOwnSavedSearch(ownerId, id)) return null
  const doc = await createAdminClient().databases.updateDocument(DB_ID, COLLECTIONS.SAVED_SEARCHES, id, flags)
  return savedSearchOf(doc as unknown as Record<string, unknown>)
}

/** Supprime la recherche ; ses alertes restent dans l'historique (« Recherche supprimée »). */
export async function deleteSavedSearch(ownerId: string, id: string): Promise<boolean> {
  if (!await getOwnSavedSearch(ownerId, id)) return false
  await createAdminClient().databases.deleteDocument(DB_ID, COLLECTIONS.SAVED_SEARCHES, id)
  return true
}

/** Ouverture dans la CV Thèque : les correspondances suivantes seront « nouvelles ». */
export async function markSavedSearchOpened(id: string, now: Date): Promise<void> {
  await createAdminClient().databases.updateDocument(DB_ID, COLLECTIONS.SAVED_SEARCHES, id, { lastOpenedAt: now.toISOString() })
}

/** Toutes les recherches d'un compte supprimé ou d'un membre retiré. Collection non configurée : rien n'est stocké. */
export async function deleteSavedSearchesOf(ownerId: string): Promise<void> {
  if (!COLLECTIONS.SAVED_SEARCHES) return
  const { databases } = createAdminClient()
  const docs = await listAllDocuments(databases, DB_ID, COLLECTIONS.SAVED_SEARCHES, [Query.equal('ownerId', ownerId), Query.select(['$id'])])
  for (const doc of docs) {
    await databases.deleteDocument(DB_ID, COLLECTIONS.SAVED_SEARCHES, doc.$id).catch(e => { if (codeOf(e) !== 404) throw e })
  }
}

// ── Chiffres de la page « Alertes » ─────────────────────────────────────────────────────────────────────────────────

/** Candidats de la CV Thèque (rôle candidat, avec un CV), lus pour la recherche. */
async function listSearchableCandidates() {
  const docs = await listAllDocuments(createAdminClient().databases, DB_ID, COLLECTIONS.USERS, [
    Query.equal('role', 'candidate'), Query.isNotNull('cvFileId'), Query.select([...SEARCHABLE_FIELDS]),
  ])
  return docs.filter(d => str(d.cvFileId)).map(d => searchableCandidateOf(d as unknown as Record<string, unknown>))
}

export interface SavedSearchStats {
  /** Candidats qui répondent aujourd'hui à la recherche (toute la base, pas seulement les 500 de la liste). */
  matching: number
  /** Alertes arrivées depuis la dernière ouverture. */
  newMatches: number
}

/** Chiffres de chaque recherche du recruteur, recalculés sur la base actuelle (jamais tirés de résultats gardés). */
export async function savedSearchStats(ownerId: string, searches: SavedSearch[], now: Date): Promise<Map<string, SavedSearchStats>> {
  const stats = new Map<string, SavedSearchStats>()
  if (searches.length === 0) return stats
  const { databases } = createAdminClient()
  const [candidates, alerts] = await Promise.all([
    listSearchableCandidates(),
    listAllByValues(databases, DB_ID, COLLECTIONS.RECRUITER_ALERTS, 'searchId', searches.map(s => s.id), [
      Query.equal('recipientId', ownerId), Query.select(['$id', '$createdAt', 'searchId']),
    ]),
  ])
  for (const s of searches) {
    stats.set(s.id, {
      matching: filterCandidates(candidates, s.filters, now).length,
      newMatches: newMatchCount(alerts.filter(a => a.searchId === s.id).map(a => a.$createdAt), s.lastOpenedAt),
    })
  }
  return stats
}

// ── Alertes ─────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Owner { profile: Models.Document; userId: string }

/** Auteur d'une recherche, s'il peut encore la recevoir : recruteur de la même organisation, compte actif. */
async function loadOwner(ownerId: string, tenantId: string): Promise<Owner | null> {
  const { databases, users } = createAdminClient()
  let profile: Models.Document
  try {
    profile = await databases.getDocument(DB_ID, COLLECTIONS.USERS, ownerId)
  } catch (err) {
    if (codeOf(err) === 404) return null
    throw err
  }
  const userId = str(profile.userId)
  if (profile.role !== 'recruiter' || profile.tenantId !== tenantId || !userId) return null
  try {
    // Compte désactivé par son organisation (ADR 0033) : plus d'e-mail. Adresse non vérifiée : l'inscription est libre,
    // un compte ouvert avec l'adresse d'un tiers lui ferait envoyer par la plateforme le nom de ses recherches et des
    // données de candidats (revue de sécurité du 2026-11-18).
    const auth = await users.get(userId)
    if (auth.status === false || !auth.emailVerification) return null
  } catch (err) {
    if (codeOf(err) === 404) return null
    throw err
  }
  return { profile, userId }
}

async function activeSearches(): Promise<SavedSearch[]> {
  const docs = await listAllDocuments(createAdminClient().databases, DB_ID, COLLECTIONS.SAVED_SEARCHES, [Query.equal('active', true)])
  return docs.map(d => savedSearchOf(d as unknown as Record<string, unknown>))
}

/**
 * Compare un candidat aux recherches actives et prévient leurs auteurs : une alerte par recherche (une seule fois,
 * identifiant fixe), un seul e-mail par recruteur pour toutes ses recherches retenues. `newCv` : le candidat vient de
 * déposer son CV (shouldAlert). `searches` : déjà lues par l'appelant (cron). Ne lève jamais : un échec est journalisé.
 */
export async function alertSavedSearches(candidateProfileId: string, opts: { newCv: boolean; searches?: SavedSearch[]; now?: Date }): Promise<void> {
  if (!isSavedSearchesConfigured()) return
  try {
    const { databases } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.USERS, candidateProfileId, [Query.select([...SEARCHABLE_FIELDS])])
    if (doc.role !== 'candidate' || !str(doc.cvFileId)) return
    const candidate = searchableCandidateOf(doc as unknown as Record<string, unknown>)
    const now = opts.now ?? new Date()
    const matched = (opts.searches ?? await activeSearches()).filter(s => shouldAlert(s, candidate, { newCv: opts.newCv, now }))
    if (matched.length === 0) return

    const byOwner = new Map<string, SavedSearch[]>()
    for (const s of matched) byOwner.set(s.ownerId, [...(byOwner.get(s.ownerId) ?? []), s])
    await mapLimit([...byOwner.values()], 3, async searches => {
      try {
        await alertOwner(searches, doc, now)
      } catch (err) {
        console.error('[recherches] alerte non enregistrée', searches[0].id, message(err))
      }
    })
  } catch (err) {
    if (codeOf(err) === 404) return
    console.error('[recherches] comparaison du candidat aux recherches en échec', message(err))
  }
}

async function alertOwner(searches: SavedSearch[], candidateDoc: Models.Document, now: Date): Promise<void> {
  const ownerId = searches[0].ownerId
  const { databases } = createAdminClient()
  const ids = new Map(searches.filter(s => s.tenantId === searches[0].tenantId).map(s => [searchAlertDocId(s.id, ownerId, candidateDoc.$id), s]))
  // Alertes déjà enregistrées lues d'abord : le cron repasse sur les mêmes candidats toutes les 10 minutes, sans relire
  // le recruteur ni tenter d'écritures vouées au 409.
  const existing = await databases.listDocuments(DB_ID, COLLECTIONS.RECRUITER_ALERTS, [
    Query.equal('$id', [...ids.keys()]), Query.select(['$id']), Query.limit(ids.size),
  ])
  for (const doc of existing.documents) ids.delete(doc.$id)
  if (ids.size === 0) return
  const owner = await loadOwner(ownerId, searches[0].tenantId)
  if (!owner) return
  const created: { id: string; search: SavedSearch }[] = []
  for (const [id, search] of ids) {
    try {
      await databases.createDocument(DB_ID, COLLECTIONS.RECRUITER_ALERTS, id, {
        tenantId: search.tenantId, recipientId: ownerId, source: 'recherche', subjectId: candidateDoc.$id, candidateId: candidateDoc.$id,
        searchId: search.id, emailStatus: search.emailAlerts ? 'pending' : 'off', emailAttempts: 0,
      })
      created.push({ id, search })
    } catch (err) {
      // Déjà prévenu pour ce candidat et cette recherche.
      if (codeOf(err) === 409) continue
      throw err
    }
    await databases.updateDocument(DB_ID, COLLECTIONS.SAVED_SEARCHES, search.id, { lastMatchAt: now.toISOString() })
      .catch(err => console.error('[recherches] date de dernière correspondance non écrite', search.id, message(err)))
  }
  const toEmail = created.filter(c => c.search.emailAlerts)
  if (toEmail.length > 0) await sendSearchEmail(owner, candidateDoc, toEmail.map(c => ({ alertId: c.id, attempts: 0, search: c.search })), now)
}

/** Un e-mail pour ces alertes du même recruteur et du même candidat, puis l'état de chacune. */
async function sendSearchEmail(owner: Owner, candidateDoc: Models.Document, alerts: { alertId: string; attempts: number; search: SavedSearch }[], now: Date) {
  const { databases, messaging } = createAdminClient()
  const candidate = searchableCandidateOf(candidateDoc as unknown as Record<string, unknown>)
  let patch: Record<string, unknown>
  try {
    const mail = savedSearchEmail({
      recipientName: str(owner.profile.firstName),
      candidateName: candidate.name,
      highlights: candidateHighlights(candidate, alerts.map(a => a.search.filters)),
      searches: alerts.map(a => ({ name: a.search.name, filters: a.search.filters })),
      profileUrl: `${origin()}${alertProfilePath('recherche', candidateDoc.$id)}`,
      alertsUrl: `${origin()}/recruiter/alertes`,
    })
    await messaging.createEmail(ID.unique(), mail.subject, wrapEmailHtml(mail.heading, mail.bodyHtml), [], [owner.userId], [], [], [], [], false, true)
    patch = { emailStatus: 'sent', emailedAt: now.toISOString(), emailError: null }
  } catch (err) {
    console.error('[recherches] e-mail au recruteur non envoyé', owner.profile.$id, message(err))
    patch = { emailStatus: 'failed', emailError: message(err).slice(0, 300) }
  }
  await Promise.all(alerts.map(a => databases.updateDocument(DB_ID, COLLECTIONS.RECRUITER_ALERTS, a.alertId, { ...patch, emailAttempts: a.attempts + 1 })
    .catch(err => console.error('[recherches] état de l\'alerte non écrit', a.alertId, message(err)))))
}

// ── Rattrapage (cron) ───────────────────────────────────────────────────────────────────────────────────────────────

const HOUR = 60 * 60 * 1000
/**
 * Candidats modifiés dans cette fenêtre relus à chaque passage (toutes les 10 minutes ; l'identifiant fixe des alertes
 * évite les doublons). 6 h : une coupure du serveur de quelques heures est encore rattrapée.
 */
const SWEEP_WINDOW_MS = 6 * HOUR
const SWEEP_MAX = 500
const RETRY_WINDOW_MS = 48 * HOUR

/**
 * Passage du cron : renvoie les e-mails en échec ou interrompus des 48 dernières heures (isRetryDue), puis compare de
 * nouveau les candidats modifiés depuis 6 h (une comparaison interrompue au dépôt du CV est rattrapée ; un candidat
 * inscrit avant une recherche n'alerte pas ici, `newCv` étant inconnu).
 */
export async function runSavedSearchSweep(now: Date): Promise<{ candidates: number; retried: number }> {
  const { databases } = createAdminClient()
  // E-mails en échec d'abord : un rattrapage long (base qui grossit) ne doit pas les priver de leur nouvel essai.
  const retried = await retryFailedEmails(now)
  const searches = await activeSearches()
  let candidates = 0
  if (searches.length > 0) {
    const recent = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [
      Query.equal('role', 'candidate'), Query.isNotNull('cvFileId'), Query.greaterThan('$updatedAt', new Date(now.getTime() - SWEEP_WINDOW_MS).toISOString()),
      Query.orderDesc('$updatedAt'), Query.select(['$id']), Query.limit(SWEEP_MAX),
    ])
    if (recent.total > SWEEP_MAX) console.warn('[recherches] rattrapage limité aux', SWEEP_MAX, 'candidats les plus récents sur', recent.total)
    candidates = recent.documents.length
    for (const doc of recent.documents) await alertSavedSearches(doc.$id, { newCv: false, searches, now })
  }
  return { candidates, retried }
}

async function retryFailedEmails(now: Date): Promise<number> {
  const { databases } = createAdminClient()
  const docs = await listAllDocuments(databases, DB_ID, COLLECTIONS.RECRUITER_ALERTS, [
    Query.equal('source', 'recherche'), Query.equal('emailStatus', ['failed', 'pending']),
    Query.greaterThan('$createdAt', new Date(now.getTime() - RETRY_WINDOW_MS).toISOString()),
  ])
  const due = docs.filter(d => isRetryDue({
    emailStatus: str(d.emailStatus), emailAttempts: d.emailAttempts, updatedAt: d.$updatedAt,
  }, now))
  const groups = new Map<string, Models.Document[]>()
  for (const d of due) {
    const key = `${str(d.recipientId)}:${str(d.candidateId)}`
    groups.set(key, [...(groups.get(key) ?? []), d])
  }
  let retried = 0
  for (const group of groups.values()) {
    try {
      retried += await retryGroup(group, now)
    } catch (err) {
      console.error('[recherches] nouvel envoi en échec', group[0].$id, message(err))
    }
  }
  return retried
}

async function retryGroup(group: Models.Document[], now: Date): Promise<number> {
  const { databases } = createAdminClient()
  const first = group[0]
  const off = (ids: string[]) => Promise.all(ids.map(id => databases.updateDocument(DB_ID, COLLECTIONS.RECRUITER_ALERTS, id, { emailStatus: 'off' })))
  const owner = await loadOwner(str(first.recipientId), str(first.tenantId))
  let candidateDoc: Models.Document | null = null
  try {
    candidateDoc = await databases.getDocument(DB_ID, COLLECTIONS.USERS, str(first.candidateId), [Query.select([...SEARCHABLE_FIELDS])])
  } catch (err) {
    if (codeOf(err) !== 404) throw err
  }
  // Recruteur parti ou désactivé, candidat supprimé : plus rien à envoyer.
  if (!owner || !candidateDoc || candidateDoc.role !== 'candidate') {
    await off(group.map(d => d.$id))
    return 0
  }
  const searches = await Promise.all(group.map(d => getOwnSavedSearch(str(d.recipientId), str(d.searchId))))
  const sendable = group.flatMap((d, i) => {
    const search = searches[i]
    return search && search.active && search.emailAlerts ? [{ alertId: d.$id, attempts: typeof d.emailAttempts === 'number' ? d.emailAttempts : 0, search }] : []
  })
  await off(group.filter(d => !sendable.some(s => s.alertId === d.$id)).map(d => d.$id))
  if (sendable.length === 0) return 0
  await sendSearchEmail(owner, candidateDoc, sendable, now)
  return sendable.length
}
