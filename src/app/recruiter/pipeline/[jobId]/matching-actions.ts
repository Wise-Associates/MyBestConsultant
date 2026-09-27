'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { ID, Query } from 'node-appwrite'
import { getJobMatches, runPoolMatching, type JobMatchResult } from '@/lib/matching-core'
import { createApplication, hasApplied } from '@/lib/appwrite/jobs'
import { logFunnelEvent } from '@/lib/appwrite/funnel'
import { revalidatePath } from 'next/cache'
import { requireRecruiter } from './actions'
import { autoScreenApplication } from '@/app/recruiter/screening/actions'

export async function getMatchesAction(jobId: string): Promise<JobMatchResult[]> {
  await requireRecruiter()
  const { matches } = await getJobMatches(jobId)
  return matches
}

// Lance (ou relance) le matching d'une candidature précise — par ex. quand l'analyse automatique n'a pas abouti.
// Attend la fin de l'analyse, puis renvoie la liste à jour.
export async function runApplicationMatchingAction(jobId: string, applicationId: string): Promise<{ matches?: JobMatchResult[]; error?: string }> {
  try {
    const user = await requireRecruiter()
    const { databases } = createAdminClient()
    const app = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId)
    if (app.jobId !== jobId || (app.tenantId !== user.tenantId && app.tenantId !== '')) return { error: 'Non autorisé' }
    await autoScreenApplication(applicationId)
    revalidatePath(`/recruiter/pipeline/${jobId}/matching`)
    return { matches: (await getJobMatches(jobId)).matches }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

// Re-run population 1 (platform candidate pool) on demand — covers new candidates who
// registered after the job was created, since that automatic pass only runs once.
export async function refreshPoolMatchingAction(jobId: string): Promise<{ matched?: number; error?: string }> {
  await requireRecruiter()
  const result = await runPoolMatching(jobId)
  revalidatePath(`/recruiter/pipeline/${jobId}/matching`)
  return result
}

// A vivier CV has no platform account — find-or-create one from the info the AI already
// extracted from the CV (name/email), then copy the file into the CVS bucket so the rest
// of the app (candidate profile pages, /api/cv) can read it like any other application.
async function resolveCandidateFromVivier(vivierCvId: string): Promise<{ candidateId?: string; cvFileId?: string; error?: string }> {
  const { databases, users, storage } = createAdminClient()
  const vivierDoc = await databases.getDocument(DB_ID, COLLECTIONS.VIVIER_CVS, vivierCvId)
  const email = ((vivierDoc.candidateEmail as string) ?? '').trim()
  if (!email) return { error: 'CV sans email détecté sur le CV — impossible de lancer un screening' }

  const existingProfile = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [
    Query.equal('email', email), Query.limit(1),
  ])

  if (existingProfile.documents[0]) {
    const profile = existingProfile.documents[0]
    if (profile.cvFileId) return { candidateId: profile.$id, cvFileId: profile.cvFileId as string }

    const bytes = await storage.getFileDownload(BUCKETS.VIVIER_CVS, vivierDoc.cvFileId as string)
    const { InputFile } = await import('node-appwrite/file')
    const file = await storage.createFile(BUCKETS.CVS, ID.unique(), InputFile.fromBuffer(Buffer.from(bytes), (vivierDoc.fileName as string) || 'cv.pdf'))
    await databases.updateDocument(DB_ID, COLLECTIONS.USERS, profile.$id, { cvFileId: file.$id })
    return { candidateId: profile.$id, cvFileId: file.$id }
  }

  const name = (vivierDoc.candidateName as string) || email
  const [firstName, ...rest] = name.split(' ')
  const existingAuth = await users.list([Query.equal('email', [email]), Query.limit(1)])
  const authUser = existingAuth.users[0] ?? await users.create(ID.unique(), email, undefined, undefined, name)

  const bytes = await storage.getFileDownload(BUCKETS.VIVIER_CVS, vivierDoc.cvFileId as string)
  const { InputFile } = await import('node-appwrite/file')
  const file = await storage.createFile(BUCKETS.CVS, ID.unique(), InputFile.fromBuffer(Buffer.from(bytes), (vivierDoc.fileName as string) || 'cv.pdf'))

  const profile = await databases.createDocument(DB_ID, COLLECTIONS.USERS, ID.unique(), {
    userId: authUser.$id,
    role: 'candidate',
    firstName: firstName || name,
    lastName: rest.join(' '),
    email,
    tenantId: null,
    cvFileId: file.$id,
  })

  return { candidateId: profile.$id, cvFileId: file.$id }
}

// "Ajouter dans le funnel" depuis les résultats du Matching — pour les populations 1 et 2
// (pool, vivier) qui n'ont pas encore de candidature, en crée une (sans la screener : elle
// atterrit dans la 1ère colonne du pipeline, non scorée, le recruteur lance le screening
// lui-même depuis la carte). La population 3 (candidature existante) est déjà dans le
// funnel par définition — sélectionnée ici, c'est une erreur qu'on ignore proprement.
export async function addToFunnelAction(
  jobId: string,
  selections: { source: 'pool' | 'vivier' | 'application'; id: string; candidateId?: string }[],
): Promise<{ added: number; errors: string[] }> {
  const user = await requireRecruiter()
  const errors: string[] = []
  let added = 0

  for (const sel of selections) {
    try {
      if (sel.source === 'application') { errors.push('Déjà dans le funnel'); continue }

      let candidateId: string
      let cvFileId: string

      if (sel.source === 'pool') {
        if (!sel.candidateId) { errors.push('Candidat introuvable'); continue }
        candidateId = sel.candidateId
        const { databases } = createAdminClient()
        const profile = await databases.getDocument(DB_ID, COLLECTIONS.USERS, candidateId)
        if (!profile.cvFileId) { errors.push(`${profile.firstName ?? 'Candidat'} n'a pas de CV sur son profil`); continue }
        cvFileId = profile.cvFileId as string

        if (await hasApplied(jobId, candidateId)) { errors.push('Déjà candidat sur cette offre'); continue }
      } else {
        const resolved = await resolveCandidateFromVivier(sel.id)
        if (resolved.error || !resolved.candidateId || !resolved.cvFileId) { errors.push(resolved.error ?? 'Erreur inconnue'); continue }
        candidateId = resolved.candidateId
        cvFileId = resolved.cvFileId
        if (await hasApplied(jobId, candidateId)) { errors.push('Déjà candidat sur cette offre'); continue }
      }

      const application = await createApplication({ jobId, tenantId: user.tenantId!, candidateId, cvFileId })
      await logFunnelEvent(application.$id, application.status, 'stage_change')
      added++
    } catch (e) {
      errors.push(e instanceof Error ? e.message : 'Erreur inconnue')
    }
  }

  revalidatePath(`/recruiter/pipeline/${jobId}`)
  revalidatePath(`/recruiter/pipeline/${jobId}/matching`)
  revalidatePath('/recruiter/dashboard')
  return { added, errors }
}
