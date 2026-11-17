'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { ID, Query } from 'node-appwrite'
import { getJobMatches, runPoolMatching, type JobMatchResult } from '@/lib/matching-core'
import { createApplication, getJobById, hasApplied } from '@/lib/appwrite/jobs'
import { getStagesForJob, logFunnelEvent } from '@/lib/appwrite/funnel'
import { matchToCarry } from '@/lib/match-scoring'
import { mapLimit } from '@/lib/concurrency'
import { viewerCanOpenJob } from '@/lib/job-ownership'
import { loadOfferViewer } from '@/lib/offer-viewer'
import { revalidatePath } from 'next/cache'
import { requireRecruiter } from './actions'
import { aiInterviewRecruiter, takeInterviewAiSlot } from '@/lib/interview-access'
import { autoScreenApplication } from '@/lib/screening-core'
import { loadRecruiterWeights } from '@/lib/scoring-weights-store'

// Server Actions appelables avec n'importe quel identifiant d'offre (publics : liens /jobs/<id>) : l'offre doit être de
// l'organisation du recruteur ou partagée par la plateforme (tenantId ''), comme pour la page. `profileId` : le
// recruteur (users.$id), dont seuls les viviers sont montrés et ajoutés au funnel (un vivier est personnel) ; `userId` :
// son compte, qui porte ses poids personnels (scoring-weights-store.ts).
async function requireJobAccess(jobId: string): Promise<{ tenantId: string; profileId: string; userId: string }> {
  const user = await requireRecruiter()
  const { tenantId, $id, userId } = user
  const job = await getJobById(jobId)
  // Un membre : ses offres seulement (ADR 0043).
  if (!job || !tenantId || !viewerCanOpenJob(job, await loadOfferViewer(user))) throw new Error('Non autorisé')
  return { tenantId, profileId: $id, userId }
}

/** Liste de la page, scores aux poids du recruteur. */
async function matchesFor(jobId: string, access: { tenantId: string; profileId: string; userId: string }): Promise<JobMatchResult[]> {
  const { weights } = await loadRecruiterWeights(access.userId)
  return (await getJobMatches(jobId, access.tenantId, access.profileId, weights)).matches
}

export async function getMatchesAction(jobId: string): Promise<JobMatchResult[]> {
  return matchesFor(jobId, await requireJobAccess(jobId))
}

// Lance (ou relance) le matching d'une candidature précise — par ex. quand l'analyse automatique n'a pas abouti.
// Attend la fin de l'analyse, puis renvoie la liste à jour.
export async function runApplicationMatchingAction(jobId: string, applicationId: string): Promise<{ matches?: JobMatchResult[]; error?: string }> {
  try {
    const access = await requireJobAccess(jobId)
    const { tenantId } = access
    const { databases } = createAdminClient()
    const app = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId)
    if (app.jobId !== jobId || (app.tenantId !== tenantId && app.tenantId !== '')) return { error: 'Non autorisé' }
    // Relance à la demande : comptée comme un screening manuel (formule, adresse vérifiée, quota du jour de l'IA).
    const me = await aiInterviewRecruiter()
    if ('error' in me) return { error: me.error }
    const refused = await takeInterviewAiSlot(me)
    if (refused) return { error: refused }
    const { error } = await autoScreenApplication(applicationId)
    revalidatePath(`/recruiter/pipeline/${jobId}/matching`)
    return { matches: await matchesFor(jobId, access), error }
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
// (pool, vivier) qui n'ont pas encore de candidature, en crée une, puis calcule son score final (ADR 0036, choix de
// l'utilisateur du 2026-11-15 : le screening note sur l'AO, le matching ne fait que trier les CV disponibles ; avant,
// ADR 0029, la candidature reprenait le score du Matching IA). La population 3 (candidature existante) est déjà dans le
// funnel par définition — sélectionnée ici, c'est une erreur qu'on ignore proprement.
export async function addToFunnelAction(
  jobId: string,
  selections: { source: 'pool' | 'vivier' | 'application'; id: string; candidateId?: string }[],
): Promise<{ added: number; errors: string[] }> {
  const access = await requireJobAccess(jobId)
  const { tenantId } = access
  const errors: string[] = []
  let added = 0
  // Scores du Matching IA tels que la page les affiche, notés dans l'historique de la candidature à côté du score final.
  let shown: JobMatchResult[] = []
  let screeningStage: string | undefined
  try {
    shown = await matchesFor(jobId, access)
    const { stages } = await getStagesForJob(tenantId, jobId)
    screeningStage = stages.find(st => st.autoAction === 'screening')?.slug ?? stages.find(st => st.slug === 'screening')?.slug
  } catch (e) {
    console.error('[matching] scores du Matching IA ou phases non lus', jobId, e instanceof Error ? e.message : e)
    errors.push('Scores du Matching IA non lus : ils ne figureront pas dans l\'historique des candidats ajoutés')
  }
  const created: AddedCandidate[] = []

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
      created.push({ applicationId: application.$id, matchingScore: matchToCarry(shown, sel, candidateId)?.score ?? null })
    } catch (e) {
      errors.push(e instanceof Error ? e.message : 'Erreur inconnue')
    }
  }
  if (created.length > 0) errors.push(...await scoreAddedCandidates(created, screeningStage))

  revalidatePath(`/recruiter/pipeline/${jobId}`)
  revalidatePath(`/recruiter/pipeline/${jobId}/matching`)
  revalidatePath('/recruiter/dashboard')
  return { added, errors }
}

