'use server'

import { notificationUserId } from '@/lib/candidate-identity'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { ID, Query } from 'node-appwrite'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { revalidatePath } from 'next/cache'
import { generateInterviewQuestions, createInterviewSession } from '@/app/recruiter/interviews/actions'
import { wrapEmailHtml } from '@/lib/email-template'
import { recommendationFor, type Judgement } from '@/lib/match-scoring'
import { cvScorer, readCvForScoring } from '@/lib/sourcing-core'
import { withRecommendationBonus } from '@/lib/recommendation-boost'

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

async function getCandidateAuthUserId(applicationId: string): Promise<string | null> {
  const { databases } = createAdminClient()
  const appDoc = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId)
  const userDoc = await databases.getDocument(DB_ID, COLLECTIONS.USERS, appDoc.candidateId as string)
  // Profil du vivier d'un chasseur : la notification part au chasseur, l'intermédiaire.
  return notificationUserId(userDoc as unknown as Record<string, unknown>)
}

async function getCandidateAuthUserIdByEmail(email: string): Promise<string | null> {
  const { users } = createAdminClient()
  const res = await users.list([Query.equal('email', [email])])
  return res.users[0]?.$id ?? null
}

// An interview created ad-hoc (from the recruiter dashboard's "Nouvel entretien" button,
// with no linked application) has no applicationId to resolve a candidate through — that
// silently skipped sending any email at all. Falling back to a lookup by email covers that
// case as long as the candidate has ANY account under that address (they normally do, since
// applying to a job requires one) — only a candidate who has genuinely never touched the
// platform falls through to "no account found" below.
async function resolveCandidateAuthId(applicationId: string | undefined, candidateEmail: string): Promise<string | null> {
  if (applicationId) {
    try {
      const id = await getCandidateAuthUserId(applicationId)
      if (id) return id
    } catch { /* fall through to email lookup */ }
  }
  return getCandidateAuthUserIdByEmail(candidateEmail)
}

