'use server'

import { callLLMForModule } from '@/lib/ai/llm-router'

// Tous les appels IA de ce fichier relèvent du module « Entretiens IA » (modèle réglable dans /admin/llm-config).
const callLLM = callLLMForModule('interview')
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { ID, Query } from 'node-appwrite'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { revalidatePath } from 'next/cache'
import { getEnabledGenericQuestions } from './generic-questions-actions'
import { updateApplicationStatus } from '@/lib/appwrite/jobs'
import { aiInterviewRecruiter, takeInterviewAiSlot } from '@/lib/interview-access'
import { aiQuestionPlan, analysisInputSchema, followUpInputSchema, orderInterviewQuestions, questionsInputSchema, sessionInputSchema } from '@/lib/interview-rules'
import { nullableReply, parseGeneratedQuestions, parseRecruiterAnalysis, questionGenerationPrompt, recruiterAnalysisPrompt, recruiterFollowUpPrompt } from '@/lib/interview-prompts'
import { applicationOfOrganisation } from '@/lib/screening-core'
import { loadOfferViewer } from '@/lib/offer-viewer'
import { funnelMoveRefusal } from '@/lib/appwrite/funnel'

export interface InterviewPrefill {
  candidateName: string
  candidateEmail: string
  jobTitle: string
  jobDescription: string
  jobSkills: string
  cvSummary: string
}

// Auto-fills the "new interview" form from a real application — candidate name/email
// and CV summary come from the application + candidate profile, job title/description/
// skills from the linked job posting. So the recruiter only has to pick the question
// count instead of retyping data the app already has.
export async function getInterviewPrefillData(applicationId: string): Promise<InterviewPrefill | { error: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: 'Non autorisé' }

  try {
    const { databases } = createAdminClient()
    // Candidature d'une offre de l'organisation du recruteur (ou partagée par la plateforme) seulement.
    const owned = await applicationOfOrganisation(applicationId, await loadOfferViewer(user))
    if (!owned) return { error: 'Candidature introuvable' }
    const { application, job } = owned
    const candidate = await databases.getDocument(DB_ID, COLLECTIONS.USERS, application.candidateId as string)

    let cvSummary = (application.aiSummary as string) ?? ''
    if (!cvSummary && application.cvFileId) {
      const { extractCVText } = await import('@/lib/sourcing-core')
      cvSummary = await extractCVText(application.cvFileId as string)
    }

    return {
      candidateName: `${candidate.firstName ?? ''} ${candidate.lastName ?? ''}`.trim(),
      candidateEmail: (candidate.email as string) ?? '',
      jobTitle: (job.title as string) ?? '',
      jobDescription: (job.description as string) ?? '',
      jobSkills: ((job.skills as string[]) ?? []).join(', '),
      cvSummary,
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Impossible de charger les données de la candidature' }
  }
}

export interface InterviewSession {
  $id: string
  applicationId: string
  jobId: string
  candidateName: string
  candidateEmail: string
  jobTitle: string
  status: 'pending' | 'in_progress' | 'completed' | 'analysed'
  questions: InterviewQuestion[]
  transcript: TranscriptEntry[]
  analysis?: InterviewAnalysis
  scheduledAt?: string
  completedAt?: string
  recordingFileId?: string
  recordings: { questionIdx: number; fileId: string; role?: 'interviewer' | 'candidate'; mediaType?: 'audio' | 'video' }[]
  createdAt: string
}

export interface InterviewQuestion {
  id: string
  text: string
  category: 'intro' | 'technical' | 'behavioral' | 'motivation' | 'closing'
  aiGenerated: boolean
}

export interface TranscriptEntry {
  role: 'interviewer' | 'candidate'
  content: string
  timestamp: string
  audioFileId?: string
}

export interface InterviewAnalysis {
  overallScore: number       // 0-100
  communicationScore: number
  technicalScore: number
  motivationScore: number
  culturalFitScore: number
  recommendation: 'hire' | 'consider' | 'reject'
  keyInsights: string[]
  redFlags: string[]
  summary: string
  nextSteps: string[]
  analysedBy: string
}

