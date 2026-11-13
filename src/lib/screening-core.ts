import 'server-only'
import { revalidatePath } from 'next/cache'
import { ID, type Models } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { notificationUserId } from '@/lib/candidate-identity'
import { wrapEmailHtml } from '@/lib/email-template'
import { aiInterviewDenial } from '@/lib/interview-access'
import { recruiterCanSeeApplication } from '@/lib/job-ownership'
import { recommendationFor, type Judgement } from '@/lib/match-scoring'
import { withRecommendationBonus } from '@/lib/recommendation-boost'
import { cvScorer, readCvForScoring } from '@/lib/sourcing-core'

// Notation des candidatures (screening manuel et automatique) et contrôle d'accès à une candidature. Hors des fichiers
// « use server » (revue de sécurité du 2026-11-13) : `autoScreenApplication`, appelée sans session après une
// candidature, ne doit pas être un point d'entrée public ; la notation lit le CV indiqué, jamais au choix du navigateur.

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const isNotFound = (err: unknown) => (err as { code?: number } | null)?.code === 404

/**
 * Candidature `applicationId` et son offre, si un recruteur de l'organisation `tenantId` peut la voir
 * (recruiterCanSeeApplication : offre de son organisation, ou offre partagée et candidature à lui ou directe) ; null
 * sinon, ou si l'une est introuvable. Avant le 2026-11-13, les actions du screening, des entretiens et du pipeline
 * agissaient sur n'importe quelle candidature.
 */
export async function applicationOfOrganisation(applicationId: unknown, tenantId: string): Promise<{ application: Models.Document; job: Models.Document } | null> {
  if (typeof applicationId !== 'string' || !/^[\w-]{1,36}$/.test(applicationId)) return null
  const { databases } = createAdminClient()
  try {
    const application = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId)
    const job = await databases.getDocument(DB_ID, COLLECTIONS.JOBS, application.jobId as string)
    const jobTenantId = typeof job.tenantId === 'string' ? job.tenantId : ''
    const applicationTenantId = typeof application.tenantId === 'string' ? application.tenantId : ''
    return recruiterCanSeeApplication(jobTenantId, applicationTenantId, tenantId) ? { application, job } : null
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

/** Compte Auth à qui écrire pour une candidature (le candidat, ou le chasseur pour un profil de son vivier). */
export async function getCandidateAuthUserId(applicationId: string): Promise<string | null> {
  const { databases } = createAdminClient()
  const appDoc = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId)
  const userDoc = await databases.getDocument(DB_ID, COLLECTIONS.USERS, appDoc.candidateId as string)
  // Profil du vivier d'un chasseur : la notification part au chasseur, l'intermédiaire.
  return notificationUserId(userDoc as unknown as Record<string, unknown>)
}


// Personalized congratulations email, sent automatically to candidates who
// score 70+ during screening — no recruiter action needed.
export async function sendAutoScreeningEmail(applicationId: string, result: {
  candidateName: string
  jobTitle: string
  score: number
  strengths: string[]
  plainSummary?: string
}): Promise<void> {
  const candidateAuthId = await getCandidateAuthUserId(applicationId)
  if (!candidateAuthId) return

  const topStrength = result.strengths[0]
  // Textes de l'offre, du profil et de l'IA échappés : ils ne doivent pas pouvoir insérer de lien ni de balise.
  const body = `
    <p style="margin:0 0 24px; font-size:14px; line-height:1.7; color:#45454A;">
      Bonjour ${escapeHtml(result.candidateName)},<br><br>
      Nous avons analysé votre candidature pour le poste de <strong>${escapeHtml(result.jobTitle)}</strong> et votre profil a particulièrement retenu notre attention (score de compatibilité : <strong>${result.score}/100</strong>).<br><br>
      ${escapeHtml(result.plainSummary ?? '')}
      ${topStrength ? `<br><br>Point fort identifié : ${escapeHtml(topStrength)}` : ''}
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

// Notation d'une candidature, pour le screening manuel (screenAllApplications, après ses contrôles) et automatique.
// La notation de la base candidats et du vivier de l'offre (cvScorer, ADR 0029) : même consigne, même modèle, même texte
// du CV ; ni lettre de motivation ni critère ajouté. Puis le bonus des recommandations, la même règle que sur le Matching IA.
export async function scoreApplication(app: ApplicationToScreen): Promise<ScreeningScore | { error: string }> {
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
    // Formule de l'organisation de l'offre (plans.ts), lue sur l'offre : l'organisation de la candidature vient de la
    // demande du candidat. Offre partagée par la plateforme : celle qui a ajouté le candidat, sinon toujours analysée.
    const planTenantId = (typeof jobDoc.tenantId === 'string' && jobDoc.tenantId) || (typeof appDoc.tenantId === 'string' ? appDoc.tenantId : '')
    if (planTenantId) {
      const denial = await aiInterviewDenial(planTenantId)
      if (denial) return { error: denial }
    }

    let candidateName = `Candidat #${(appDoc.candidateId as string).slice(-6)}`
    let candidateEmail = ''
    try {
      const userDoc = await databases.getDocument(DB_ID, COLLECTIONS.USERS, appDoc.candidateId as string)
      candidateName = `${userDoc.firstName ?? ''} ${userDoc.lastName ?? ''}`.trim() || candidateName
      candidateEmail = (userDoc.email as string) ?? ''
    } catch { /* user not found */ }

    const result = await scoreApplication({
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
