'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { ID, Query } from 'node-appwrite'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getOpenJobsOfTenant } from '@/lib/appwrite/jobs'
import { releaseDailySlot, takeDailySlotId } from '@/lib/ao/state'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { CvProfile, CvExperience, CvEducation, CvLanguage } from '@/lib/cv-profile-extract'
import { CvExportError, loadOwnVivierCv } from '@/lib/cv-export/export'
import {
  cvExportErrorName, deleteCvExportsForCandidate, isCvExportStorageConfigured, loadCvExportVersions, type CvExportVersions,
} from '@/lib/cv-export/store'
import { vivierExportKey } from '@/lib/cv-export/stored'
import { getEsnTemplateInfo } from '@/lib/cv-export/templates'
import type { UserProfile } from '@/types'
import {
  VIVIER_MATCHING_DAILY_LIMITS, VIVIER_MATCHING_REFUSAL, matchingOffers, mergeOfferScores, offersToCompare, parseOfferScores,
  serializeOfferScores, type OfferScore, type ProfileToScore,
} from '@/lib/vivier-matching'

export interface VivierCv {
  $id: string
  /** null : vivier général (CV importé sans choisir d'offre, comparé aux offres ouvertes de l'organisation). */
  jobId: string | null
  recruiterId: string
  cvFileId: string
  fileName: string
  candidateName: string
  candidateEmail: string
  candidatePhone: string
  /** Intitulé le plus récent trouvé sur le CV (dernière expérience). */
  title: string
  skills: string[]
  experienceSummary: string
  experiences: CvExperience[]
  education: CvEducation[]
  languages: CvLanguage[]
  yearsOfExperience: number | null
  /** Score du Matching IA par rapport à l'offre (null tant qu'il n'est pas calculé). */
  matchScore: number | null
  matchReason: string
  /** Vivier général : scores du CV pour les offres déjà comparées ([] pour le vivier d'une offre). */
  offerScores: OfferScore[]
  /** false = le profil n'a pas pu être créé à partir du CV (fichier illisible, IA indisponible) : bouton « Analyser à nouveau ». */
  profileReady: boolean
  createdAt: string
}

// Nom d'affichage de secours : le nom du fichier sans extension (« CV_Jean_Dupont.pdf » → « CV Jean Dupont »).
const nameFromFile = (fileName: string) => fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()

function docToVivierCv(d: Record<string, unknown> & { $id: string; $createdAt: string }): VivierCv {
  let profile: Partial<CvProfile> = {}
  try { profile = d.cvProfileJson ? JSON.parse(d.cvProfileJson as string) : {} } catch { /* profil illisible : traité comme absent */ }
  const name = ((d.candidateName as string) || profile.candidateName || '').trim()
  const skills = profile.skills ?? []
  return {
    $id: d.$id,
    jobId: (d.jobId as string | null) ?? null,
    recruiterId: d.recruiterId as string,
    cvFileId: d.cvFileId as string,
    fileName: (d.fileName as string) ?? '',
    candidateName: name || nameFromFile((d.fileName as string) ?? ''),
    candidateEmail: ((d.candidateEmail as string) || profile.candidateEmail) ?? '',
    candidatePhone: ((d.candidatePhone as string) || profile.candidatePhone) ?? '',
    title: profile.experiences?.[0]?.title ?? '',
    skills,
    experienceSummary: profile.experienceSummary ?? '',
    experiences: profile.experiences ?? [],
    education: profile.education ?? [],
    languages: profile.languages ?? [],
    yearsOfExperience: profile.yearsOfExperience ?? null,
    matchScore: typeof d.matchScore === 'number' ? d.matchScore : null,
    matchReason: (d.matchReason as string) ?? '',
    offerScores: parseOfferScores(d.offerMatchesJson as string | null),
    profileReady: !!(name || skills.length || profile.experienceSummary),
    createdAt: d.$createdAt,
  }
}

/** Refus dont le message, en français, est montré tel quel au recruteur (les autres erreurs sont journalisées). */
class Refusal extends Error {}

const isNotFound = (err: unknown) => (err as { code?: unknown } | null)?.code === 404

// Vivier d'une offre : sa page est relue. Vivier général : la page tient sa liste dans son état et la met à jour
// elle-même ; la relire (jusqu'à 500 CV) à chaque CV importé ou synchronisé serait du travail perdu.
function revalidateVivier(jobId: string | null) {
  if (jobId !== null) revalidatePath(`/recruiter/vivier/${jobId}`)
}

