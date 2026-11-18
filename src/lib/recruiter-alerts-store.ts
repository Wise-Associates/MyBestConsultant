import 'server-only'
import { AppwriteException, ID, Query, type Models } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { listAllByValues } from '@/lib/appwrite/list-all'
import { mapLimit } from '@/lib/concurrency'
import { viewerCanOpenJob } from '@/lib/job-ownership'
import { loadOfferViewer } from '@/lib/offer-viewer'
import { wrapEmailHtml } from '@/lib/email-template'
import {
  alertDocId, alertEmailsEnabled, alertProfilePath, alertSubjectKey, idealCandidateEmail, isIdealScore, parseAlertEmailStatus,
  parseAlertSource, type AlertEmailStatus, type AlertSource, type IdealCandidate,
} from '@/lib/recruiter-alerts'
import type { UserProfile } from '@/types'

// Alertes « profil idéal » (ADR 0045) : enregistrement, e-mail au recruteur, lecture pour la page « Alertes » et
// préférence d'envoi. Appelé par les notations (screening-core, matching-core, actions du vivier et du screening),
// jamais depuis le navigateur : aucune vérification d'appelant ici. Une alerte ne fait jamais échouer une notation.

export const isRecruiterAlertsConfigured = () => !!COLLECTIONS.RECRUITER_ALERTS

/** Préférence gardée dans le compte Appwrite du recruteur, comme ses poids (scoring-weights-store.ts). */
const PREF_KEY = 'alertEmails'

const origin = () => process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
const isMissing = (err: unknown) => err instanceof AppwriteException && err.code === 404
const isConflict = (err: unknown) => (err as { code?: unknown } | null)?.code === 409
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const fullName = (doc: Models.Document | null) => (doc ? `${str(doc.firstName)} ${str(doc.lastName)}`.trim() : '')

