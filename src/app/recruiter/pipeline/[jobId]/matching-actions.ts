'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { ID, Query } from 'node-appwrite'
import { getJobMatches, runPoolMatching, type JobMatchResult } from '@/lib/matching-core'
import { createApplication, getJobById, hasApplied } from '@/lib/appwrite/jobs'
import { getStagesForJob, logFunnelEvent } from '@/lib/appwrite/funnel'
import { matchToCarry } from '@/lib/match-scoring'
import { poolRowId } from '@/lib/pool-matching'
import { mapLimit } from '@/lib/concurrency'
import { viewerCanOpenJob } from '@/lib/job-ownership'
import { loadOfferViewer } from '@/lib/offer-viewer'
import { revalidatePath } from 'next/cache'
import { requireRecruiter } from './actions'
import { aiInterviewRecruiter, takeInterviewAiSlot } from '@/lib/interview-access'
import { autoScreenApplication } from '@/lib/screening-core'
import { MAX_WEIGHTED_CANDIDATES, isJobWeightsConfigured, loadWeightsForJob, saveCandidateWeights, saveJobWeights } from '@/lib/scoring-weights-store'
import { ScaleWeightsSchemas, isCandidateWeightsKey } from '@/lib/scoring-weights'
import { isDocumentId } from '@/lib/ao/access'
import { isAutoMatchingEnabled, setMatchReview } from '@/lib/ai-matches-store'
import { REVIEW_STATUSES, type ReviewStatus } from '@/lib/match-review'
import { after } from 'next/server'
import { CriteriaSetSchema, criteriaFingerprint } from '@/lib/offer-criteria'
import { isOfferCriteriaConfigured, loadOfferCriteria, saveOfferCriteria } from '@/lib/offer-criteria-store'
import { isCriteriaJudgementsConfigured } from '@/lib/criteria-judgements-store'
import { judgeOnCriteria, loadCriteriaContext, rescoreGeneral, takeCriteriaJudgeSlot, type JudgeOutcome } from '@/lib/criteria-rescore'
import { needsJudging } from '@/lib/criteria-view'
import { saveOwnCriteria } from '@/lib/scoring-weights-store'
import { readRevisionInput, reviseCriteria, suggestTitles, takeCriteriaChatSlot, type RevisionResult } from '@/lib/criteria-assistant'
import type { Job } from '@/types'

// Server Actions appelables avec n'importe quel identifiant d'offre (publics : liens /jobs/<id>) : l'offre doit être de
// l'organisation du recruteur ou partagée par la plateforme (tenantId ''), comme pour la page. `profileId` : le
// recruteur (users.$id), dont seuls les viviers sont montrés et ajoutés au funnel (un vivier est personnel) ; `userId` :
// son compte, qui porte ses poids personnels (scoring-weights-store.ts).
async function requireJobAccess(jobId: string): Promise<{ tenantId: string; profileId: string; userId: string; ownOffer: boolean; emailVerified: boolean; job: Job }> {
  const user = await requireRecruiter()
  const { tenantId, $id, userId } = user
  const job = await getJobById(jobId)
  // Un membre : ses offres seulement (ADR 0043).
  if (!job || !tenantId || !viewerCanOpenJob(job, await loadOfferViewer(user))) throw new Error('Non autorisé')
  // Offre de l'organisation (et non partagée par la plateforme) : seule à avoir une revue des correspondances (ADR 0047).
  return { tenantId, profileId: $id, userId, ownOffer: job.tenantId === tenantId, emailVerified: !!user.emailVerification, job }
}

/**
 * Liste de la page, scores aux poids du recruteur : ceux du candidat, sinon de l'offre, sinon ses poids globaux ; pour une
 * offre notée sur ses critères (ADR 0061), à ses critères (candidat, sinon offre, sinon ceux de l'offre).
 */
