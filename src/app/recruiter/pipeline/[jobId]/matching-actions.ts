'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { ID, Query } from 'node-appwrite'
import { getJobMatches, runPoolMatching, type JobMatchResult } from '@/lib/matching-core'
import { createApplication, getJobById, hasApplied } from '@/lib/appwrite/jobs'
import { logFunnelEvent } from '@/lib/appwrite/funnel'
import { recruiterCanOpenJob } from '@/lib/job-ownership'
import { revalidatePath } from 'next/cache'
import { requireRecruiter } from './actions'
import { autoScreenApplication } from '@/app/recruiter/screening/actions'

// Server Actions appelables avec n'importe quel identifiant d'offre (publics : liens /jobs/<id>) : l'offre doit être de
// l'organisation du recruteur ou partagée par la plateforme (tenantId ''), comme pour la page. `profileId` : le
// recruteur (users.$id), dont seuls les viviers sont montrés et ajoutés au funnel (un vivier est personnel).
async function requireJobAccess(jobId: string): Promise<{ tenantId: string; profileId: string }> {
  const { tenantId, $id } = await requireRecruiter()
  const job = await getJobById(jobId)
  if (!job || !tenantId || !recruiterCanOpenJob(job.tenantId, tenantId)) throw new Error('Non autorisé')
  return { tenantId, profileId: $id }
}

export async function getMatchesAction(jobId: string): Promise<JobMatchResult[]> {
  const { tenantId, profileId } = await requireJobAccess(jobId)
  const { matches } = await getJobMatches(jobId, tenantId, profileId)
  return matches
}

