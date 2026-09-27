// Core "Matching IA" logic — shared by the automatic trigger fired on job creation
// (population 1: platform's candidate database) and the vivier upload flow (population 2:
// CVs the recruiter picked for this job). Not 'use server' on purpose, same reasoning as
// sourcing-core.ts: everything exported from a 'use server' file becomes a remotely-callable
// action, and these skip auth checks since they're called from trusted server contexts only.
import { displayEmail } from '@/lib/candidate-identity'
import { callLLM } from '@/lib/ai/llm-router'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query, ID } from 'node-appwrite'
import type { CvProfile } from '@/lib/cv-profile-extract'

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
  /** Points ajoutés au score grâce aux recommandations reçues sur des expertises demandées par l'offre. */
  recommendation?: { points: number; matched: { expertise: string; count: number }[] }
}

// Population 1 — recompute the whole platform candidate pool against this job and replace
// the stored results. Runs automatically right after a job is created; the recruiter can
// also trigger it again later (e.g. once new candidates have registered) from the Matching page.
export async function runPoolMatching(jobId: string): Promise<{ matched: number; error?: string }> {
  try {
    const { databases } = createAdminClient()
    const job = await databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId)

    const { matchCandidatesForJob } = await import('@/lib/sourcing-core')
    const { matches, error } = await matchCandidatesForJob(jobId)
    if (error && matches.length === 0) return { matched: 0, error }

    const existing = await databases.listDocuments(DB_ID, COLLECTIONS.JOB_MATCHES, [
      Query.equal('jobId', jobId), Query.limit(200),
    ])
    await Promise.all(existing.documents.map(d => databases.deleteDocument(DB_ID, COLLECTIONS.JOB_MATCHES, d.$id)))

    await Promise.all(matches.map(m => databases.createDocument(DB_ID, COLLECTIONS.JOB_MATCHES, ID.unique(), {
      tenantId: job.tenantId as string,
      jobId,
      candidateId: m.candidateId,
      score: m.score,
      reason: m.reason.slice(0, 1000),
    })))

    return { matched: matches.length }
  } catch (e) {
    return { matched: 0, error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

// Population 2 — scores a single vivier CV against a job right after it's uploaded, using
// the profile already extracted at upload time (no need to re-download/re-parse the file).
export async function matchVivierCvAgainstJob(jobId: string, vivierCvId: string, profile: CvProfile): Promise<void> {
  try {
    const { databases } = createAdminClient()
    const job = await databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId)

    const SYSTEM = `Tu es un expert en sourcing de candidats. On te donne une offre d'emploi et le profil extrait d'un CV. Évalue la pertinence de ce candidat pour ce poste.
Réponds UNIQUEMENT avec un JSON valide, sans markdown : {"score":0-100,"reason":"une phrase expliquant pourquoi ce candidat correspond (ou pas)"}`
    const userMsg = `=== OFFRE ===\nPoste : ${job.title}\nCompétences recherchées : ${((job.skills as string[]) ?? []).join(', ')}\nDescription : ${(job.description as string ?? '').slice(0, 1200)}\n\n=== PROFIL CANDIDAT ===\nCompétences : ${profile.skills.join(', ')}\nExpérience : ${profile.experienceSummary}\nAnnées d'expérience : ${profile.yearsOfExperience ?? 'non précisé'}`

    const { content } = await callLLM([{ role: 'user', content: userMsg }], SYSTEM, { module: 'matching' })
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return

    const parsed = JSON.parse(jsonMatch[0])
    const score = Math.min(100, Math.max(0, Number(parsed.score) || 0))
    await databases.updateDocument(DB_ID, COLLECTIONS.VIVIER_CVS, vivierCvId, {
      matchScore: score,
      matchReason: String(parsed.reason ?? '').slice(0, 500),
    })
  } catch {
    // best-effort — a vivier CV stays usable (unscored) even if matching fails
  }
}

// Combined, ranked results for the Matching page — 3 populations: job_matches (pool,
// candidates who haven't applied), vivier_cvs (CVs the recruiter picked for this job),
// and applications (candidates who actually applied — scored by the automatic matching that
// runs on every new application, incl. profiles proposed by headhunters).
export async function getJobMatches(jobId: string): Promise<{ matches: JobMatchResult[]; poolComputedAt: string | null }> {
  const { databases } = createAdminClient()

  const [poolRes, vivierRes, appsRes] = await Promise.all([
    databases.listDocuments(DB_ID, COLLECTIONS.JOB_MATCHES, [
      Query.equal('jobId', jobId), Query.orderDesc('score'), Query.limit(200),
    ]),
    databases.listDocuments(DB_ID, COLLECTIONS.VIVIER_CVS, [
      Query.equal('jobId', jobId), Query.limit(200),
    ]),
    databases.listDocuments(DB_ID, COLLECTIONS.APPLICATIONS, [
      Query.equal('jobId', jobId), Query.limit(200),
    ]),
  ])

  const candidateIds = [...new Set([
    ...poolRes.documents.map(d => d.candidateId as string),
    ...appsRes.documents.map(d => d.candidateId as string),
  ])]
  const usersMap = new Map<string, { name: string; email: string; cvFileId?: string; hunterUserId?: string }>()
  if (candidateIds.length > 0) {
    const usersRes = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [
      Query.equal('$id', candidateIds.slice(0, 100)), Query.limit(100),
    ])
    for (const u of usersRes.documents) {
      usersMap.set(u.$id, {
        name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim(),
        email: displayEmail(u),
        cvFileId: u.cvFileId as string | undefined,
        hunterUserId: u.role === 'hunter_profile' ? (u.hunterUserId as string) : undefined,
      })
    }
  }

  // Proposé par un chasseur : on retrouve son nom pour l'afficher dans la liste.
  const hunterNames = new Map<string, string>()
  const hunterIds = [...new Set([...usersMap.values()].map(u => u.hunterUserId).filter((h): h is string => !!h))]
  if (hunterIds.length > 0) {
    const hd = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [Query.equal('userId', hunterIds.slice(0, 100)), Query.limit(100)]).catch(() => null)
    for (const h of hd?.documents ?? []) hunterNames.set(h.userId as string, `${h.firstName ?? ''} ${h.lastName ?? ''}`.trim() || 'Chasseur')
  }

  // Date du matching d'une candidature = date de sa dernière analyse (screening).
  const matchedAtByApp = new Map<string, string>()
  const appIds = appsRes.documents.map(d => d.$id)
  if (appIds.length > 0) {
    const scr = await databases.listDocuments(DB_ID, COLLECTIONS.SCREENINGS, [
      Query.equal('applicationId', appIds.slice(0, 100)), Query.orderAsc('$createdAt'), Query.limit(500),
    ]).catch(() => null)
    for (const d of scr?.documents ?? []) matchedAtByApp.set(d.applicationId as string, (d.scoredAt as string) || d.$createdAt)
  }

  const applicantCandidateIds = new Set(appsRes.documents.map(d => d.candidateId as string))
  const applicantEmails = new Set(
    appsRes.documents.map(d => usersMap.get(d.candidateId as string)?.email).filter((e): e is string => !!e)
  )

  // Recommandations : plus un candidat est recommandé sur une expertise demandée par l'offre, plus son score monte (plafonné).
  const [{ getSubmittedRecommendationsFor }, { expertiseBoost, formatMatched }] = await Promise.all([
    import('@/lib/appwrite/recommendations'), import('@/lib/recommendation-boost'),
  ])
  const jobDoc = await databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId).catch(() => null)
  const jobText = jobDoc ? `${jobDoc.title ?? ''} ${((jobDoc.skills as string[]) ?? []).join(' ')} ${jobDoc.description ?? ''}` : ''
  const recsByCandidate = await getSubmittedRecommendationsFor(poolRes.documents.map(d => d.candidateId as string))

  const poolMatches: JobMatchResult[] = poolRes.documents.map(d => {
    const info = usersMap.get(d.candidateId as string)
    const boost = expertiseBoost(recsByCandidate.get(d.candidateId as string) ?? [], jobText)
    const base = d.score as number
    return {
      source: 'pool', id: d.$id, candidateId: d.candidateId as string,
      name: info?.name || 'Candidat', email: info?.email ?? '',
      score: Math.min(100, base + boost.points),
      reason: `${(d.reason as string) ?? ''}${boost.points > 0 ? ` — Recommandé sur : ${formatMatched(boost.matched)} (+${boost.points} pts)` : ''}`,
      recommendation: boost.points > 0 ? boost : undefined,
      cvFileId: info?.cvFileId, cvBucket: 'cvs',
      alreadyInFunnel: applicantCandidateIds.has(d.candidateId as string),
      matchedAt: d.$createdAt,
    }
  })

  const vivierMatches: JobMatchResult[] = vivierRes.documents
    .filter(d => d.matchScore != null)
    .map(d => ({
      source: 'vivier', id: d.$id,
      name: (d.candidateName as string) || (d.fileName as string) || 'CV importé',
      email: (d.candidateEmail as string) ?? '',
      score: d.matchScore as number, reason: (d.matchReason as string) ?? '',
      cvFileId: d.cvFileId as string, cvBucket: 'vivier',
      alreadyInFunnel: d.candidateEmail ? applicantEmails.has(d.candidateEmail as string) : false,
      receivedAt: d.$createdAt, matchedAt: d.$updatedAt,
    }))

  const applicationMatches: JobMatchResult[] = appsRes.documents.map(d => {
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
  const poolComputedAt = poolRes.documents[0]?.$createdAt as string | undefined ?? null

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