async function getOrNull(collection: string, id: string): Promise<Models.Document | null> {
  try {
    return await createAdminClient().databases.getDocument(DB_ID, collection, id)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let hit = cache.get(key)
  if (!hit) {
    hit = load()
    cache.set(key, hit)
  }
  return hit
}

/**
 * Prévient le recruteur de chaque candidat noté IDEAL_SCORE ou plus : une alerte enregistrée, puis un e-mail s'il ne les
 * a pas coupés. Une seule fois par offre, recruteur et personne (identifiant fixe : une seconde notation n'envoie rien).
 * Recruteur : `recipientId` (vivier : celui qui a importé le CV), sinon le recruteur affecté à l'offre, sinon son
 * auteur ; seulement un recruteur de l'organisation de l'offre qui peut l'ouvrir (viewerCanOpenJob, ADR 0043 : un membre,
 * les offres qui lui sont affectées ; offre partagée de la plateforme : personne). Ne lève jamais : un échec est journalisé.
 */
export async function alertIdealCandidates(candidates: IdealCandidate[]): Promise<void> {
  const ideal = candidates.filter(c => isIdealScore(c.score) && c.jobId && c.subjectId)
  if (ideal.length === 0) return
  if (!isRecruiterAlertsConfigured()) {
    console.warn('[alertes] collection non configurée : aucune alerte pour', ideal.length, 'profil(s) idéal(aux)')
    return
  }
  const jobs = new Map<string, Promise<Models.Document | null>>()
  const people = new Map<string, Promise<Models.Document | null>>()
  await mapLimit(ideal, 3, async candidate => {
    try {
      await alertOne(candidate, jobs, people)
    } catch (err) {
      console.error('[alertes] alerte non enregistrée', candidate.jobId, candidate.source, err instanceof Error ? err.message : err)
    }
  })
}

async function alertOne(
  candidate: IdealCandidate, jobs: Map<string, Promise<Models.Document | null>>, people: Map<string, Promise<Models.Document | null>>,
): Promise<void> {
  const job = await cached(jobs, candidate.jobId, () => getOrNull(COLLECTIONS.JOBS, candidate.jobId))
  const tenantId = str(job?.tenantId)
  if (!job || !tenantId) return
  const recipientId = candidate.recipientId || str(job.recruiterId) || str(job.postedBy)
  if (!recipientId) return
  const recipient = await cached(people, recipientId, () => getOrNull(COLLECTIONS.USERS, recipientId))
  if (!recipient) {
    console.warn('[alertes] recruteur à prévenir introuvable', candidate.jobId, recipientId)
    return
  }
  // Admin de la plateforme (AO de la plateforme), compte d'une autre organisation : pas d'alerte.
  if (recipient.role !== 'recruiter' || recipient.tenantId !== tenantId || !str(recipient.userId)) return
  // Un membre qui a importé dans son vivier général un CV proche d'une offre d'un collègue n'apprend pas son intitulé.
  const viewer = await loadOfferViewer({ $id: recipient.$id, userId: str(recipient.userId), tenantId })
  if (!viewerCanOpenJob({ tenantId, recruiterId: job.recruiterId }, viewer)) return

  const { databases, users, messaging } = createAdminClient()
  const id = alertDocId(candidate.jobId, recipientId, alertSubjectKey(candidate))
  try {
    await databases.createDocument(DB_ID, COLLECTIONS.RECRUITER_ALERTS, id, {
      tenantId, recipientId, jobId: candidate.jobId, source: candidate.source, subjectId: candidate.subjectId,
      candidateId: candidate.candidateId ?? (candidate.source === 'base' ? candidate.subjectId : null),
      score: Math.round(candidate.score), emailStatus: 'pending' satisfies AlertEmailStatus,
    })
  } catch (err) {
    // Déjà prévenu pour cette personne et cette offre.
    if (isConflict(err)) return
    throw err
  }

  const setStatus = (emailStatus: AlertEmailStatus) => databases.updateDocument(DB_ID, COLLECTIONS.RECRUITER_ALERTS, id, { emailStatus })
  const recipientUserId = str(recipient.userId)
  let enabled: boolean
  try {
    // Adresse non vérifiée : pas d'e-mail (inscription libre : un compte ouvert avec l'adresse d'un tiers lui ferait
    // envoyer des données de candidats ; revue de sécurité du 2026-11-18). L'alerte reste dans la page.
    const [auth, prefs] = await Promise.all([users.get(recipientUserId), users.getPrefs(recipientUserId)])
    enabled = auth.emailVerification === true && alertEmailsEnabled((prefs as Record<string, unknown>)[PREF_KEY])
  } catch (err) {
    // Sans la préférence, on n'écrit pas : le recruteur a peut-être coupé ses alertes. L'alerte reste dans la page.
    console.error('[alertes] préférences du recruteur illisibles : e-mail non envoyé', recipientId, err instanceof Error ? err.message : err)
    await setStatus('failed')
    return
  }
  if (!enabled) {
    await setStatus('off')
    return
  }
  try {
    const mail = idealCandidateEmail({
      recipientName: str(recipient.firstName),
      candidateName: await candidateName(candidate),
      jobTitle: str(job.title),
      score: candidate.score,
      source: candidate.source,
      profileUrl: `${origin()}${alertProfilePath(candidate.source, candidate.subjectId)}`,
      alertsUrl: `${origin()}/recruiter/alertes`,
    })
    await messaging.createEmail(ID.unique(), mail.subject, wrapEmailHtml(mail.heading, mail.bodyHtml), [], [recipientUserId], [], [], [], [], false, true)
  } catch (err) {
    console.error('[alertes] e-mail au recruteur non envoyé', recipientId, err instanceof Error ? err.message : err)
    await setStatus('failed')
    return
  }
  await setStatus('sent')
}

/** Nom affiché dans l'e-mail ; '' si la personne n'est plus lisible (l'e-mail dit « Un candidat »). */
async function candidateName(candidate: IdealCandidate): Promise<string> {
  if (candidate.source === 'vivier') {
    const cv = await getOrNull(COLLECTIONS.VIVIER_CVS, candidate.subjectId)
    return str(cv?.candidateName)
  }
  const profileId = candidate.source === 'base' ? candidate.subjectId : candidate.candidateId
  return profileId ? fullName(await getOrNull(COLLECTIONS.USERS, profileId)) : ''
}

export interface AlertRow {
  id: string
  createdAt: string
  source: AlertSource
  /** null : alerte d'une recherche enregistrée (filtres, sans score). */
  score: number | null
  emailStatus: AlertEmailStatus
  /** null : offre supprimée (`jobGone`) ou que le recruteur n'ouvre plus ; alerte d'une recherche enregistrée. */
  jobTitle: string | null
  jobGone: boolean
  /** Alerte d'une recherche enregistrée : son nom ; null si elle a été supprimée. */
  searchName: string | null
  /** null : la personne n'existe plus (compte supprimé, CV retiré). */
  candidateName: string | null
  profileHref: string | null
  matchingHref: string
}

/** Nombre d'alertes affichées : les plus récentes. */
export const ALERTS_SHOWN = 100

/**
 * Alertes du recruteur connecté, les plus récentes d'abord, avec le nom de la personne et l'intitulé de l'offre relus
 * maintenant (rien de personnel n'est copié dans l'alerte). Offre : seulement si elle l'ouvre encore (réaffectée depuis :
 * « Offre non accessible ») ; CV du vivier : seulement ceux qu'il a importés.
 */
export async function listRecruiterAlerts(user: Pick<UserProfile, '$id' | 'userId' | 'tenantId'>): Promise<AlertRow[]> {
  const profileId = user.$id
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.RECRUITER_ALERTS, [
    Query.equal('recipientId', profileId), Query.orderDesc('$createdAt'), Query.limit(ALERTS_SHOWN),
  ])
  const alerts = res.documents.flatMap(doc => {
    const source = parseAlertSource(doc.source)
    return source ? [{ doc, source }] : []
  })
  const ids = (pick: (a: (typeof alerts)[number]) => string) => alerts.map(pick).filter(Boolean)
  const searchIds = ids(a => (a.source === 'recherche' ? str(a.doc.searchId) : ''))
  const [jobs, candidates, cvs, searches] = await Promise.all([
    listAllByValues(databases, DB_ID, COLLECTIONS.JOBS, '$id', ids(a => str(a.doc.jobId)), [Query.select(['$id', 'title', 'tenantId', 'recruiterId'])]),
    listAllByValues(databases, DB_ID, COLLECTIONS.USERS, '$id', ids(a => (a.source === 'vivier' ? '' : str(a.doc.candidateId))),
      [Query.select(['$id', 'firstName', 'lastName', 'role'])]),
    listAllByValues(databases, DB_ID, COLLECTIONS.VIVIER_CVS, '$id', ids(a => (a.source === 'vivier' ? str(a.doc.subjectId) : '')),
      [Query.select(['$id', 'candidateName', 'fileName', 'recruiterId'])]),
    COLLECTIONS.SAVED_SEARCHES && searchIds.length > 0
      ? listAllByValues(databases, DB_ID, COLLECTIONS.SAVED_SEARCHES, '$id', searchIds, [Query.select(['$id', 'name', 'ownerId'])])
      : Promise.resolve([]),
  ])
  const searchName = new Map(searches.filter(s => s.ownerId === profileId).map(s => [s.$id, str(s.name) || 'Sans nom']))
  const viewer = await loadOfferViewer(user)
  const jobTitle = new Map(jobs.map(j => [j.$id, viewerCanOpenJob({ tenantId: j.tenantId, recruiterId: j.recruiterId }, viewer) ? str(j.title) || 'Sans intitulé' : null]))
  const personName = new Map(candidates.filter(u => u.role === 'candidate').map(u => [u.$id, fullName(u) || 'Candidat']))
  const cvName = new Map(cvs.filter(cv => cv.recruiterId === profileId).map(cv => [cv.$id, str(cv.candidateName) || str(cv.fileName) || 'CV importé']))

  return alerts.map(({ doc, source }) => {
    const subjectId = str(doc.subjectId)
    const name = source === 'vivier' ? cvName.get(subjectId) : personName.get(str(doc.candidateId))
    return {
      id: doc.$id,
      createdAt: doc.$createdAt,
      source,
      score: typeof doc.score === 'number' ? doc.score : null,
      emailStatus: parseAlertEmailStatus(doc.emailStatus),
      jobTitle: jobTitle.get(str(doc.jobId)) ?? null,
      jobGone: !jobTitle.has(str(doc.jobId)),
      searchName: source === 'recherche' ? searchName.get(str(doc.searchId)) ?? null : null,
      candidateName: name ?? null,
      profileHref: name ? alertProfilePath(source, subjectId) : null,
      matchingHref: `/recruiter/pipeline/${str(doc.jobId)}/matching`,
    }
  })
}

/** E-mails d'alerte activés pour ce compte Auth ; préférences illisibles : `unreadable` (journalisé). */
export async function loadAlertEmails(authUserId: string): Promise<{ enabled: boolean; unreadable: boolean }> {
  try {
    const prefs = await createAdminClient().users.getPrefs(authUserId) as Record<string, unknown>
    return { enabled: alertEmailsEnabled(prefs[PREF_KEY]), unreadable: false }
  } catch (err) {
    console.error('[alertes] préférences du recruteur non lues', err instanceof Error ? err.message : err)
    return { enabled: true, unreadable: true }
  }
}

/** Active ou coupe les e-mails d'alerte ; les autres préférences (poids, invitation) sont relues et gardées. */
export async function saveAlertEmails(authUserId: string, enabled: boolean): Promise<void> {
  const { users } = createAdminClient()
  const prefs = await users.getPrefs(authUserId) as Record<string, unknown>
  await users.updatePrefs(authUserId, { ...prefs, [PREF_KEY]: enabled })
}
