'use server'

import { z } from 'zod'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { ID, Query } from 'node-appwrite'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { revalidatePath } from 'next/cache'
import { generateInterviewQuestions, createInterviewSession } from '@/app/recruiter/interviews/actions'
import { wrapEmailHtml } from '@/lib/email-template'
import { aiInterviewRecruiter, takeInterviewAiSlot, takeInterviewInviteSlot } from '@/lib/interview-access'
import { screeningBatch } from '@/lib/interview-rules'
import { notificationUserId } from '@/lib/candidate-identity'
import { recruiterCanOpenJob, recruiterCanSeeApplication } from '@/lib/job-ownership'
import { screeningCsv } from '@/lib/screening-csv'
import {
  applicationOfOrganisation, getCandidateAuthUserId, scoreApplication, sendAutoScreeningEmail, type ApplicationToScreen, type ScreeningScore,
} from '@/lib/screening-core'

export type { ApplicationToScreen, ScreeningScore } from '@/lib/screening-core'

// Chaque action vérifie elle-même le recruteur (une Server Action est un point d'entrée public) et n'agit que sur les
// candidatures des offres de son organisation ou partagées par la plateforme (applicationOfOrganisation, revue de
// sécurité du 2026-11-13 : avant, n'importe quel recruteur lisait et notait les candidats des autres organisations).

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ── Prepare & send interview invite from a screening result ────────
export async function prepareInterviewFromScreening(params: {
  applicationId: string
  jobId: string
  jobTitle: string
  jobDescription: string
  jobSkills: string[]
  candidateName: string
  candidateEmail: string
  screeningSummary: string
}): Promise<{ sessionId: string; questions: import('@/app/recruiter/interviews/actions').InterviewQuestion[] } | { error: string }> {
  const cvSummary = `Résumé screening IA : ${params.screeningSummary}`
  const questions = await generateInterviewQuestions(
    params.jobTitle, params.jobDescription, params.jobSkills, cvSummary, 8,
  )
  if ('error' in questions) return { error: questions.error }

  const session = await createInterviewSession(
    params.applicationId, params.jobId,
    params.candidateName, params.candidateEmail, params.jobTitle, questions,
  )
  if ('error' in session) return { error: session.error }

  return { sessionId: session.sessionId, questions }
}

// ── Real email sending (Appwrite Messaging) ─────────────────────────
// Replaces the old mailto: links, which only opened the recruiter's local
// mail client (and did nothing if none was configured — nothing was ever
// actually sent). Appwrite Messaging targets registered Appwrite Auth users,
// not raw addresses, so we need to resolve the candidate to a user id one way
// or another (see resolveCandidateAuthId below).

// An interview created ad-hoc (from the recruiter dashboard's "Nouvel entretien" button,
// with no linked application) has no applicationId to resolve a candidate through : the
// candidate is found by e-mail among CANDIDATE profiles only (revue de sécurité du
// 2026-11-13 : avant, tout compte de la plateforme, recruteurs et admins compris, pouvait
// recevoir une invitation au texte choisi par l'appelant).
async function candidateAuthIdByEmail(email: string): Promise<string | null> {
  if (!email) return null
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [Query.equal('email', email), Query.equal('role', 'candidate'), Query.limit(1)])
  const profile = res.documents[0]
  return profile ? notificationUserId(profile as unknown as Record<string, unknown>) : null
}

/**
 * Invitation à un entretien de l'organisation du recruteur. Candidat, poste et candidature viennent de la session
 * d'entretien enregistrée, pas du navigateur : seuls `sessionId` et `mediaMode` sont lus (les autres champs restent
 * pour les appelants existants).
 */