// Lance (ou relance) le matching d'une candidature précise — par ex. quand l'analyse automatique n'a pas abouti.
// Attend la fin de l'analyse, puis renvoie la liste à jour.
export async function runApplicationMatchingAction(jobId: string, applicationId: string): Promise<{ matches?: JobMatchResult[]; error?: string }> {
  try {
    const { tenantId, profileId } = await requireJobAccess(jobId)
    const { databases } = createAdminClient()
    const app = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId)
    if (app.jobId !== jobId || (app.tenantId !== tenantId && app.tenantId !== '')) return { error: 'Non autorisé' }
    await autoScreenApplication(applicationId)
    revalidatePath(`/recruiter/pipeline/${jobId}/matching`)
    return { matches: (await getJobMatches(jobId, tenantId, profileId)).matches }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

// Population 1 (platform candidate pool) on demand : « Rafraîchir » du Matching IA appelle 'all' (refait les scores
// déjà calculés) puis 'new' (note seulement les candidats pas encore notés pour l'offre), une requête chacun.
export async function refreshPoolMatchingAction(jobId: string, mode: unknown = 'new'): Promise<{ matched?: number; error?: string }> {
  await requireJobAccess(jobId)
  if (mode !== 'new' && mode !== 'all') return { error: 'Demande invalide.' }
  const result = await runPoolMatching(jobId, undefined, mode)
  revalidatePath(`/recruiter/pipeline/${jobId}/matching`)
  return result
}

// A vivier CV has no platform account — find-or-create one from the info the AI already
// extracted from the CV (name/email), then copy the file into the CVS bucket so the rest
// of the app (candidate profile pages, /api/cv) can read it like any other application.
// Seuls les CV que la page montre : du recruteur lui-même (un vivier est personnel), au vivier de cette offre ou au
// vivier général.
async function resolveCandidateFromVivier(
  vivierCvId: string, owner: { tenantId: string; profileId: string }, jobId: string,
): Promise<{ candidateId?: string; cvFileId?: string; error?: string }> {
  const { databases, users, storage } = createAdminClient()
  const vivierDoc = await databases.getDocument(DB_ID, COLLECTIONS.VIVIER_CVS, vivierCvId).catch(err => {
    if ((err as { code?: unknown }).code === 404) return null
    throw err
  })
  if (!vivierDoc || vivierDoc.tenantId !== owner.tenantId || vivierDoc.recruiterId !== owner.profileId || (vivierDoc.jobId && vivierDoc.jobId !== jobId)) {
    return { error: 'CV introuvable' }
  }
  // Profil ajouté depuis MBC Search : aucun fichier CV à joindre à la candidature.
  if (!vivierDoc.cvFileId) return { error: 'Profil sans CV (ajouté depuis MBC Search) : importez son CV dans le vivier pour l’ajouter au funnel.' }
  const email = ((vivierDoc.candidateEmail as string) ?? '').trim()
  if (!email) return { error: 'CV sans email détecté sur le CV — impossible de lancer un screening' }

  const existingProfile = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [
    Query.equal('email', email), Query.limit(1),
  ])

  // L'adresse est lue dans le CV, que celui qui l'importe écrit : elle ne doit jamais donner accès au compte d'un autre.
  // Seul un profil de candidat est repris, sans rien y écrire ; le CV joint à la candidature est alors celui du vivier.
  const copyVivierFile = async () => {
    const bytes = await storage.getFileDownload(BUCKETS.VIVIER_CVS, vivierDoc.cvFileId as string)
    const { InputFile } = await import('node-appwrite/file')
    return storage.createFile(BUCKETS.CVS, ID.unique(), InputFile.fromBuffer(Buffer.from(bytes), (vivierDoc.fileName as string) || 'cv.pdf'))
  }
  if (existingProfile.documents[0]) {
    const profile = existingProfile.documents[0]
    if (profile.role !== 'candidate') return { error: 'Cette adresse appartient à un compte qui n’est pas un candidat : ajout impossible.' }
    return { candidateId: profile.$id, cvFileId: (await copyVivierFile()).$id }
  }

  const name = (vivierDoc.candidateName as string) || email
  const [firstName, ...rest] = name.split(' ')
  // Compte de connexion sans profil (inscription inachevée, ou compte d'un autre espace) : jamais rattaché à ce CV.
  const existingAuth = await users.list([Query.equal('email', [email]), Query.limit(1)])
  if (existingAuth.users[0]) return { error: 'Cette adresse a déjà un compte sur la plateforme : invitez la personne à postuler.' }
  const authUser = await users.create(ID.unique(), email, undefined, undefined, name)

  const file = await copyVivierFile()

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
  const access = await requireJobAccess(jobId)
  const { tenantId } = access
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
        // Identifiant envoyé par le navigateur : seulement un candidat que la base candidats a proposé pour cette offre,
        // vérifié avant tout message qui le nomme.
        const proposed = await databases.listDocuments(DB_ID, COLLECTIONS.JOB_MATCHES, [
          Query.equal('jobId', jobId), Query.equal('candidateId', candidateId), Query.limit(1), Query.select(['$id']),
        ])
        const profile = proposed.total > 0
          ? await databases.getDocument(DB_ID, COLLECTIONS.USERS, candidateId).catch(err => { if ((err as { code?: unknown }).code === 404) return null; throw err })
          : null
        if (!profile || profile.role !== 'candidate') { errors.push('Candidat introuvable'); continue }
        if (!profile.cvFileId) { errors.push(`${profile.firstName ?? 'Candidat'} n'a pas de CV sur son profil`); continue }
        cvFileId = profile.cvFileId as string

        if (await hasApplied(jobId, candidateId)) { errors.push('Déjà candidat sur cette offre'); continue }
      } else {
        const resolved = await resolveCandidateFromVivier(sel.id, access, jobId)
        if (resolved.error || !resolved.candidateId || !resolved.cvFileId) { errors.push(resolved.error ?? 'Erreur inconnue'); continue }
        candidateId = resolved.candidateId
        cvFileId = resolved.cvFileId
        if (await hasApplied(jobId, candidateId)) { errors.push('Déjà candidat sur cette offre'); continue }
      }

      const application = await createApplication({ jobId, tenantId, candidateId, cvFileId })
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