async function matchesFor(jobId: string, access: { tenantId: string; profileId: string; userId: string }): Promise<JobMatchResult[]> {
  const state = await loadWeightsForJob(access.userId, jobId)
  const criteria = await loadCriteriaContext(jobId, state)
  return (await getJobMatches(jobId, access.tenantId, access.profileId, state.weights, state.candidates, criteria ?? undefined)).matches
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

/**
 * Revue d'une correspondance de la base candidats (ADR 0047) : retenu, contacté, écarté, ou de nouveau « nouveau ».
 * Offre ouverte par le recruteur (requireJobAccess), correspondance de cette offre (setMatchReview).
 */
export async function setMatchReviewAction(jobId: string, matchId: unknown, status: unknown): Promise<{ review?: ReviewStatus; error?: string }> {
  const access = await requireJobAccess(jobId)
  const review = REVIEW_STATUSES.find(s => s === status)
  if (!review || typeof matchId !== 'string' || !/^[a-zA-Z0-9]{1,36}$/.test(matchId)) return { error: 'Demande invalide.' }
  if (!isAutoMatchingEnabled()) return { error: 'La revue des correspondances n’est pas encore activée sur la plateforme.' }
  // Offre partagée de la plateforme : ses correspondances sont vues par toutes les organisations ; une revue de l'une
  // s'imposerait aux autres et dirait qui elle retient (revue de sécurité du 2026-11-18).
  if (!access.ownOffer) return { error: 'La revue n’est pas disponible sur une offre partagée de la plateforme.' }
  try {
    if (!await setMatchReview(jobId, matchId, review, access.profileId)) return { error: 'Correspondance introuvable : rechargez la page.' }
    return { review }
  } catch (e) {
    console.error('[matching] revue non enregistrée', jobId, e instanceof Error ? e.message : e)
    return { error: 'Statut non enregistré : réessayez dans quelques instants.' }
  }
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
      // Correspondance de la base mise dans le funnel : retenue (ADR 0047). Sans revue activée, ou en échec : journalisé,
      // la candidature est créée.
      if (sel.source === 'pool' && isAutoMatchingEnabled() && access.ownOffer) {
        await setMatchReview(jobId, poolRowId(jobId, candidateId), 'retenu', access.profileId)
          .catch(e => console.error('[matching] correspondance non marquée retenue', jobId, e instanceof Error ? e.message : e))
      }
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

/**
 * Poids du matching de cette offre pour le recruteur connecté (ADR 0049, colonne de droite du Matching IA) : offre qu'il
 * ouvre (requireJobAccess), enregistrés sur son compte seulement, refusés s'ils ne sont pas valides (un entier par
 * critère du barème, total 100). `weights` null : retire ceux de l'offre, ses poids globaux s'appliquent de nouveau.
 */
export async function saveJobScoringWeightsAction(jobId: unknown, weights: unknown): Promise<{ error?: string }> {
  if (!isDocumentId(jobId)) return { error: 'Demande invalide.' }
  const { userId } = await requireJobAccess(jobId)
  if (!isJobWeightsConfigured()) return { error: 'La pondération par offre n’est pas encore activée sur la plateforme.' }
  const parsed = weights === null ? null : ScaleWeightsSchemas.matching.safeParse(weights)
  if (parsed && !parsed.success) return { error: 'Poids invalides : le total doit faire 100 points, en nombres entiers.' }
  try {
    await saveJobWeights(userId, jobId, parsed ? parsed.data : null)
    return {}
  } catch (e) {
    console.error('[poids] poids de l\'offre non enregistrés', jobId, e instanceof Error ? e.message : e)
    return { error: 'Enregistrement impossible pour le moment : réessayez dans quelques instants.' }
  }
}

/**
 * Le candidat de la clé (candidateWeightsKey) est l'un de ceux que le Matching IA ou le pipeline de l'offre montrent au
 * recruteur : sa candidature à l'offre, sa ligne de la base candidats pour l'offre, ou un CV de son vivier (de l'offre ou
 * général), mêmes règles que la page.
 */
async function candidateOfJob(
  jobId: string, key: string, access: { tenantId: string; profileId: string },
  /** Critères propres (ADR 0061) : un CV du vivier général, noté sur le barème, n'est jamais jugé sur eux. */
  { offerVivierOnly = false }: { offerVivierOnly?: boolean } = {},
): Promise<boolean> {
  const { databases } = createAdminClient()
  const id = key.slice(2)
  const getOrNull = (collection: string) => databases.getDocument(DB_ID, collection, id).catch(err => {
    if ((err as { code?: unknown }).code === 404) return null
    throw err
  })
  if (key.startsWith('a:')) {
    const app = await getOrNull(COLLECTIONS.APPLICATIONS)
    return !!app && app.jobId === jobId && (app.tenantId === access.tenantId || app.tenantId === '')
  }
  if (key.startsWith('v:')) {
    const cv = await getOrNull(COLLECTIONS.VIVIER_CVS)
    return !!cv && cv.tenantId === access.tenantId && cv.recruiterId === access.profileId && (offerVivierOnly ? cv.jobId === jobId : !cv.jobId || cv.jobId === jobId)
  }
  const rows = await databases.listDocuments(DB_ID, COLLECTIONS.JOB_MATCHES, [
    Query.equal('jobId', jobId), Query.equal('candidateId', id), Query.select(['$id']), Query.limit(1),
  ])
  return rows.total > 0
}

/**
 * Poids d'un candidat pour cette offre (ADR 0049, Matching IA et pipeline), pour le barème de son score, au recruteur
 * connecté : offre qu'il ouvre (requireJobAccess), clé d'un candidat que la page lui montre (candidateOfJob : chaque clé
 * crée un document), poids validés, MAX_WEIGHTED_CANDIDATES candidats au plus par offre. `weights` null : retire
 * ceux du candidat pour ce barème, les poids de l'offre s'appliquent de nouveau.
 */
export async function saveCandidateScoringWeightsAction(jobId: unknown, candidate: unknown, scale: unknown, weights: unknown): Promise<{ error?: string }> {
  if (!isDocumentId(jobId) || !isCandidateWeightsKey(candidate) || (scale !== 'matching' && scale !== 'final')) return { error: 'Demande invalide.' }
  const access = await requireJobAccess(jobId)
  if (!isJobWeightsConfigured()) return { error: 'La pondération par candidat n’est pas encore activée sur la plateforme.' }
  const parsed = weights === null ? null : ScaleWeightsSchemas[scale].safeParse(weights)
  if (parsed && !parsed.success) return { error: 'Poids invalides : le total doit faire 100 points, en nombres entiers.' }
  try {
    // Un candidat que la page montre pour cette offre : chaque clé crée un document (revue de sécurité du 2026-11-19).
    if (weights !== null && !await candidateOfJob(jobId, candidate, access)) return { error: 'Candidat introuvable pour cette offre : rechargez la page.' }
    const result = await saveCandidateWeights(access.userId, jobId, candidate, scale, parsed ? parsed.data : null)
    if (result === 'limit') return { error: `Limite de ${MAX_WEIGHTED_CANDIDATES} candidats pondérés pour cette offre : revenez aux poids de l’offre pour un autre candidat.` }
    return {}
  } catch (e) {
    console.error('[poids] poids du candidat non enregistrés', jobId, e instanceof Error ? e.message : e)
    return { error: 'Enregistrement impossible pour le moment : réessayez dans quelques instants.' }
  }
}

// ── Critères de l'offre et critères propres du recruteur (ADR 0061, phase 3) ───────────────────────────────────────

const MATCHING_PATH = (jobId: string) => `/recruiter/pipeline/${jobId}/matching`
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Critères généraux de l'offre, après sa publication : ceux qui peuvent la modifier (« Modifier » : offre de l'organisation,
 * un membre seulement les siennes ; requireJobAccess + ownOffer, comme ownJobOrError). Offre sans critères : les règle
 * pour la première fois. Libellés changés : ses candidats sont renotés en arrière-plan (comme « Rafraîchir ») ; poids ou ★
 * seuls : ses scores enregistrés recalculés tout de suite, sans IA (rescoreGeneral).
 */
export async function saveOfferCriteriaAction(jobId: unknown, input: unknown): Promise<{ error?: string; rescoring?: boolean }> {
  if (!isDocumentId(jobId)) return { error: 'Demande invalide.' }
  const access = await requireJobAccess(jobId)
  if (!access.ownOffer) return { error: 'Les critères d’une offre partagée par la plateforme ne se modifient pas.' }
  if (!isOfferCriteriaConfigured()) return { error: 'Les critères d’offre ne sont pas encore activés sur la plateforme.' }
  const parsed = CriteriaSetSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Critères invalides.' }
  const previous = await loadOfferCriteria(jobId)
  const rescoring = !previous || criteriaFingerprint(previous) !== criteriaFingerprint(parsed.data)
  // Libellés changés : la renotation ne trouve rien dans le cache des notations (autres consignes) et coûte un appel d'IA
  // par candidat ; elle prend donc une place du quota, comme des libellés propres (revue de sécurité du 2026-11-24). Poids
  // ou ★ seuls : gratuit.
  const slot = rescoring ? await takeCriteriaJudgeSlot(access.emailVerified, access.tenantId) : null
  if (slot && 'error' in slot) return { error: slot.error }
  try {
    try {
      await saveOfferCriteria(jobId, parsed.data)
    } catch (e) {
      await slot?.release()
      throw e
    }
    // Renotation par l'IA : après la réponse ; recalcul des seuls poids : quelques écritures, attendues.
    if (rescoring) after(() => rescoreGeneral(jobId, previous, parsed.data))
    else await rescoreGeneral(jobId, previous, parsed.data)
    revalidatePath(MATCHING_PATH(jobId))
    return { rescoring }
  } catch (e) {
    console.error('[critères] critères de l\'offre non enregistrés', jobId, errorText(e))
    return { error: 'Enregistrement impossible pour le moment : réessayez dans quelques instants.' }
  }
}

/**
 * Assistant des critères (ADR 0062) du Matching IA d'une offre de l'organisation : critères modifiés par l'IA selon la
 * demande, sur le texte publié de l'offre ; rien n'est enregistré (chaque panneau enregistre ensuite par sa propre action,
 * avec ses contrôles). Une place du quota du jour, prise après la validation de la demande.
 */
export async function reviseCriteriaAction(jobId: unknown, input: unknown): Promise<RevisionResult> {
  if (!isDocumentId(jobId)) return { error: 'Demande invalide.' }
  const { ownOffer, emailVerified, tenantId, job } = await requireJobAccess(jobId)
  if (!ownOffer) return { error: 'Les critères d’une offre partagée par la plateforme ne se modifient pas.' }
  const read = readRevisionInput(input)
  if ('error' in read) return read
  const refusal = await takeCriteriaChatSlot(emailVerified, tenantId)
  if (refusal) return { error: refusal }
  return reviseCriteria({ title: job.title, description: job.description, skills: job.skills ?? [], location: job.location ?? '', experience: '' }, read.input, jobId)
}

/** Autres intitulés proposés (ADR 0062), comptés sur la base candidats et le vivier personnel du recruteur ; sans IA. */
export async function suggestTitlesAction(jobId: unknown, input: unknown) {
  if (!isDocumentId(jobId)) return { error: 'Demande invalide.' }
  const { tenantId, profileId } = await requireJobAccess(jobId)
  return suggestTitles(input, { kind: 'recruiter', tenantId, ownerId: profileId })
}

/**
 * Enregistre des critères propres du recruteur (`candidate` vide : pour l'offre) et, pour des libellés nouveaux pour lui
 * (needsJudging), fait juger ses candidats en arrière-plan contre une place du quota, rendue si l'enregistrement échoue
 * ou si la notation ne démarre pas.
 */
async function saveOwn(jobId: string, candidate: string, input: unknown): Promise<{ error?: string; judging?: boolean }> {
  const access = await requireJobAccess(jobId)
  // Offre de l'organisation seulement : ses jugements ne sont ainsi jamais partagés avec une autre organisation (une offre
  // partagée par la plateforme n'a d'ailleurs pas de critères).
  if (!access.ownOffer) return { error: 'Les critères propres ne se règlent que sur les offres de votre organisation.' }
  if (!isJobWeightsConfigured()) return { error: 'Les critères propres ne sont pas encore activés sur la plateforme.' }
  const general = await loadOfferCriteria(jobId)
  if (!general) return { error: 'Cette offre n’a pas encore de critères : réglez d’abord ceux de l’offre.' }
  const parsed = input === null ? null : CriteriaSetSchema.safeParse(input)
  if (parsed && !parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Critères invalides.' }
  const set = parsed ? parsed.data : null
  if (set && criteriaFingerprint(set) !== criteriaFingerprint(general) && !isCriteriaJudgementsConfigured()) {
    return { error: 'Vos propres libellés ne sont pas encore activés sur la plateforme : changez seulement les poids et les ★ des critères de l’offre.' }
  }
  if (set && candidate && !await candidateOfJob(jobId, candidate, access, { offerVivierOnly: true })) return { error: 'Candidat introuvable pour cette offre : rechargez la page.' }
  const saved = await loadWeightsForJob(access.userId, jobId)
  const judging = !!set && needsJudging(set, general, candidate ? [saved.candidateCriteria[candidate], saved.criteria] : [saved.criteria])
  const slot = judging ? await takeCriteriaJudgeSlot(access.emailVerified, access.tenantId) : null
  if (slot && 'error' in slot) return { error: slot.error }
  try {
    const result = await saveOwnCriteria(access.userId, jobId, candidate, set)
    if (result === 'limit') {
      await slot?.release()
      return { error: `Limite de ${MAX_WEIGHTED_CANDIDATES} candidats réglés pour cette offre : revenez aux critères de l’offre pour un autre candidat.` }
    }
  } catch (e) {
    await slot?.release()
    throw e
  }
  if (set && slot) {
    after(async () => {
      try {
        const outcome = await judgeOnCriteria(jobId, set, { vivierOwner: access.profileId, ...(candidate ? { only: [candidate] } : {}) })
        // Rien à juger (déjà jugés par un collègue aux mêmes libellés, aucun candidat) : la place n'a pas servi.
        if (outcome.judged + outcome.failed === 0) await slot.release()
      } catch (e) {
        console.error('[critères] notation sur des critères propres en échec', jobId, errorText(e))
        await slot.release()
      }
    })
  }
  revalidatePath(MATCHING_PATH(jobId))
  return { judging }
}

/**
 * Critères propres du recruteur pour l'offre (offre qu'il ouvre), enregistrés sur son compte ; null : ceux de l'offre de
 * nouveau. Libellés nouveaux pour lui : ses candidats (base candidats notés, son vivier de l'offre) jugés en arrière-plan.
 */
export async function saveOwnCriteriaAction(jobId: unknown, input: unknown): Promise<{ error?: string; judging?: boolean }> {
  if (!isDocumentId(jobId)) return { error: 'Demande invalide.' }
  try {
    return await saveOwn(jobId, '', input)
  } catch (e) {
    console.error('[critères] critères propres non enregistrés', jobId, errorText(e))
    return { error: 'Enregistrement impossible pour le moment : réessayez dans quelques instants.' }
  }
}

/**
 * Critères propres du recruteur pour un candidat de l'offre que la page lui montre (candidateOfJob), pas une candidature
 * (notée sur le score final) ; null : ses critères pour l'offre de nouveau. Libellés nouveaux : ce candidat jugé en
 * arrière-plan.
 */
export async function saveCandidateCriteriaAction(jobId: unknown, candidate: unknown, input: unknown): Promise<{ error?: string; judging?: boolean }> {
  if (!isDocumentId(jobId) || !isCandidateWeightsKey(candidate)) return { error: 'Demande invalide.' }
  if (candidate.startsWith('a:')) return { error: 'Une candidature est notée sur le score final : ses critères ne se règlent pas ici.' }
  try {
    return await saveOwn(jobId, candidate, input)
  } catch (e) {
    console.error('[critères] critères du candidat non enregistrés', jobId, errorText(e))
    return { error: 'Enregistrement impossible pour le moment : réessayez dans quelques instants.' }
  }
}

/**
 * « Noter la suite » : candidats encore à juger pour les critères propres du recruteur (JUDGE_MAX par passage, attendu ici :
 * la page montre le résultat). Une place du quota, prise seulement s'il reste quelqu'un à juger.
 */
export async function judgeOwnCriteriaAction(jobId: unknown): Promise<{ error?: string; outcome?: JudgeOutcome }> {
  if (!isDocumentId(jobId)) return { error: 'Demande invalide.' }
  const access = await requireJobAccess(jobId)
  try {
    const context = await loadCriteriaContext(jobId, await loadWeightsForJob(access.userId, jobId))
    if (!context?.own || criteriaFingerprint(context.own) === criteriaFingerprint(context.general)) return { outcome: { judged: 0, failed: 0, remaining: 0 } }
    // Place prise seulement s'il reste quelqu'un à juger (judgeOnCriteria) : elle sert donc toujours.
    const outcome = await judgeOnCriteria(jobId, context.own, { vivierOwner: access.profileId }, async () => {
      const slot = await takeCriteriaJudgeSlot(access.emailVerified, access.tenantId)
      return 'error' in slot ? slot.error : null
    })
    if (outcome.refused) return { error: outcome.refused }
    revalidatePath(MATCHING_PATH(jobId))
    return { outcome }
  } catch (e) {
    console.error('[critères] notation sur les critères propres interrompue', jobId, errorText(e))
    return { error: 'Notation interrompue : réessayez dans quelques instants.' }
  }
}
