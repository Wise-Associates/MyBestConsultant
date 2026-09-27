'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { ID, Query } from 'node-appwrite'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { revalidatePath } from 'next/cache'
import type { CvProfile, CvExperience, CvEducation, CvLanguage } from '@/lib/cv-profile-extract'

export interface VivierCv {
  $id: string
  jobId: string
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
    jobId: d.jobId as string,
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
    profileReady: !!(name || skills.length || profile.experienceSummary),
    createdAt: d.$createdAt,
  }
}

async function requireRecruiterForJob(jobId: string) {
  const user = await getCurrentUser()
  if (!user || (user.role !== 'recruiter' && user.role !== 'admin') || !user.tenantId) throw new Error('Non autorisé')
  const { databases } = createAdminClient()
  const job = await databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId)
  if (job.tenantId !== user.tenantId) throw new Error('Non autorisé')
  return { user, job }
}

// Le vivier de CV d'un recruteur reste privé — un recruteur ne voit que les CV qu'il a
// lui-même importés sur cette offre, sauf un compte admin qui voit tout le vivier du
// tenant (demande explicite du CR : "visibles uniquement par lui — sauf admin").
export async function getVivierForJob(jobId: string): Promise<{ cvs: VivierCv[]; error?: string }> {
  try {
    const { user } = await requireRecruiterForJob(jobId)
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

// Appelée juste après l'upload direct-navigateur du fichier vers le bucket VIVIER_CVS —
// enregistre la référence en base puis lance l'extraction IA en tâche de fond (best-effort,
// ne doit jamais faire échouer l'import si l'extraction rate).
export async function attachVivierCv(jobId: string, fileId: string, fileName: string): Promise<{ id?: string; cv?: VivierCv; error?: string }> {
  try {
    const { user } = await requireRecruiterForJob(jobId)
    const { databases } = createAdminClient()
    const doc = await databases.createDocument(DB_ID, COLLECTIONS.VIVIER_CVS, ID.unique(), {
      tenantId: user.tenantId,
      recruiterId: user.$id,
      jobId,
      cvFileId: fileId,
      fileName,
    })

    // Profil créé automatiquement à partir du CV (identité, compétences, expériences…) puis Matching IA sur l'offre.
    await buildProfile(jobId, doc.$id, fileId)

    revalidatePath(`/recruiter/vivier/${jobId}`)
    const fresh = await databases.getDocument(DB_ID, COLLECTIONS.VIVIER_CVS, doc.$id)
    return { id: doc.$id, cv: docToVivierCv(fresh as never) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'import' }
  }
}

/** Extraction du profil + matching, best-effort : un CV reste importé et consultable même si l'analyse échoue. */
async function buildProfile(jobId: string, docId: string, fileId: string): Promise<boolean> {
  try {
    const { databases } = createAdminClient()
    const { extractCvProfile } = await import('@/lib/cv-profile-extract')
    const profile = await extractCvProfile(fileId, BUCKETS.VIVIER_CVS)
    if (!profile) return false
    await databases.updateDocument(DB_ID, COLLECTIONS.VIVIER_CVS, docId, {
      cvProfileJson: JSON.stringify(profile),
      candidateName: profile.candidateName ?? '',
      candidateEmail: profile.candidateEmail ?? '',
      candidatePhone: profile.candidatePhone ?? '',
    })
    const { matchVivierCvAgainstJob } = await import('@/lib/matching-core')
    await matchVivierCvAgainstJob(jobId, docId, profile).catch(() => undefined)
    return true
  } catch {
    return false
  }
}

// « Analyser à nouveau » : relance la création du profil pour un CV dont l'analyse a échoué.
export async function reanalyseVivierCv(jobId: string, docId: string): Promise<{ cv?: VivierCv; error?: string }> {
  try {
    const { user } = await requireRecruiterForJob(jobId)
    const { databases } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.VIVIER_CVS, docId)
    if (doc.jobId !== jobId || (user.role !== 'admin' && doc.recruiterId !== user.$id)) throw new Error('Non autorisé')
    const ok = await buildProfile(jobId, docId, doc.cvFileId as string)
    if (!ok) return { error: 'Le CV n’a pas pu être analysé (fichier illisible ou service IA indisponible). Réessayez dans un instant.' }
    revalidatePath(`/recruiter/vivier/${jobId}`)
    return { cv: docToVivierCv((await databases.getDocument(DB_ID, COLLECTIONS.VIVIER_CVS, docId)) as never) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'analyse' }
  }
}

export async function deleteVivierCv(jobId: string, docId: string): Promise<{ error?: string }> {
  try {
    const { user } = await requireRecruiterForJob(jobId)
    const { databases, storage } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.VIVIER_CVS, docId)
    if (user.role !== 'admin' && doc.recruiterId !== user.$id) throw new Error('Non autorisé')

    await storage.deleteFile(BUCKETS.VIVIER_CVS, doc.cvFileId as string).catch(() => {})
    await databases.deleteDocument(DB_ID, COLLECTIONS.VIVIER_CVS, docId)
    revalidatePath(`/recruiter/vivier/${jobId}`)
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de la suppression' }
  }
}