interface AddedCandidate {
  applicationId: string
  /** Score affiché par le Matching IA (null : non noté). */
  matchingScore: number | null
}

/** Scores finals calculés en même temps : un appel d'IA chacun, dans les 300 s de la page (maxDuration). */
const FINAL_SCORING_CONCURRENCY = 5

/**
 * Score final des candidats ajoutés au funnel (ADR 0036) : un appel d'IA chacun, compté comme un screening manuel
 * (formule avec entretiens IA, adresse vérifiée, place du jour), sans e-mail au candidat (il n'a pas postulé). Candidat
 * noté : carte en phase « screening », score final et score du Matching IA dans l'historique. Sinon il reste sans
 * score dans la 1re colonne ; le message dit pourquoi (« Relancer » sur le Matching IA). Messages sans doublon.
 */
async function scoreAddedCandidates(added: AddedCandidate[], stage: string | undefined): Promise<string[]> {
  const me = await aiInterviewRecruiter()
  if ('error' in me) return [`Score final non calculé : ${me.error}`]
  const errors = new Set<string>()
  await mapLimit(added, FINAL_SCORING_CONCURRENCY, async ({ applicationId, matchingScore }) => {
    const refused = await takeInterviewAiSlot(me).catch(e => {
      console.error('[matching] quota du screening illisible', applicationId, e instanceof Error ? e.message : e)
      return 'quota du jour illisible, réessayez avec « Relancer » sur le Matching IA'
    })
    if (refused) { errors.add(`Score final non calculé : ${refused}`); return }
    const { error, score } = await autoScreenApplication(applicationId, { notify: false })
    if (error || score === undefined) { errors.add(`Score final non calculé : ${error ?? 'réponse inattendue'}`); return }
    try {
      if (stage) await createAdminClient().databases.updateDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId, { status: stage })
    } catch (e) {
      console.error('[matching] candidat noté laissé hors de la phase screening', applicationId, e instanceof Error ? e.message : e)
      errors.add('Score final calculé, mais une carte n\'a pas pu passer en phase « screening » : déplacez-la dans le pipeline')
    }
    const matching = matchingScore !== null ? ` · Matching IA : ${matchingScore}/100` : ''
    await logFunnelEvent(applicationId, stage ?? 'screening', 'screening', `Score final : ${score}/100${matching}`)
  })
  return [...errors]
}