/** Recruteur (ou admin) d'une organisation ; pour le vivier d'une offre, offre de cette organisation (sinon « introuvable »). */
async function requireVivierAccess(jobId: string | null) {
  const user = await getCurrentUser()
  if (!user || (user.role !== 'recruiter' && user.role !== 'admin') || !user.tenantId) throw new Refusal('Non autorisé')
  if (jobId !== null) {
    const { databases } = createAdminClient()
    const job = await databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId).catch(err => { if (isNotFound(err)) return null; throw err })
    if (!job || job.tenantId !== user.tenantId) throw new Refusal('Offre introuvable')
  }
  return { user, tenantId: user.tenantId }
}

/**
 * CV de ce vivier (`jobId` null : vivier général) importé par l'appelant, ou par un recruteur de son organisation pour
 * un admin. Celui d'un autre est « introuvable », comme un CV qui n'existe pas.
 */
async function ownVivierDoc(user: UserProfile, tenantId: string, jobId: string | null, docId: string) {
  const { databases } = createAdminClient()
  const doc = await databases.getDocument(DB_ID, COLLECTIONS.VIVIER_CVS, docId).catch(err => { if (isNotFound(err)) return null; throw err })
  if (!doc || doc.tenantId !== tenantId || ((doc.jobId as string | null) ?? null) !== jobId || (user.role !== 'admin' && doc.recruiterId !== user.$id)) {
    throw new Refusal('CV introuvable')
  }
  return doc
}

const attachInput = z.object({
  jobId: z.string().min(1).max(36).nullable(),
  fileId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/),
  fileName: z.string().min(1).max(255),
})

// Le navigateur envoie le fichier au bucket sans session Appwrite : il n'a pas de propriétaire. Seul un fichier tout
// juste envoyé et rattaché à aucun CV est accepté ; sinon l'identifiant du CV d'un autre (lu ailleurs) suffirait à en
// obtenir le profil, puis à supprimer le fichier avec « Supprimer ».
const UPLOAD_MAX_AGE_MS = 15 * 60_000

async function assertFreshUpload(fileId: string): Promise<void> {
  const { storage, databases } = createAdminClient()
  const file = await storage.getFile(BUCKETS.VIVIER_CVS, fileId).catch(err => { if (isNotFound(err)) return null; throw err })
  const attached = file ? (await databases.listDocuments(DB_ID, COLLECTIONS.VIVIER_CVS, [Query.equal('cvFileId', fileId), Query.limit(1)])).total > 0 : false
  if (!file || attached || Date.now() - new Date(file.$createdAt).getTime() > UPLOAD_MAX_AGE_MS) {
    throw new Refusal('Fichier introuvable : envoyez le CV à nouveau.')
  }
}