export async function sendInterviewInvitationEmail(params: {
  applicationId?: string
  candidateEmail: string
  sessionId: string
  jobTitle: string
  candidateName: string
  mediaMode?: 'audio' | 'video'
}): Promise<{ ok?: boolean; error?: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: 'Non autorisé' }
  if (typeof params?.sessionId !== 'string' || !/^[\w-]{1,36}$/.test(params.sessionId)) return { error: 'Entretien introuvable' }

  try {
    const { databases } = createAdminClient()
    const session = await databases.getDocument(DB_ID, COLLECTIONS.INTERVIEWS, params.sessionId)
    if (session.tenantId !== user.tenantId) return { error: 'Entretien introuvable' }
    const candidateName = String(session.candidateName ?? '').slice(0, 120)
    const jobTitle = String(session.jobTitle ?? '').slice(0, 200)
    const applicationId = typeof session.applicationId === 'string' && session.applicationId ? session.applicationId : undefined
    // Session liée à une candidature : revérifiée (sessions créées avant le contrôle des candidatures), et le candidat est
    // celui de la candidature, jamais une adresse saisie.
    if (applicationId && !(await applicationOfOrganisation(applicationId, user.tenantId))) return { error: 'Entretien introuvable' }
    const refused = await takeInterviewInviteSlot(user, user.tenantId)
    if (refused) return { error: refused }

    const candidateAuthId = applicationId
      ? await getCandidateAuthUserId(applicationId)
      : await candidateAuthIdByEmail(String(session.candidateEmail ?? ''))
    if (!candidateAuthId) return { error: 'Aucun compte candidat associé à cet email' }

    const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
    const interviewLink = params.mediaMode === 'video'
      ? `${origin}/interview/${session.$id}?mode=video`
      : `${origin}/interview/${session.$id}`

    const webcamNote = params.mediaMode === 'video'
      ? `<br><br>📹 Cet entretien se déroule en <strong>vidéo</strong> — votre caméra et votre micro vous seront demandés au démarrage, pensez à vous installer dans un endroit calme et bien éclairé.`
      : `<br><br>🎙️ Cet entretien s'enregistre en <strong>audio</strong> — votre micro vous sera demandé au démarrage.`

    const body = `
      <p style="margin:0 0 24px; font-size:14px; line-height:1.7; color:#45454A;">
        Bonjour ${escapeHtml(candidateName)},<br><br>
        Nous avons bien reçu votre candidature pour le poste de <strong>${escapeHtml(jobTitle)}</strong> et nous souhaitons vous inviter à passer un entretien avec notre agent IA.<br><br>
        Cet entretien dure environ 15-20 minutes et peut être passé depuis n'importe quel appareil.${webcamNote}
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
        <tr><td style="border-radius:10px; background-color:#E8A33D;">
          <a href="${interviewLink}" target="_blank" style="display:inline-block; padding:14px 32px; font-size:14px; font-weight:700; color:#FFFFFF; text-decoration:none; border-radius:10px;">Passer l'entretien</a>
        </td></tr>
      </table>
      <p style="margin:0; font-size:12px; line-height:1.6; color:#9B9B9E;">Si le bouton ne fonctionne pas : <a href="${interviewLink}" style="color:#E8A33D;">${interviewLink}</a></p>
    `

    const { messaging } = createAdminClient()
    await messaging.createEmail(
      ID.unique(),
      `Invitation à un entretien IA — ${jobTitle}`,
      wrapEmailHtml('Vous êtes invité(e) à un entretien', body),
      [], [candidateAuthId], [], [], [], [], false, true,
    )
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'envoi' }
  }
}

const customMessageSchema = z.object({
  applicationId: z.string().regex(/^[\w-]{1,36}$/),
  subject: z.string().trim().min(1, 'Objet requis.').max(200, 'Objet trop long (200 caractères au plus).'),
  message: z.string().trim().min(1, 'Message requis.').max(5000, 'Message trop long (5 000 caractères au plus).'),
})

/** Message libre au candidat d'une candidature de l'organisation du recruteur (texte échappé : ni lien ni balise insérés). */
export async function sendCustomMessage(params: {
  applicationId: string
  subject: string
  message: string
}): Promise<{ ok?: boolean; error?: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: 'Non autorisé' }
  const parsed = customMessageSchema.safeParse(params)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Message invalide.' }

  try {
    if (!(await applicationOfOrganisation(parsed.data.applicationId, user.tenantId))) return { error: 'Candidat introuvable' }
    const candidateAuthId = await getCandidateAuthUserId(parsed.data.applicationId)
    if (!candidateAuthId) return { error: 'Candidat introuvable' }

    const bodyHtml = parsed.data.message
      .split('\n')
      .map(line => `<p style="margin:0 0 12px; font-size:14px; line-height:1.7; color:#45454A;">${escapeHtml(line) || '&nbsp;'}</p>`)
      .join('')

    const { messaging } = createAdminClient()
    await messaging.createEmail(
      ID.unique(),
      parsed.data.subject,
      wrapEmailHtml(escapeHtml(parsed.data.subject), bodyHtml),
      [], [candidateAuthId], [], [], [], [], false, true,
    )
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'envoi' }
  }
}

// ── Load all applications for a job and screen them ──────────────
export interface ApplicationRow {
  applicationId: string
  candidateName: string
  candidateEmail: string
  cvFileId?: string
  coverLetter?: string
  appliedAt: string
  existingScore?: number
  existingScreeningId?: string
}

