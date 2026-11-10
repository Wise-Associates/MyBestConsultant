// Core "Matching IA" logic — shared by the automatic trigger fired on job creation
// (population 1: platform's candidate database) and the vivier upload flow (population 2:
// CVs the recruiter picked for this job). Not 'use server' on purpose, same reasoning as
// sourcing-core.ts: everything exported from a 'use server' file becomes a remotely-callable
// action, and these skip auth checks since they're called from trusted server contexts only.
import { displayEmail } from '@/lib/candidate-identity'
import { callLLM } from '@/lib/ai/llm-router'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import type { CvProfile } from '@/lib/cv-profile-extract'
import {
  VIVIER_MATCHING_SYSTEM, offerBatches, parseVivierMatching, profileForAi, vivierMatchingPrompt, vivierScore,
  type OfferScore, type OfferToScore, type ProfileToScore,
} from '@/lib/vivier-matching'
import { expertiseBoost, withRecommendationBonus } from '@/lib/recommendation-boost'
import { listAllByValues, listAllDocuments } from '@/lib/appwrite/list-all'
import { listVivierOfferMatches } from '@/lib/appwrite/vivier-offer-matches'
import { planPoolRows, poolRowId } from '@/lib/pool-matching'
import { withCheckedTitles } from '@/lib/title-check'
import { SCORING_AI, cvScorer, readCvForScoring, type MatchResult } from '@/lib/sourcing-core'

export interface JobMatchResult {
  source: 'pool' | 'vivier' | 'application'
  id: string                // job_matches doc id (pool), vivier_cvs doc id, or applications doc id
  candidateId?: string      // set for 'pool' + 'application' — an existing platform candidate
  applicationId?: string    // set for 'application' — links to the existing candidate profile page
  name: string
  email: string
  score: number | null      // null only possible for 'application' if auto-screening hasn't run yet
  reason: string
  cvFileId?: string
  cvBucket?: 'cvs' | 'vivier'
  // true once this candidate already has an Application for this job — for 'application'
  // rows this is always true (that's what they are); for 'pool'/'vivier' it means someone
  // already clicked "Ajouter dans le funnel" for them, so the Matching page greys them out.
  alreadyInFunnel: boolean
  /** Candidature reçue / CV importé au vivier (ISO). Absent pour la base candidats (pas de réception). */
  receivedAt?: string
  /** Date du matching (score attribué), ISO ; null = pas encore fait (candidature en attente d'analyse). */
  matchedAt?: string | null
  /** Renseigné quand la candidature est une proposition d'un chasseur de têtes. */
  hunterName?: string
  /** Source 'vivier' : prénom et nom du recruteur qui a importé le CV (absent s'il n'a plus de profil). */
  vivierOwner?: string
  /** Points ajoutés au score grâce aux recommandations reçues sur des expertises demandées par l'offre. */
  recommendation?: { points: number; matched: { expertise: string; count: number }[] }
}

/**
 * 'new' note seulement les candidats de la base pas encore notés pour l'offre et les ajoute aux autres, dont les scores
 * ne bougent pas (2026-11-04 : chaque clic recalculait tout, et tous les scores changeaient) ; 'all' recalcule les
 * candidats déjà notés (« Recalculer » d'un AO publié), ou note les plus récents s'il n'y en a aucun. « Rafraîchir »
 * du Matching IA fait 'all' puis 'new' (matching-client.tsx).
 */
export type PoolMatchingMode = 'new' | 'all'

/** Candidats renotés au plus par le mode 'all' : un appel d'IA chacun, 5 à la fois, dans les 300 s de la page. */
const RESCORE_MAX = 120