// ── Generate interview questions from job + CV ────────────────────
export async function generateInterviewQuestions(
  jobTitle: string,
  jobDescription: string,
  jobSkills: string[],
  cvSummary: string,
  questionCount = 8,
): Promise<InterviewQuestion[] | { error: string }> {
  try {
    // Recruteur dont la formule comprend les entretiens IA (avant le 2026-11-13, aucune vérification : l'IA était
    // appelable par n'importe qui).
    const me = await aiInterviewRecruiter()
    if ('error' in me) return { error: me.error }
    // Textes bornés (une description importée peut faire 60 000 caractères), 3 à 15 questions, puis quota du jour.
    const input = questionsInputSchema.safeParse({ jobTitle, jobDescription, jobSkills, cvSummary, questionCount })
    if (!input.success) return { error: 'Demande invalide : vérifiez le poste et le nombre de questions (3 à 15).' }
    const ask = input.data

    // Le nombre choisi est celui de tout l'entretien, questions par défaut de l'organisation comprises (aiQuestionPlan) :
    // l'IA n'écrit que les questions manquantes, et pas d'appel (ni de quota) quand les questions par défaut suffisent.
    const genericQuestions: InterviewQuestion[] = (await getEnabledGenericQuestions()).map(q => ({
      id: q.id, text: q.text, category: q.category, aiGenerated: false,
    }))
    const plan = aiQuestionPlan(ask.questionCount, genericQuestions.map(q => q.category))
    if (plan.count === 0) return genericQuestions.slice(0, ask.questionCount)

    const refused = await takeInterviewAiSlot(me)
    if (refused) return { error: refused }

    const prompt = questionGenerationPrompt({ ...ask, defaultQuestions: genericQuestions, plan })
    const { content } = await callLLM([{ role: 'user', content: prompt.user }], prompt.system, { feature: 'interview-questions', tenantId: me.tenantId })

    const aiQuestions = parseGeneratedQuestions(content, plan.count)
    if (!aiQuestions) return { error: 'Génération échouée' }

    return [...genericQuestions, ...aiQuestions]
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

// ── AI follow-up during interview ─────────────────────────────────
export async function getAIFollowUp(
  transcript: TranscriptEntry[],
  currentQuestion: InterviewQuestion,
  candidateAnswer: string,
): Promise<{ followUp: string | null }> {
  try {
    // Pas de relance hors d'une session de recruteur dont la formule comprend les entretiens IA.
    const me = await aiInterviewRecruiter()
    if ('error' in me) return { followUp: null }
    const input = followUpInputSchema.safeParse({ transcript, currentQuestion, candidateAnswer })
    if (!input.success) return { followUp: null }
    // Quota du jour atteint ou adresse non vérifiée : l'entretien continue, sans relance.
    if (await takeInterviewAiSlot(me)) return { followUp: null }
    const prompt = recruiterFollowUpPrompt({
      question: input.data.currentQuestion.text,
      answer: input.data.candidateAnswer,
      recentTurns: input.data.transcript,
    })
    const { content } = await callLLM([{ role: 'user', content: prompt.user }], prompt.system, { feature: 'interview-followup', tenantId: me.tenantId })
    return { followUp: nullableReply(content) }
  } catch (err) {
    // L'entretien continue sans relance ; la panne est journalisée.
    console.error('[entretiens] relance de l\'IA impossible', err instanceof Error ? err.message : String(err))
    return { followUp: null }
  }
}

// ── Analyse completed interview ───────────────────────────────────
export async function analyseInterview(
  sessionId: string,
  transcript: TranscriptEntry[],
  jobTitle: string,
  jobSkills: string[],
): Promise<InterviewAnalysis | { error: string }> {
  try {
    const me = await aiInterviewRecruiter()
    if ('error' in me) return { error: me.error }
    const input = analysisInputSchema.safeParse({ sessionId, transcript, jobTitle, jobSkills })
    if (!input.success) return { error: 'Retranscription invalide ou trop longue.' }
    const job = input.data
    // Entretien de l'organisation du recruteur seulement (avant le 2026-11-13 : tout compte connecté pouvait réécrire
    // l'analyse de n'importe quel entretien).
    const session = await createAdminClient().databases.getDocument(DB_ID, COLLECTIONS.INTERVIEWS, job.sessionId)
    if (session.tenantId !== me.tenantId) return { error: 'Non autorisé' }
    const refused = await takeInterviewAiSlot(me)
    if (refused) return { error: refused }

    const prompt = recruiterAnalysisPrompt(job)
    const { content, provider } = await callLLM([{ role: 'user', content: prompt.user }], prompt.system, { feature: 'interview-analysis', tenantId: me.tenantId })

    const analysis = parseRecruiterAnalysis(content, provider)
    if (!analysis) return { error: 'Analyse échouée' }

    // Enregistrée avec la retranscription ; un échec est dit au recruteur (avant : avalé, l'analyse se perdait au rechargement).
    try {
      const { databases } = createAdminClient()
      await databases.updateDocument(DB_ID, COLLECTIONS.INTERVIEWS, job.sessionId, {
        status: 'analysed',
        analysis: JSON.stringify(analysis),
        completedAt: new Date().toISOString(),
        transcript: JSON.stringify(job.transcript),
      })
    } catch (err) {
      console.error('[entretiens] analyse non enregistrée', job.sessionId, err instanceof Error ? err.message : String(err))
      return { error: 'Analyse faite mais non enregistrée : relancez-la dans quelques instants.' }
    }

    revalidatePath('/recruiter/interviews')
    return analysis
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

// ── Create interview session ──────────────────────────────────────
export async function createInterviewSession(
  applicationId: string,
  jobId: string,
  candidateName: string,
  candidateEmail: string,
  jobTitle: string,
  questions: InterviewQuestion[],
): Promise<{ sessionId: string } | { error: string }> {
  try {
    const me = await aiInterviewRecruiter()
    if ('error' in me) return { error: me.error }
    // Candidature liée : d'une offre de l'organisation du recruteur (ou partagée par la plateforme) seulement. Un
    // entretien créé sans candidature (« Nouvel entretien ») n'en a pas.
    const owned = applicationId ? await applicationOfOrganisation(applicationId, await loadOfferViewer(me.user)) : null
    if (applicationId && !owned) return { error: 'Candidature introuvable' }
    // Textes repris dans l'invitation au candidat : bornés et validés (adresse e-mail, 30 questions au plus).
    const input = sessionInputSchema.safeParse({ candidateName, candidateEmail, jobTitle, questions })
    if (!input.success) return { error: 'Entretien invalide : vérifiez le candidat, son adresse e-mail, le poste et les questions.' }
    if (!applicationId && !input.data.candidateEmail) return { error: 'Adresse e-mail du candidat requise.' }

    const { databases } = createAdminClient()
    const doc = await databases.createDocument(DB_ID, COLLECTIONS.INTERVIEWS, ID.unique(), {
      applicationId,
      tenantId: me.tenantId,
      candidateName: input.data.candidateName,
      candidateEmail: input.data.candidateEmail,
      jobTitle: input.data.jobTitle,
      status: 'pending',
      // Introduction en tête, clôture à la fin, quel que soit l'écran d'origine (nouvel entretien, pipeline, screening).
      questions: JSON.stringify(orderInterviewQuestions(input.data.questions)),
      transcript: '[]',
      createdAt: new Date().toISOString(),
    })

    // Reflect the invite on the application so the candidate dashboard shows
    // "Entretien" instead of staying stuck on "En attente" forever. Sauf si la règle du compte rendu (ADR 0040) l'interdit :
    // l'entretien est créé, la carte reste dans son étape du funnel.
    if (applicationId && owned && !(await funnelMoveRefusal(owned.application, me.tenantId, owned.application.jobId as string, 'interview'))) {
      await updateApplicationStatus(applicationId, 'interview')
    }

    revalidatePath('/recruiter/interviews')
    revalidatePath('/candidate/dashboard')
    return { sessionId: doc.$id }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

// Manual retry for a recruiter when the automatic post-interview analysis (triggered from
// saveInterviewProgress) failed or was skipped — e.g. the LLM provider was briefly down, or
// (until fixed) the analysis call used a different, unfunded API key than the one configured
// in /admin/llm-config. Recruiters had no way to retry before this; they'd be stuck with an
// interview that's "completed" but permanently unanalysed.
export async function retryInterviewAnalysis(sessionId: string): Promise<{ error?: string }> {
  const me = await aiInterviewRecruiter()
  if ('error' in me) return { error: me.error }
  if (typeof sessionId !== 'string' || !/^[\w-]{1,36}$/.test(sessionId)) return { error: 'Entretien introuvable' }

  const { databases } = createAdminClient()
  const doc = await databases.getDocument(DB_ID, COLLECTIONS.INTERVIEWS, sessionId)
  if (doc.tenantId !== me.tenantId) return { error: 'Non autorisé' }
  const refused = await takeInterviewAiSlot(me)
  if (refused) return { error: refused }

  const { performInterviewAnalysis } = await import('@/lib/interview-analysis')
  const res = await performInterviewAnalysis(sessionId)
  if (res.error) return { error: res.error }
  revalidatePath(`/recruiter/interviews/${sessionId}`)
  return {}
}

// ── Get sessions list ─────────────────────────────────────────────
export async function getInterviewSessions(): Promise<InterviewSession[]> {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'recruiter') return []

    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.INTERVIEWS, [
      Query.equal('tenantId', user.tenantId ?? ''),
      Query.orderDesc('$createdAt'),
      Query.limit(500),
    ])

    return result.documents.map(doc => ({
      $id: doc.$id,
      applicationId: doc.applicationId as string,
      jobId: doc.jobId as string,
      candidateName: doc.candidateName as string,
      candidateEmail: doc.candidateEmail as string,
      jobTitle: doc.jobTitle as string,
      status: doc.status as InterviewSession['status'],
      questions: JSON.parse((doc.questions as string) ?? '[]'),
      transcript: JSON.parse((doc.transcript as string) ?? '[]'),
      analysis: doc.analysis ? JSON.parse(doc.analysis as string) : undefined,
      scheduledAt: doc.scheduledAt as string | undefined,
      completedAt: doc.completedAt as string | undefined,
      recordingFileId: doc.recordingFileId as string | undefined,
      recordings: (() => {
        try { return JSON.parse((doc.recordings as string) ?? '[]') } catch { return [] }
      })(),
      createdAt: doc.$createdAt,
    }))
  } catch {
    return []
  }
}