export async function getApplicationsForJob(jobId: string): Promise<{ apps: ApplicationRow[]; job: { title: string; description: string; skills: string[] } | null; existingResults: ScreeningScore[]; error?: string }> {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'recruiter' || !user.tenantId) return { apps: [], job: null, existingResults: [], error: 'Non autorisé' }
    if (typeof jobId !== 'string' || !/^[\w-]{1,36}$/.test(jobId)) return { apps: [], job: null, existingResults: [], error: 'Offre introuvable' }

    const { databases } = createAdminClient()
    // Offre de l'organisation du recruteur ou partagée par la plateforme (recruiterCanOpenJob). Offre partagée : ses
    // candidatures et les candidatures directes seulement, jamais celles d'une autre organisation (recruiterCanSeeApplication).
    const jobDoc = await databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId)
    const shared = jobDoc.tenantId === '' || jobDoc.tenantId == null
    if (!recruiterCanOpenJob(typeof jobDoc.tenantId === 'string' ? jobDoc.tenantId : '', user.tenantId)) {
      return { apps: [], job: null, existingResults: [], error: 'Offre introuvable' }
    }
    const appsResult = await databases.listDocuments(DB_ID, COLLECTIONS.APPLICATIONS, [
      Query.equal('jobId', jobId), ...(shared ? [Query.equal('tenantId', [user.tenantId, ''])] : []), Query.orderDesc('$createdAt'), Query.limit(100),
    ])

    const job = {
      title: jobDoc.title as string,
      description: jobDoc.description as string,
      skills: (jobDoc.skills as string[]) ?? [],
    }

    // Load existing screenings (full result, not just the score) so the
    // recruiter sees past results immediately instead of re-running screening.
    const appIds = appsResult.documents.map(d => d.$id)
    const screeningMap: Record<string, { score: number; $id: string }> = {}
    let screeningDocs: Record<string, unknown>[] = []
    if (appIds.length > 0) {
      try {
        const screenings = await databases.listDocuments(DB_ID, COLLECTIONS.SCREENINGS, [
          Query.equal('applicationId', appIds.slice(0, 25)), Query.limit(100),
        ])
        screeningDocs = screenings.documents as unknown as Record<string, unknown>[]
        for (const s of screeningDocs) {
          screeningMap[s.applicationId as string] = { score: s.score as number, $id: s.$id as string }
        }
      } catch { /* collection might not exist yet */ }
    }

    // Resolve candidate names from USERS collection
    const candidateIds = [...new Set(appsResult.documents.map(d => d.candidateId as string))]
    const userMap = new Map<string, { name: string; email: string }>()
    if (candidateIds.length > 0) {
      try {
        const usersResult = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [
          Query.equal('$id', candidateIds.slice(0, 25)), Query.limit(25),
        ])
        for (const u of usersResult.documents) {
          userMap.set(u.$id, {
            name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim(),
            email: u.email as string,
          })
        }
      } catch { /* silently skip */ }
    }

    const apps: ApplicationRow[] = appsResult.documents.map(doc => {
      const cand = userMap.get(doc.candidateId as string)
      return {
        applicationId: doc.$id,
        candidateName: cand?.name || `Candidat #${(doc.candidateId as string).slice(-6)}`,
        candidateEmail: cand?.email || '',
        cvFileId: doc.cvFileId as string | undefined,
        coverLetter: doc.coverLetter as string | undefined,
        appliedAt: doc.$createdAt,
        existingScore: screeningMap[doc.$id]?.score,
        existingScreeningId: screeningMap[doc.$id]?.$id,
      }
    })

    const existingResults: ScreeningScore[] = screeningDocs.map(s => {
      const app = apps.find(a => a.applicationId === (s.applicationId as string))
      return {
        applicationId: s.applicationId as string,
        candidateName: app?.candidateName ?? '',
        candidateEmail: app?.candidateEmail ?? '',
        jobTitle: job.title,
        cvFileId: app?.cvFileId,
        score: s.score as number,
        recommendation: s.recommendation as ScreeningScore['recommendation'],
        skills: JSON.parse((s.skills as string) ?? '[]'),
        strengths: (s.strengths as string[]) ?? [],
        concerns: (s.concerns as string[]) ?? [],
        summary: (s.summary as string) ?? '',
        scoredAt: s.scoredAt as string,
        provider: s.provider as string,
      }
    }).filter(r => r.candidateEmail || r.candidateName)

    return { apps, job, existingResults }
  } catch (e) {
    return { apps: [], job: null, existingResults: [], error: e instanceof Error ? e.message : 'Erreur' }
  }
}