// Le vivier de CV d'un recruteur reste privé — un recruteur ne voit que les CV qu'il a
// lui-même importés sur cette offre, sauf un compte admin qui voit tout le vivier du
// tenant (demande explicite du CR : "visibles uniquement par lui — sauf admin").
export async function getVivierForJob(jobId: string): Promise<{ cvs: VivierCv[]; error?: string }> {
  try {
    const { user } = await requireVivierAccess(jobId)
    const { databases } = createAdminClient()
    const queries = [Query.equal('jobId', jobId), Query.orderDesc('$createdAt'), Query.limit(200)]
    if (user.role !== 'admin') queries.push(Query.equal('recruiterId', user.$id))
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.VIVIER_CVS, queries)

    const cvs: VivierCv[] = res.documents.map(d => docToVivierCv(d as never))
    return { cvs }
  } catch (e) {
    return { cvs: [], error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

/** Vivier général : CV importés sans offre, privés comme ceux d'une offre ; les 500 plus récents (`total` : tous). */
export async function getGeneralVivier(): Promise<{ cvs: VivierCv[]; total: number; error?: string }> {
  try {
    const { user, tenantId } = await requireVivierAccess(null)
    const { databases } = createAdminClient()
    const queries = [Query.equal('tenantId', tenantId), Query.isNull('jobId'), Query.orderDesc('$createdAt'), Query.limit(500)]
    if (user.role !== 'admin') queries.push(Query.equal('recruiterId', user.$id))
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.VIVIER_CVS, queries)
    return { cvs: res.documents.map(d => docToVivierCv(d as never)), total: res.total }
  } catch (e) {
    return { cvs: [], total: 0, error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

// Appelée juste après l'upload direct-navigateur du fichier vers le bucket VIVIER_CVS — enregistre la référence en
// base, crée le profil puis lance le Matching IA (best-effort, ne doit jamais faire échouer l'import). `jobId` null :
// vivier général, CV comparé aux offres ouvertes ; `notice` dit alors pourquoi il ne l'a pas été.
export async function attachVivierCv(jobIdInput: string | null, fileIdInput: string, fileNameInput: string): Promise<{ id?: string; cv?: VivierCv; notice?: string; error?: string }> {
  try {
    const input = attachInput.safeParse({ jobId: jobIdInput, fileId: fileIdInput, fileName: fileNameInput })
    if (!input.success) throw new Refusal('Import impossible : fichier non reconnu.')
    const { jobId, fileId, fileName } = input.data
    const { user, tenantId } = await requireVivierAccess(jobId)
    await assertFreshUpload(fileId)
    const { databases } = createAdminClient()
    const doc = await databases.createDocument(DB_ID, COLLECTIONS.VIVIER_CVS, ID.unique(), {
      tenantId,
      recruiterId: user.$id,
      jobId,
      cvFileId: fileId,
      fileName,
    })

    // Profil créé automatiquement à partir du CV (identité, compétences, expériences…) puis Matching IA.
    const profile = await buildProfile(doc.$id, fileId)
    const notice = profile ? await matchProfile(user, tenantId, jobId, doc.$id, profile) : null

    revalidateVivier(jobId)
    const fresh = await databases.getDocument(DB_ID, COLLECTIONS.VIVIER_CVS, doc.$id)
    return { id: doc.$id, cv: docToVivierCv(fresh as never), notice: notice ?? undefined }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'import' }
  }
}

/** Extraction du profil, best-effort : un CV reste importé et consultable même si l'analyse échoue (null). */
async function buildProfile(docId: string, fileId: string): Promise<CvProfile | null> {
  try {
    const { databases } = createAdminClient()
    const { extractCvProfile } = await import('@/lib/cv-profile-extract')
    const profile = await extractCvProfile(fileId, BUCKETS.VIVIER_CVS)
    if (!profile) return null
    await databases.updateDocument(DB_ID, COLLECTIONS.VIVIER_CVS, docId, {
      cvProfileJson: JSON.stringify(profile),
      candidateName: profile.candidateName ?? '',
      candidateEmail: profile.candidateEmail ?? '',
      candidatePhone: profile.candidatePhone ?? '',
    })
    return profile
  } catch {
    return null
  }
}

/**
 * Matching IA du CV, best-effort comme l'analyse : sur l'offre de son vivier, ou sur les offres ouvertes (vivier
 * général : raison d'un refus ou d'un échec, le CV restant à comparer par « Synchroniser »).
 */
async function matchProfile(user: UserProfile, tenantId: string, jobId: string | null, docId: string, profile: CvProfile): Promise<string | null> {
  if (jobId !== null) {
    const { matchVivierCvAgainstJob } = await import('@/lib/matching-core')
    await matchVivierCvAgainstJob(jobId, docId, profile).catch(() => undefined)
    return null
  }
  try {
    return await compareWithNewOffers(user, tenantId, docId, profile)
  } catch (e) {
    console.error('Vivier : comparaison aux offres après l\'analyse du CV en échec :', e instanceof Error ? e.message : e)
    return VIVIER_MATCHING_REFUSAL.failed
  }
}

/**
 * Vivier général : compare le CV aux offres ouvertes qu'il n'a pas encore rencontrées et enregistre les scores.
 * null : comparé, ou aucune offre nouvelle ; sinon la raison, affichée au recruteur.
 */
async function compareWithNewOffers(user: UserProfile, tenantId: string, docId: string, profile: ProfileToScore): Promise<string | null> {
  const { databases } = createAdminClient()
  const [offers, doc] = await Promise.all([getOpenJobsOfTenant(tenantId), databases.getDocument(DB_ID, COLLECTIONS.VIVIER_CVS, docId)])
  const toCompare = offersToCompare(parseOfferScores(doc.offerMatchesJson as string | null), offers)
  if (toCompare.length === 0) return null

  const refusal = await matchingSlot(user, tenantId)
  if (refusal) return refusal
  const { scoreCvAgainstOffers } = await import('@/lib/matching-core')
  const { scores, failed } = await scoreCvAgainstOffers(profile, toCompare.map(j => ({
    $id: j.$id, title: j.title ?? '', skills: j.skills, location: j.location ?? '', description: j.description ?? '',
  })))

  // Relu juste avant l'écriture : une autre comparaison du même CV a pu se terminer pendant l'appel à l'IA.
  const latest = await databases.getDocument(DB_ID, COLLECTIONS.VIVIER_CVS, docId)
  const openIds = new Set(offers.map(o => o.$id))
  const merged = mergeOfferScores(parseOfferScores(latest.offerMatchesJson as string | null), scores, openIds)
  await databases.updateDocument(DB_ID, COLLECTIONS.VIVIER_CVS, docId, { offerMatchesJson: serializeOfferScores(merged) })
  if (!failed) return null
  return matchingOffers(merged, openIds).length > 0 ? VIVIER_MATCHING_REFUSAL.partial : VIVIER_MATCHING_REFUSAL.failed
}

/**
 * Avant chaque comparaison d'un CV aux offres : adresse e-mail vérifiée, puis une place sur les quotas du jour
 * (organisation, puis toutes). Une comparaison qui échoue compte quand même (l'IA a pu être facturée).
 */
async function matchingSlot(user: UserProfile, tenantId: string): Promise<string | null> {
  if (!user.emailVerification) return VIVIER_MATCHING_REFUSAL.unverified
  const now = new Date()
  const own = await takeDailySlotId('vivierMatchOrg', tenantId, now, VIVIER_MATCHING_DAILY_LIMITS.perOrganisation)
  if (!own) return VIVIER_MATCHING_REFUSAL.organisation
  if (!(await takeDailySlotId('vivierMatchAll', 'platform', now, VIVIER_MATCHING_DAILY_LIMITS.allOrganisations))) {
    console.warn('Vivier : plafond quotidien des comparaisons CV / offres atteint pour toutes les organisations')
    // La place de l'organisation n'a pas servi : rendue, pour ne pas compter un refus de la plateforme contre elle.
    await releaseDailySlot(own)
    return VIVIER_MATCHING_REFUSAL.platform
  }
  return null
}

/**
 * « Synchroniser » (fenêtre des CV sans offre correspondante, vivier général) : compare un CV aux offres ouvertes
 * publiées depuis sa dernière comparaison. Appelée CV par CV par la fenêtre ; `error` : raison d'un refus ou d'un
 * échec, `cv` toujours renvoyé quand il a pu être relu (une partie des offres a pu être comparée).
 */
export async function syncVivierCvMatching(docId: string): Promise<{ cv?: VivierCv; error?: string }> {
  try {
    const { user, tenantId } = await requireVivierAccess(null)
    const before = docToVivierCv((await ownVivierDoc(user, tenantId, null, docId)) as never)
    if (!before.profileReady) return { error: 'Le profil de ce CV n’a pas pu être créé : relancez son analyse depuis sa fiche.' }
    const refusal = await compareWithNewOffers(user, tenantId, docId, before)
    const { databases } = createAdminClient()
    return { cv: docToVivierCv((await databases.getDocument(DB_ID, COLLECTIONS.VIVIER_CVS, docId)) as never), error: refusal ?? undefined }
  } catch (e) {
    if (e instanceof Refusal) return { error: e.message }
    console.error(`Vivier : synchronisation du CV ${docId} en échec :`, e instanceof Error ? e.message : e)
    return { error: VIVIER_MATCHING_REFUSAL.failed }
  }
}

// « Analyser à nouveau » : relance la création du profil pour un CV dont l'analyse a échoué.
export async function reanalyseVivierCv(jobId: string | null, docId: string): Promise<{ cv?: VivierCv; notice?: string; error?: string }> {
  try {
    const { user, tenantId } = await requireVivierAccess(jobId)
    const { databases } = createAdminClient()
    const doc = await ownVivierDoc(user, tenantId, jobId, docId)
    // Seulement pour un CV dont l'analyse a échoué (bouton affiché dans ce cas) : chaque analyse est un appel à l'IA.
    if (docToVivierCv(doc as never).profileReady) return { error: 'Le profil de ce CV est déjà créé.' }
    const profile = await buildProfile(docId, doc.cvFileId as string)
    if (!profile) return { error: 'Le CV n’a pas pu être analysé (fichier illisible ou service IA indisponible). Réessayez dans un instant.' }
    const notice = await matchProfile(user, tenantId, jobId, docId, profile)
    revalidateVivier(jobId)
    return { cv: docToVivierCv((await databases.getDocument(DB_ID, COLLECTIONS.VIVIER_CVS, docId)) as never), notice: notice ?? undefined }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'analyse' }
  }
}

export async function deleteVivierCv(jobId: string | null, docId: string): Promise<{ error?: string }> {
  try {
    const { user, tenantId } = await requireVivierAccess(jobId)
    const { databases, storage } = createAdminClient()
    const doc = await ownVivierDoc(user, tenantId, jobId, docId)

    // Ses versions « Format ESN » partent avant lui (données personnelles, ADR 0016) : si elles restent, le CV aussi.
    const exportKey = vivierExportKey(docId)
    if (exportKey && isCvExportStorageConfigured()) {
      try {
        await deleteCvExportsForCandidate(exportKey)
      } catch (err) {
        console.error('[vivier] versions « Format ESN » non supprimées, CV gardé', docId, cvExportErrorName(err))
        throw new Refusal('Suppression impossible pour le moment (versions « CV format cabinet » de ce CV) : réessayez dans quelques instants.')
      }
    }

    // Fichier rattaché à un autre CV (possible avant la vérification d'assertFreshUpload) : gardé pour celui-ci.
    const sharing = await databases.listDocuments(DB_ID, COLLECTIONS.VIVIER_CVS, [Query.equal('cvFileId', doc.cvFileId as string), Query.limit(2)])
    if (sharing.total <= 1) await storage.deleteFile(BUCKETS.VIVIER_CVS, doc.cvFileId as string).catch(() => {})
    await databases.deleteDocument(DB_ID, COLLECTIONS.VIVIER_CVS, docId)
    // Second passage, comme pour un compte supprimé : une génération qui enregistrait pendant la suppression a pu
    // écrire après le premier (saveCvExports ne revérifie le CV qu'après son écriture). Le CV est déjà supprimé : un
    // échec ici est journalisé, la version restante est à supprimer à la main.
    if (exportKey && isCvExportStorageConfigured()) {
      await deleteCvExportsForCandidate(exportKey).catch(err =>
        console.error('[vivier] second passage « Format ESN » en échec, versions à supprimer à la main', exportKey, cvExportErrorName(err)))
    }
    revalidateVivier(jobId)
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de la suppression' }
  }
}

/**
 * Versions « Format ESN » d'un CV de son vivier, pour la fenêtre d'export (ADR 0016) : seul le recruteur qui l'a
 * importé les voit, comme le CV lui-même (organisation et compte de la session).
 */
export async function getVivierCvExportVersions(cvId: string): Promise<CvExportVersions> {
  const storage = isCvExportStorageConfigured()
  const user = await getCurrentUser()
  // Message rendu plutôt que levé : une erreur levée par une action serveur est masquée en production.
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { versions: [], storage, error: 'Session expirée : rechargez la page et reconnectez-vous.' }
  const key = vivierExportKey(cvId)
  if (!key) return { versions: [], storage, error: 'CV introuvable.' }
  let cvFileId: string
  try {
    cvFileId = (await loadOwnVivierCv(cvId, { tenantId: user.tenantId, userId: user.$id })).cvFileId
  } catch (err) {
    if (err instanceof CvExportError) return { versions: [], storage, error: err.message }
    console.error('[vivier] CV illisible pour les versions « Format ESN »', cvId, cvExportErrorName(err))
    return { versions: [], storage, error: 'Versions illisibles pour le moment : rechargez la page dans quelques instants.' }
  }
  let templateUploadedAt = ''
  try {
    templateUploadedAt = (await getEsnTemplateInfo(user.tenantId))?.uploadedAt ?? ''
  } catch (err) {
    // Sans la date du modèle, une version antérieure à son remplacement n'est simplement pas signalée.
    console.error('[cv-export] date du modèle illisible', user.tenantId, cvExportErrorName(err))
  }
  // Fichier du CV du vivier : une version tirée d'un autre fichier est signalée comme ancienne.
  return loadCvExportVersions(user.tenantId, key, templateUploadedAt, cvFileId)
}