// Population 1 — scores the platform candidate pool against this job and stores the results (job_matches). Runs
// automatically right after a job is created; the recruiter can also trigger it again later from the Matching page.
// `computed`: a ranking already made for this job by matchCandidatesForJob (automatic sourcing at
// creation), stored as is instead of paying a second AI call on the same CVs.
export async function runPoolMatching(
  jobId: string, computed?: MatchResult, mode: PoolMatchingMode = 'all',
): Promise<{ matched: number; error?: string }> {
  try {
    const { databases } = createAdminClient()
    const job = await databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId)
    const existing = await listAllDocuments(databases, DB_ID, COLLECTIONS.JOB_MATCHES, [
      Query.equal('jobId', jobId), Query.select(['$id', 'candidateId']),
    ])

    const { matchCandidatesForJob } = await import('@/lib/sourcing-core')
    const scored = [...new Set(existing.map(d => d.candidateId as string))]
    // Périmètre : candidats dont ce passage a la charge, les seuls dont une note peut être retirée (planPoolRows).
    let result: MatchResult
    let scope: Set<string>
    if (computed) {
      result = computed
      scope = new Set(scored)
    } else if (mode === 'new') {
      result = await matchCandidatesForJob(jobId, { exclude: new Set(scored) })
      scope = new Set()
    } else if (scored.length > 0) {
      const only = scored.slice(0, RESCORE_MAX)
      result = await matchCandidatesForJob(jobId, { only })
      scope = new Set(only)
    } else {
      result = await matchCandidatesForJob(jobId)
      scope = new Set()
    }
    const { matches, error } = result
    // Aucun CV noté (IA indisponible…) : les notes d'avant restent telles quelles.
    if (matches.length === 0) return { matched: 0, error }

    const considered = new Set(result.considered ?? matches.map(m => m.candidateId))
    const plan = planPoolRows(existing.map(d => ({ id: d.$id, candidateId: d.candidateId as string })), matches, scope, considered)
    const fields = (m: { score: number; reason: string }) => ({ score: m.score, reason: m.reason.slice(0, 1000) })
    await Promise.all([
      ...plan.update.map(([id, m]) => databases.updateDocument(DB_ID, COLLECTIONS.JOB_MATCHES, id, fields(m))),
      ...plan.create.map(async m => {
        const id = poolRowId(jobId, m.candidateId)
        const data = { tenantId: job.tenantId as string, jobId, candidateId: m.candidateId, ...fields(m) }
        try {
          await databases.createDocument(DB_ID, COLLECTIONS.JOB_MATCHES, id, data)
        } catch (err) {
          // Écrite entre-temps par un autre passage (même identifiant) : la note de celui-ci, plus récente, l'emporte.
          if ((err as { code?: unknown }).code !== 409) throw err
          await databases.updateDocument(DB_ID, COLLECTIONS.JOB_MATCHES, id, fields(m))
        }
      }),
      ...plan.remove.map(id => databases.deleteDocument(DB_ID, COLLECTIONS.JOB_MATCHES, id).catch(err => {
        if ((err as { code?: unknown }).code !== 404) throw err
      })),
    ])

    // Une partie des CV non notés (IA indisponible, réponse illisible) : dit, les autres sont enregistrés.
    return { matched: matches.length, error }
  } catch (e) {
    return { matched: 0, error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

/**
 * Texte d'un CV du vivier tel que la notation le lit (ADR 0029) : le fichier, comme pour une candidature et la base
 * candidats (readCvForScoring) ; le profil extrait seulement s'il n'y a pas de fichier (profil ajouté depuis MBC Search)
 * ou si le fichier n'a pas de texte (PDF scanné, lu par l'IA à l'import). '' : rien à noter. Fichier illisible
 * (stockage injoignable, fichier abîmé) : lève — le CV n'est pas noté sur un autre texte que le sien.
 */
export async function vivierCvText(cvFileId: string | null | undefined, profile: ProfileToScore | null): Promise<string> {
  const fromFile = cvFileId ? await readCvForScoring(cvFileId, BUCKETS.VIVIER_CVS) : ''
  return fromFile || (profile ? profileForAi(profile) : '')
}

// Population 2 — scores a single vivier CV against a job right after it's uploaded, with the scoring used for
// applications and the candidate database (cvScorer, ADR 0029).
export async function matchVivierCvAgainstJob(jobId: string, vivierCvId: string, profile: CvProfile): Promise<void> {
  try {
    const { databases } = createAdminClient()
    const [job, doc] = await Promise.all([
      databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId),
      databases.getDocument(DB_ID, COLLECTIONS.VIVIER_CVS, vivierCvId),
    ])
    const cvText = await vivierCvText(doc.cvFileId as string | undefined, profile)
    if (!cvText) {
      console.error('[matching] CV du vivier de l\'offre sans texte à noter', jobId, vivierCvId)
      return
    }
    const scored = await cvScorer({
      title: String(job.title ?? ''), skills: (job.skills as string[]) ?? [], description: String(job.description ?? ''),
    })(cvText)
    // Réponse sans jugement : CV non noté (jamais un score inventé).
    if (!scored) {
      console.error('[matching] réponse de l\'IA sans jugement lisible pour un CV du vivier de l\'offre', jobId, vivierCvId)
      return
    }
    await databases.updateDocument(DB_ID, COLLECTIONS.VIVIER_CVS, vivierCvId, {
      matchScore: scored.score,
      matchReason: scored.reason.slice(0, 500),
    })
  } catch (e) {
    // best-effort — a vivier CV stays usable (unscored) even if matching fails
    console.error('[matching] CV du vivier de l\'offre non noté', jobId, vivierCvId, e instanceof Error ? e.message : e)
  }
}

/**
 * Vivier général : note un CV de 0 à 100 pour chacune des `offers`, par lots envoyés en parallèle, avec le modèle de
 * toute notation (SCORING_AI) et le texte du CV (`cvText` : vivierCvText). Un lot en échec laisse ses offres non comparées
 * (elles le seront à la synchronisation suivante) et donne `failed`, détaillé dans les journaux seulement.
 */
export async function scoreCvAgainstOffers(cvText: string, offers: OfferToScore[]): Promise<{ scores: OfferScore[]; failed: boolean }> {
  const batches = await Promise.all(offerBatches(offers).map(async batch => {
    try {
      const { content } = await callLLM([{ role: 'user', content: vivierMatchingPrompt(cvText, batch) }], VIVIER_MATCHING_SYSTEM, {
        // 5 offres, une preuve par élément jugé de chacune : réponse plus longue qu'une note par offre.
        ...SCORING_AI, maxTokens: 8000, timeoutMs: 120_000,
      })
      const judged = parseVivierMatching(content, batch, cvText)
      if (!judged) {
        console.error('Vivier : réponse de l\'IA illisible pour la comparaison CV / offres')
        return null
      }
      // Métiers du titre de chaque offre confirmés par une seule comparaison des intitulés (title-check.ts).
      const checked = await withCheckedTitles(judged.map(j => j.judgements))
      return judged.map((item, i) => vivierScore({ ...item, judgements: checked[i] }))
    } catch (e) {
      console.error('Vivier : comparaison CV / offres en échec :', e instanceof Error ? e.message : e)
      return null
    }
  }))
  return { scores: batches.flatMap(b => b ?? []), failed: batches.some(b => b === null) }
}

// Champs d'un CV du vivier lus par la page : ni le profil ni les scores enregistrés, jusqu'à 20 000 caractères chacun.
const VIVIER_FIELDS = ['$id', '$createdAt', '$updatedAt', 'tenantId', 'jobId', 'recruiterId', 'candidateName', 'fileName', 'candidateEmail', 'cvFileId', 'matchScore', 'matchReason']

// Combined, ranked results for the Matching page — 3 populations: job_matches (pool,
// candidates who haven't applied), vivier_cvs (CVs of `vivierOwner` in this job's vivier, or in their general vivier
// when the CV corresponds to this job: rows of vivier_offer_matches, ADR 0026), and applications
// (candidates who actually applied — scored by the automatic matching that runs on every new application, incl.
// profiles proposed by headhunters). Every list is read in full, page by page: a capped read silently dropped people.
// `tenantId` = the caller's organisation: a job shared by the platform has the viviers of every organisation.
// `vivierOwner` = profile (users.$id) of the recruiter whose viviers are shown — a vivier is personal, no colleague sees
// it (decision of 2026-11-03) — or null for all of the organisation's (platform admin, as on the vivier page).
export async function getJobMatches(
  jobId: string, tenantId: string, vivierOwner: string | null,
): Promise<{ matches: JobMatchResult[]; poolComputedAt: string | null }> {
  const { databases } = createAdminClient()
  const jobDoc = await databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId).catch(err => {
    if ((err as { code?: unknown }).code === 404) return null
    throw err
  })
  // Offre partagée par la plateforme : chaque organisation y ajoute ses candidats (« Ajouter dans le funnel ») ; seules
  // les siennes et les candidatures directes à l'offre (tenantId '') sont montrées, jamais celles d'une autre.
  const appQueries = [Query.equal('jobId', jobId), ...(jobDoc?.tenantId === '' ? [Query.equal('tenantId', [tenantId, ''])] : [])]
  const ownVivier = [Query.equal('tenantId', tenantId), ...(vivierOwner ? [Query.equal('recruiterId', vivierOwner)] : [])]

  const [poolDocs, vivierDocs, generalRows, appDocs] = await Promise.all([
    listAllDocuments(databases, DB_ID, COLLECTIONS.JOB_MATCHES, [Query.equal('jobId', jobId), Query.orderDesc('score')]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.VIVIER_CVS, [Query.equal('jobId', jobId), ...ownVivier, Query.select(VIVIER_FIELDS)]),
    listVivierOfferMatches(jobId, tenantId),
    listAllDocuments(databases, DB_ID, COLLECTIONS.APPLICATIONS, appQueries),
  ])
  // Organisation, recruteur et vivier général vérifiés sur le CV : les lignes portent sur tous les CV de l'organisation,
  // seuls ceux de `vivierOwner` sont gardés ; une ligne d'un CV supprimé depuis est écartée.
  const generalCvs = new Map((await listAllByValues(databases, DB_ID, COLLECTIONS.VIVIER_CVS, '$id', generalRows.map(r => r.vivierCvId), [
    ...ownVivier, Query.isNull('jobId'), Query.select(VIVIER_FIELDS),
  ])).map(d => [d.$id, d]))

  const candidateIds = [...poolDocs, ...appDocs].map(d => d.candidateId as string)
  const usersMap = new Map<string, { name: string; email: string; cvFileId?: string; hunterUserId?: string }>()
  for (const u of await listAllByValues(databases, DB_ID, COLLECTIONS.USERS, '$id', candidateIds, [])) {
    usersMap.set(u.$id, {
      name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim(),
      email: displayEmail(u),
      cvFileId: u.cvFileId as string | undefined,
      hunterUserId: u.role === 'hunter_profile' ? (u.hunterUserId as string) : undefined,
    })
  }

  // Proposé par un chasseur : on retrouve son nom pour l'afficher dans la liste (illisible : « Chasseur »).
  const hunterNames = new Map<string, string>()
  const hunterIds = [...usersMap.values()].map(u => u.hunterUserId).filter((h): h is string => !!h)
  const hunters = await listAllByValues(databases, DB_ID, COLLECTIONS.USERS, 'userId', hunterIds, []).catch(err => {
    console.error('[matching] noms des chasseurs non lus', jobId, err instanceof Error ? err.message : err)
    return []
  })
  for (const h of hunters) hunterNames.set(h.userId as string, `${h.firstName ?? ''} ${h.lastName ?? ''}`.trim() || 'Chasseur')

  // Date du matching d'une candidature = date de sa dernière analyse (screening). Lots par candidature : toutes les
  // analyses d'une candidature sont dans le même lot, la plus récente l'emporte. Illisible : date non affichée.
  const matchedAtByApp = new Map<string, string>()
  const screenings = await listAllByValues(databases, DB_ID, COLLECTIONS.SCREENINGS, 'applicationId', appDocs.map(d => d.$id), [
    Query.orderAsc('$createdAt'),
  ]).catch(err => {
    console.error('[matching] dates des analyses non lues', jobId, err instanceof Error ? err.message : err)
    return []
  })
  for (const d of screenings) matchedAtByApp.set(d.applicationId as string, (d.scoredAt as string) || d.$createdAt)

  const applicantCandidateIds = new Set(appDocs.map(d => d.candidateId as string))
  const applicantEmails = new Set(
    appDocs.map(d => usersMap.get(d.candidateId as string)?.email).filter((e): e is string => !!e)
  )

  // Recommandations : plus un candidat est recommandé sur une expertise demandée par l'offre, plus son score monte (plafonné).
  const { getSubmittedRecommendationsFor } = await import('@/lib/appwrite/recommendations')
  const jobText = jobDoc ? `${jobDoc.title ?? ''} ${((jobDoc.skills as string[]) ?? []).join(' ')} ${jobDoc.description ?? ''}` : ''
  const recsByCandidate = await getSubmittedRecommendationsFor(poolDocs.map(d => d.candidateId as string))

  const poolMatches: JobMatchResult[] = poolDocs.map(d => {
    const info = usersMap.get(d.candidateId as string)
    const recs = recsByCandidate.get(d.candidateId as string) ?? []
    // Même règle que le screening d'une candidature (withRecommendationBonus) : rapproche du seuil « correspond » un
    // candidat noté en dessous, sans le lui faire passer.
    const { score, reason, points } = withRecommendationBonus(d.score as number, (d.reason as string) ?? '', recs, jobText)
    return {
      source: 'pool', id: d.$id, candidateId: d.candidateId as string,
      name: info?.name || 'Candidat', email: info?.email ?? '',
      score, reason,
      recommendation: points > 0 ? expertiseBoost(recs, jobText) : undefined,
      cvFileId: info?.cvFileId, cvBucket: 'cvs',
      alreadyInFunnel: applicantCandidateIds.has(d.candidateId as string),
      matchedAt: d.$createdAt,
    }
  })

  // Vivier de l'offre (score sur le CV) et vivier général (CV qui correspond à l'offre, comme sur sa carte).
  const vivierScored = [
    ...vivierDocs.filter(d => d.matchScore != null)
      .map(d => ({ d, score: d.matchScore as number, reason: (d.matchReason as string) ?? '', matchedAt: d.$updatedAt })),
    ...generalRows.flatMap(r => {
      const d = generalCvs.get(r.vivierCvId)
      return d ? [{ d, score: r.score, reason: r.reason, matchedAt: r.updatedAt }] : []
    }),
  ]
  const owners = new Map<string, string>()
  for (const u of await listAllByValues(databases, DB_ID, COLLECTIONS.USERS, '$id', vivierScored.map(v => v.d.recruiterId as string), [])) {
    owners.set(u.$id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim())
  }
  const vivierMatches: JobMatchResult[] = vivierScored.map(({ d, score, reason, matchedAt }) => ({
    source: 'vivier', id: d.$id,
    name: (d.candidateName as string) || (d.fileName as string) || 'CV importé',
    email: (d.candidateEmail as string) ?? '',
    score, reason,
    cvFileId: d.cvFileId as string, cvBucket: 'vivier',
    alreadyInFunnel: d.candidateEmail ? applicantEmails.has(d.candidateEmail as string) : false,
    receivedAt: d.$createdAt, matchedAt,
    vivierOwner: owners.get(d.recruiterId as string) || undefined,
  }))

  const applicationMatches: JobMatchResult[] = appDocs.map(d => {
    const info = usersMap.get(d.candidateId as string)
    const score = typeof d.aiScore === 'number' ? d.aiScore : null
    return {
      source: 'application', id: d.$id, candidateId: d.candidateId as string, applicationId: d.$id,
      name: info?.name || 'Candidat', email: info?.email ?? '',
      score, reason: (d.aiSummary as string) ?? '',
      cvFileId: (d.cvFileId as string) || info?.cvFileId, cvBucket: 'cvs',
      alreadyInFunnel: true,
      receivedAt: d.$createdAt,
      matchedAt: score === null ? null : matchedAtByApp.get(d.$id) ?? null,
      hunterName: info?.hunterUserId ? hunterNames.get(info.hunterUserId) ?? 'Chasseur' : undefined,
    }
  })

  const matches = [...poolMatches, ...vivierMatches, ...applicationMatches]
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  const poolComputedAt = poolDocs[0]?.$createdAt as string | undefined ?? null

  return { matches, poolComputedAt }
}

// Le matching d'une candidature se lance automatiquement à sa réception ; s'il a échoué (IA indisponible,
// CV illisible…) ou n'a jamais démarré, on le relance ici, en arrière-plan, à l'ouverture de la page.
// Garde-fous : candidatures de plus de 90 s (celles en cours d'analyse ne sont pas doublées), 5 par passage,
// et jamais plus d'une relance par heure et par candidature (sur cette instance).
const lastRetry = new Map<string, number>()
export function unmatchedApplicationIds(matches: JobMatchResult[], now = Date.now()): string[] {
  return matches
    .filter(m => m.source === 'application' && m.score === null && m.applicationId && m.receivedAt && now - new Date(m.receivedAt).getTime() > 90_000)
    .map(m => m.applicationId as string)
    .filter(id => now - (lastRetry.get(id) ?? 0) > 3_600_000)
    .slice(0, 5)
    .map(id => { lastRetry.set(id, now); return id })
}