/**
 * Screening des candidatures `appIds` d'une offre de l'organisation du recruteur (ou partagée par la plateforme) : 100
 * au plus par demande, chacune de cette offre, une place de quota d'IA par candidature (interview-access.ts).
 */
export async function screenAllApplications(jobId: string, appIds: string[]): Promise<{ results: ScreeningScore[]; errors: string[] }> {
  const me = await aiInterviewRecruiter()
  if ('error' in me) return { results: [], errors: [me.error] }
  const batch = screeningBatch(appIds)
  if (!batch || typeof jobId !== 'string' || !/^[\w-]{1,36}$/.test(jobId)) return { results: [], errors: ['Demande invalide.'] }

  const { databases } = createAdminClient()
  const jobDoc = await databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId)
  const jobTenantId = typeof jobDoc.tenantId === 'string' ? jobDoc.tenantId : ''
  if (!recruiterCanOpenJob(jobTenantId, me.tenantId)) return { results: [], errors: ['Offre introuvable'] }
  const job = {
    title: jobDoc.title as string,
    description: jobDoc.description as string,
    skills: (jobDoc.skills as string[]) ?? [],
  }

  const results: ScreeningScore[] = []
  const errors: string[] = []

  for (const appId of batch) {
    try {
      const appDoc = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, appId)
      const appTenantId = typeof appDoc.tenantId === 'string' ? appDoc.tenantId : ''
      if (appDoc.jobId !== jobId || !recruiterCanSeeApplication(jobTenantId, appTenantId, me.tenantId)) {
        errors.push(`Candidature ${appId} introuvable pour cette offre`)
        continue
      }
      const refused = await takeInterviewAiSlot(me)
      if (refused) { errors.push(refused); break }

      // Resolve candidate name/email from USERS collection
      let candidateName = `Candidat #${(appDoc.candidateId as string).slice(-6)}`
      let candidateEmail = ''
      try {
        const userDoc = await databases.getDocument(DB_ID, COLLECTIONS.USERS, appDoc.candidateId as string)
        candidateName = `${userDoc.firstName ?? ''} ${userDoc.lastName ?? ''}`.trim() || candidateName
        candidateEmail = (userDoc.email as string) ?? ''
      } catch { /* user not found */ }

      const toScreen: ApplicationToScreen = {
        applicationId: appId,
        candidateId: appDoc.candidateId as string,
        candidateName,
        candidateEmail,
        jobTitle: job.title,
        jobDescription: job.description,
        jobSkills: job.skills,
        cvFileId: appDoc.cvFileId as string | undefined,
      }

      const result = await scoreApplication(toScreen)
      if ('error' in result) { errors.push(`${toScreen.candidateName}: ${result.error}`); continue }

      // Save to SCREENINGS collection, and mirror the score onto the
      // application doc itself so the dashboard's candidatures view shows
      // it without a trip to this screening page.
      try {
        await databases.createDocument(DB_ID, COLLECTIONS.SCREENINGS, ID.unique(), {
          applicationId: appId,
          jobId,
          tenantId: me.tenantId,
          score: result.score,
          recommendation: result.recommendation,
          summary: result.summary,
          skills: JSON.stringify(result.skills),
          strengths: result.strengths,
          concerns: result.concerns,
          provider: result.provider,
          scoredAt: result.scoredAt,
        })
      } catch { /* collection setup pending */ }
      try {
        await databases.updateDocument(DB_ID, COLLECTIONS.APPLICATIONS, appId, {
          aiScore: result.score,
          aiSummary: result.summary,
          aiRecommendation: result.recommendation,
        })
      } catch { /* non-blocking */ }

      // Best profiles get an automatic, personalized email — never blocks screening on failure. Only on the first
      // analysis of the application: screening again must not send the candidate a second e-mail.
      if (result.score >= 70 && appDoc.aiScore == null) {
        try { await sendAutoScreeningEmail(appId, result) } catch { /* non-blocking */ }
      }

      results.push(result)
    } catch (e) {
      errors.push(`App ${appId}: ${e instanceof Error ? e.message : 'Erreur'}`)
    }
  }

  revalidatePath('/recruiter/screening')
  return { results, errors }
}

// ── Export CSV ────────────────────────────────────────────────────
// Mise en forme seule, sur les résultats déjà affichés au recruteur (aucune lecture en base) ; cellules sûres : screening-csv.ts.
export async function exportScreeningCSV(results: ScreeningScore[]): Promise<string> {
  return screeningCsv(Array.isArray(results) ? results.slice(0, 500) : [])
}