export async function sendInterviewInvitationEmail(params: {
  applicationId?: string
  candidateEmail: string
  sessionId: string
  jobTitle: string
  candidateName: string
  mediaMode?: 'audio' | 'video'
}): Promise<{ ok?: boolean; error?: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') return { error: 'Non autorisé' }

  try {
    const candidateAuthId = await resolveCandidateAuthId(params.applicationId, params.candidateEmail)
    if (!candidateAuthId) return { error: 'Aucun compte candidat associé à cet email' }

    const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
    const interviewLink = params.mediaMode === 'video'
      ? `${origin}/interview/${params.sessionId}?mode=video`
      : `${origin}/interview/${params.sessionId}`

    const webcamNote = params.mediaMode === 'video'
      ? `<br><br>📹 Cet entretien se déroule en <strong>vidéo</strong> — votre caméra et votre micro vous seront demandés au démarrage, pensez à vous installer dans un endroit calme et bien éclairé.`
      : `<br><br>🎙️ Cet entretien s'enregistre en <strong>audio</strong> — votre micro vous sera demandé au démarrage.`

    const body = `
      <p style="margin:0 0 24px; font-size:14px; line-height:1.7; color:#45454A;">
        Bonjour ${params.candidateName},<br><br>
        Nous avons bien reçu votre candidature pour le poste de <strong>${params.jobTitle}</strong> et nous souhaitons vous inviter à passer un entretien avec notre agent IA.<br><br>
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
      `Invitation à un entretien IA — ${params.jobTitle}`,
      wrapEmailHtml('Vous êtes invité(e) à un entretien', body),
      [], [candidateAuthId], [], [], [], [], false, true,
    )
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'envoi' }
  }
}

export async function sendCustomMessage(params: {
  applicationId: string
  subject: string
  message: string
}): Promise<{ ok?: boolean; error?: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') return { error: 'Non autorisé' }

  try {
    const candidateAuthId = await getCandidateAuthUserId(params.applicationId)
    if (!candidateAuthId) return { error: 'Candidat introuvable' }

    const bodyHtml = params.message
      .split('\n')
      .map(line => `<p style="margin:0 0 12px; font-size:14px; line-height:1.7; color:#45454A;">${line || '&nbsp;'}</p>`)
      .join('')

    const { messaging } = createAdminClient()
    await messaging.createEmail(
      ID.unique(),
      params.subject,
      wrapEmailHtml(params.subject, bodyHtml),
      [], [candidateAuthId], [], [], [], [], false, true,
    )
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'envoi' }
  }
}

// Personalized congratulations email, sent automatically to candidates who
// score 70+ during screening — no recruiter action needed.
async function sendAutoScreeningEmail(applicationId: string, result: {
  candidateName: string
  jobTitle: string
  score: number
  strengths: string[]
  plainSummary?: string
}): Promise<void> {
  const candidateAuthId = await getCandidateAuthUserId(applicationId)
  if (!candidateAuthId) return

  const topStrength = result.strengths[0]
  const body = `
    <p style="margin:0 0 24px; font-size:14px; line-height:1.7; color:#45454A;">
      Bonjour ${result.candidateName},<br><br>
      Nous avons analysé votre candidature pour le poste de <strong>${result.jobTitle}</strong> et votre profil a particulièrement retenu notre attention (score de compatibilité : <strong>${result.score}/100</strong>).<br><br>
      ${result.plainSummary ?? ''}
      ${topStrength ? `<br><br>Point fort identifié : ${topStrength}` : ''}
    </p>
    <p style="margin:0; font-size:14px; line-height:1.7; color:#45454A;">
      Notre équipe revient vers vous très prochainement pour la suite du processus. Merci pour votre candidature !
    </p>
  `

  const { messaging } = createAdminClient()
  await messaging.createEmail(
    ID.unique(),
    `Votre candidature pour ${result.jobTitle} a retenu notre attention`,
    wrapEmailHtml('Votre profil nous intéresse', body),
    [], [candidateAuthId], [], [], [], [], false, true,
  )
}

export interface ScreeningScore {
  applicationId: string
  candidateName: string
  candidateEmail: string
  jobTitle: string
  cvFileId?: string
  score: number           // 0-100
  recommendation: 'top' | 'good' | 'average' | 'weak' | 'reject'
  skills: { name: string; match: 'yes' | 'partial' | 'no' }[]
  strengths: string[]
  concerns: string[]
  /** Pour les recruteurs : jugements (« Poste : … · Domaine : … ») puis le résumé de l'IA. */
  summary: string
  /** Résumé de l'IA seul, pour l'e-mail au candidat (jamais les jugements internes) ; absent d'une analyse relue. */
  plainSummary?: string
  scoredAt: string
  provider: string
}

export interface ApplicationToScreen {
  applicationId: string
  candidateId?: string
  candidateName: string
  candidateEmail: string
  jobTitle: string
  jobDescription: string
  jobSkills: string[]
  /** CV joint à la candidature ; sans CV lisible, pas de score (jamais une note sur un texte d'erreur). */
  cvFileId?: string
}

// ── Score a single CV against a job ──────────────────────────────
export async function screenApplication(app: ApplicationToScreen): Promise<ScreeningScore | { error: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') return { error: 'Non autorisé' }
  return scoreApplicationInternal(app)
}

// Same scoring logic, without the recruiter-role gate — used by the
// automatic screening triggered right after a candidate applies, where
// there is no recruiter in session.
// La notation de la base candidats et du vivier de l'offre (cvScorer, ADR 0029) : même consigne, même modèle, même texte
// du CV ; ni lettre de motivation ni critère ajouté. Puis le bonus des recommandations, la même règle que sur le Matching IA.
async function scoreApplicationInternal(app: ApplicationToScreen): Promise<ScreeningScore | { error: string }> {
  try {
    if (!app.cvFileId) return { error: 'Pas de CV joint à la candidature : score impossible' }
    let cvText: string
    try {
      cvText = await readCvForScoring(app.cvFileId)
    } catch (e) {
      console.error('[screening] lecture du CV impossible', app.applicationId, e instanceof Error ? e.message : e)
      return { error: 'Lecture du CV impossible (fichier abîmé ou stockage injoignable) : réessayez' }
    }
    if (!cvText) return { error: 'CV sans texte lisible (PDF scanné) : score impossible' }

    const scored = await cvScorer({ title: app.jobTitle, skills: app.jobSkills, description: app.jobDescription })(cvText)
    if (!scored) return { error: 'Réponse de l\'IA sans jugement lisible : relancez le screening' }
    const jobText = `${app.jobTitle} ${app.jobSkills.join(' ')} ${app.jobDescription}`
    const { score, reason } = withRecommendationBonus(scored.score, scored.reason, await recommendationsOf(app.candidateId), jobText)
    const { criteria, judgements, notes } = scored

    return {
      applicationId: app.applicationId,
      candidateName: app.candidateName,
      candidateEmail: app.candidateEmail,
      jobTitle: app.jobTitle,
      cvFileId: app.cvFileId,
      score,
      recommendation: recommendationFor(score),
      skills: criteria.skills.length > 0
        ? criteria.skills.map((name, i) => ({ name, match: SKILL_MATCH[judgements.skills[i]] }))
        : notes.namedSkills.map(s => ({ name: s.name, match: SKILL_MATCH[s.match] })),
      strengths: notes.strengths,
      concerns: notes.concerns,
      // D'où vient le score, puis la phrase de l'IA et les recommandations : la raison affichée sur le Matching IA.
      summary: reason,
      plainSummary: notes.summary,
      scoredAt: new Date().toISOString(),
      provider: scored.provider,
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

const SKILL_MATCH: Record<Judgement, 'yes' | 'partial' | 'no'> = { oui: 'yes', partiel: 'partial', non: 'no' }

/** Recommandations reçues par le candidat ; illisibles : aucune (journalisé), le score reste celui des jugements. */
async function recommendationsOf(candidateId: string | undefined): Promise<{ endorsedExpertises?: string[] }[]> {
  if (!candidateId) return []
  try {
    const { getSubmittedRecommendations } = await import('@/lib/appwrite/recommendations')
    return await getSubmittedRecommendations(candidateId)
  } catch (e) {
    console.error('[screening] recommandations non lues, score sans leur bonus', candidateId, e instanceof Error ? e.message : e)
    return []
  }
}

// ── Auto-screen a single application right after it's submitted ───
// Fire-and-forget from /api/apply: scores the CV against the job it was
// just submitted to, saves the result, and emails the candidate if they
// score 70+. Never throws — screening failure must never surface to the
// candidate's apply flow. `error` : pourquoi la candidature reste sans score (« Relancer » du Matching IA l'affiche).
export async function autoScreenApplication(applicationId: string): Promise<{ error?: string }> {
  try {
    const { databases } = createAdminClient()
    const appDoc = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId)
    const jobDoc = await databases.getDocument(DB_ID, COLLECTIONS.JOBS, appDoc.jobId as string)

    let candidateName = `Candidat #${(appDoc.candidateId as string).slice(-6)}`
    let candidateEmail = ''
    try {
      const userDoc = await databases.getDocument(DB_ID, COLLECTIONS.USERS, appDoc.candidateId as string)
      candidateName = `${userDoc.firstName ?? ''} ${userDoc.lastName ?? ''}`.trim() || candidateName
      candidateEmail = (userDoc.email as string) ?? ''
    } catch { /* user not found */ }

    const result = await scoreApplicationInternal({
      applicationId,
      candidateId: appDoc.candidateId as string,
      candidateName,
      candidateEmail,
      jobTitle: jobDoc.title as string,
      jobDescription: jobDoc.description as string,
      jobSkills: (jobDoc.skills as string[]) ?? [],
      cvFileId: appDoc.cvFileId as string | undefined,
    })
    if ('error' in result) {
      // La candidature reste sans score : le Matching IA la relance à son ouverture, le recruteur depuis sa carte.
      console.error('[screening] analyse automatique sans score', applicationId, result.error)
      return { error: result.error }
    }

    await Promise.all([
      databases.createDocument(DB_ID, COLLECTIONS.SCREENINGS, ID.unique(), {
        applicationId,
        jobId: appDoc.jobId,
        tenantId: (appDoc.tenantId as string) ?? '',
        score: result.score,
        recommendation: result.recommendation,
        summary: result.summary,
        skills: JSON.stringify(result.skills),
        strengths: result.strengths,
        concerns: result.concerns,
        provider: result.provider,
        scoredAt: result.scoredAt,
      }),
      // Mirror onto the application doc itself so the dashboard's candidatures
      // view shows the score without a trip to the screening page.
      databases.updateDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId, {
        aiScore: result.score,
        aiSummary: result.summary,
        aiRecommendation: result.recommendation,
      }),
    ])

    // E-mail à la première analyse seulement : une analyse relancée (« Relancer le matching ») ne le renvoie pas.
    if (result.score >= 70 && appDoc.aiScore == null) {
      try { await sendAutoScreeningEmail(applicationId, result) } catch { /* non-blocking */ }
    }

    revalidatePath('/recruiter/screening')
    revalidatePath('/recruiter/dashboard')
    return {}
  } catch (e) {
    // best-effort — never breaks the candidate's apply flow
    console.error('[screening] analyse automatique en échec', applicationId, e instanceof Error ? e.message : e)
    return { error: 'Analyse impossible pour le moment : réessayez dans quelques minutes' }
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
    if (!user || user.role !== 'recruiter') return { apps: [], job: null, existingResults: [], error: 'Non autorisé' }

    const { databases } = createAdminClient()

    const [jobDoc, appsResult] = await Promise.all([
      databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId),
      databases.listDocuments(DB_ID, COLLECTIONS.APPLICATIONS, [
        Query.equal('jobId', jobId), Query.orderDesc('$createdAt'), Query.limit(100),
      ]),
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

export async function screenAllApplications(jobId: string, appIds: string[]): Promise<{ results: ScreeningScore[]; errors: string[] }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') return { results: [], errors: ['Non autorisé'] }

  const { databases } = createAdminClient()
  const jobDoc = await databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId)
  const job = {
    title: jobDoc.title as string,
    description: jobDoc.description as string,
    skills: (jobDoc.skills as string[]) ?? [],
  }

  const results: ScreeningScore[] = []
  const errors: string[] = []

  for (const appId of appIds) {
    try {
      const appDoc = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, appId)

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

      const result = await screenApplication(toScreen)
      if ('error' in result) { errors.push(`${toScreen.candidateName}: ${result.error}`); continue }

      // Save to SCREENINGS collection, and mirror the score onto the
      // application doc itself so the dashboard's candidatures view shows
      // it without a trip to this screening page.
      try {
        await databases.createDocument(DB_ID, COLLECTIONS.SCREENINGS, ID.unique(), {
          applicationId: appId,
          jobId,
          tenantId: user.tenantId ?? '',
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
export async function exportScreeningCSV(results: ScreeningScore[]): Promise<string> {
  const header = ['Candidat', 'Email', 'Score', 'Recommandation', 'Résumé', 'Points forts', 'Points de vigilance']
  const rows = results.map(r => [
    r.candidateName,
    r.candidateEmail,
    String(r.score),
    r.recommendation,
    `"${r.summary.replace(/"/g, '""')}"`,
    `"${r.strengths.join(' | ')}"`,
    `"${r.concerns.join(' | ')}"`,
  ])
  return [header.join(','), ...rows.map(r => r.join(','))].join('\n')
}
