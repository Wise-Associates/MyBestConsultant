'use server'

import { callLLMForModule } from '@/lib/ai/llm-router'

// Tous les appels IA de ce fichier relèvent du module « Entretiens IA » (modèle réglable dans /admin/llm-config).
const callLLM = callLLMForModule('interview')
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { ID, Query } from 'node-appwrite'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { revalidatePath } from 'next/cache'
import { getEnabledGenericQuestions } from './generic-questions-actions'
import { updateApplicationStatus } from '@/lib/appwrite/jobs'

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
  if (!user || user.role !== 'recruiter') return { error: 'Non autorisé' }

  try {
    const { databases } = createAdminClient()
    const application = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId)

    const [job, candidate] = await Promise.all([
      databases.getDocument(DB_ID, COLLECTIONS.JOBS, application.jobId as string),
      databases.getDocument(DB_ID, COLLECTIONS.USERS, application.candidateId as string),
    ])

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
    const SYSTEM = `Tu es un expert RH spécialisé dans les entretiens IT et conseil.
Génère des questions d'entretien pertinentes et retourne un JSON valide.

Réponds UNIQUEMENT avec un tableau JSON :
[
  {
    "id": "q1",
    "text": "string — question claire et précise",
    "category": "intro"|"technical"|"behavioral"|"motivation"|"closing"
  }
]

Distribution recommandée pour ${questionCount} questions :
- 1 intro (présentation)
- ${Math.round(questionCount * 0.35)} technical (compétences techniques du poste)
- ${Math.round(questionCount * 0.30)} behavioral (situations passées, STAR method)
- ${Math.round(questionCount * 0.20)} motivation (pourquoi ce poste/entreprise)
- 1 closing (questions du candidat, suite)

Adapte les questions techniques aux compétences requises.
Utilise la méthode STAR pour les questions comportementales.`

    const { content } = await callLLM([{
      role: 'user',
      content: `POSTE : ${jobTitle}\nCompétences : ${jobSkills.join(', ')}\nDescription : ${jobDescription}\n\nRÉSUMÉ CV : ${cvSummary}\n\nGénère exactement ${questionCount} questions.`,
    }], SYSTEM)

    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return { error: 'Génération échouée' }

    const aiQuestions: InterviewQuestion[] = JSON.parse(jsonMatch[0]).map((q: InterviewQuestion, i: number) => ({
      ...q,
      id: q.id ?? `q${i + 1}`,
      aiGenerated: true,
    }))

    const genericQuestions: InterviewQuestion[] = (await getEnabledGenericQuestions()).map(q => ({
      id: q.id, text: q.text, category: q.category, aiGenerated: false,
    }))

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
    const lastAnswers = transcript.slice(-4).map(t => `${t.role === 'interviewer' ? 'Q' : 'R'}: ${t.content}`).join('\n')

    const { content } = await callLLM([{
      role: 'user',
      content: `Question posée : "${currentQuestion.text}"\nRéponse du candidat : "${candidateAnswer}"\n\nContexte récent :\n${lastAnswers}`,
    }], `Tu es un interviewer IA expert. Analyse la réponse du candidat.
Si la réponse est incomplète, vague ou mérite d'être approfondie, génère UNE question de relance courte et précise.
Si la réponse est complète et satisfaisante, réponds exactement : null

Réponds soit avec la question de relance (texte simple), soit avec le mot "null".`)

    const text = content.trim()
    return { followUp: text === 'null' || text === '' ? null : text }
  } catch {
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
    const user = await getCurrentUser()
    if (!user) return { error: 'Non autorisé' }

    const transcriptText = transcript
      .map(t => `[${t.role === 'interviewer' ? 'INTERVIEWER' : 'CANDIDAT'}] ${t.content}`)
      .join('\n')

    const SYSTEM = `Tu es un expert RH analysant la retranscription d'un entretien. Retourne un JSON valide uniquement.

{
  "overallScore": number (0-100),
  "communicationScore": number (0-100),
  "technicalScore": number (0-100),
  "motivationScore": number (0-100),
  "culturalFitScore": number (0-100),
  "recommendation": "hire"|"consider"|"reject",
  "keyInsights": ["string"] (max 5 observations clés positives),
  "redFlags": ["string"] (max 3 signaux d'alerte),
  "summary": "string (3-4 phrases de synthèse)",
  "nextSteps": ["string"] (2-3 recommandations d'actions)
}`

    const { content, provider } = await callLLM([{
      role: 'user',
      content: `POSTE : ${jobTitle}\nCompétences requises : ${jobSkills.join(', ')}\n\nRETRANSCRIPTION :\n${transcriptText}`,
    }], SYSTEM)

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { error: 'Analyse échouée' }

    const parsed = JSON.parse(jsonMatch[0])
    const analysis: InterviewAnalysis = {
      overallScore: Math.min(100, Math.max(0, Number(parsed.overallScore) || 0)),
      communicationScore: Math.min(100, Math.max(0, Number(parsed.communicationScore) || 0)),
      technicalScore: Math.min(100, Math.max(0, Number(parsed.technicalScore) || 0)),
      motivationScore: Math.min(100, Math.max(0, Number(parsed.motivationScore) || 0)),
      culturalFitScore: Math.min(100, Math.max(0, Number(parsed.culturalFitScore) || 0)),
      recommendation: parsed.recommendation ?? 'consider',
      keyInsights: Array.isArray(parsed.keyInsights) ? parsed.keyInsights.slice(0, 5) : [],
      redFlags: Array.isArray(parsed.redFlags) ? parsed.redFlags.slice(0, 3) : [],
      summary: String(parsed.summary ?? ''),
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps.slice(0, 3) : [],
      analysedBy: provider,
    }

    // Save analysis to DB
    try {
      const { databases } = createAdminClient()
      await databases.updateDocument(DB_ID, COLLECTIONS.INTERVIEWS, sessionId, {
        status: 'analysed',
        analysis: JSON.stringify(analysis),
        completedAt: new Date().toISOString(),
        transcript: JSON.stringify(transcript),
      })
    } catch { /* collection may need setup */ }

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
    const user = await getCurrentUser()
    if (!user || user.role !== 'recruiter') return { error: 'Non autorisé' }

    const { databases } = createAdminClient()
    const doc = await databases.createDocument(DB_ID, COLLECTIONS.INTERVIEWS, ID.unique(), {
      applicationId,
      tenantId: user.tenantId ?? '',
      candidateName,
      candidateEmail,
      jobTitle,
      status: 'pending',
      questions: JSON.stringify(questions),
      transcript: '[]',
      createdAt: new Date().toISOString(),
    })

    // Reflect the invite on the application so the candidate dashboard shows
    // "Entretien" instead of staying stuck on "En attente" forever.
    await updateApplicationStatus(applicationId, 'interview')

    revalidatePath('/recruiter/interviews')
    revalidatePath('/candidate/dashboard')
    return { sessionId: doc.$id }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

// ── Save recording upload URL ─────────────────────────────────────
export async function saveRecordingUrl(sessionId: string, fileId: string): Promise<void> {
  try {
    const { databases } = createAdminClient()
    await databases.updateDocument(DB_ID, COLLECTIONS.INTERVIEWS, sessionId, { recordingFileId: fileId })
  } catch { /* ignore */ }
}

// Manual retry for a recruiter when the automatic post-interview analysis (triggered from
// saveInterviewProgress) failed or was skipped — e.g. the LLM provider was briefly down, or
// (until fixed) the analysis call used a different, unfunded API key than the one configured
// in /admin/llm-config. Recruiters had no way to retry before this; they'd be stuck with an
// interview that's "completed" but permanently unanalysed.
export async function retryInterviewAnalysis(sessionId: string): Promise<{ error?: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') return { error: 'Non autorisé' }

  const { databases } = createAdminClient()
  const doc = await databases.getDocument(DB_ID, COLLECTIONS.INTERVIEWS, sessionId)
  if (doc.tenantId !== user.tenantId) return { error: 'Non autorisé' }

  const { performInterviewAnalysis } = await import('@/app/admin/interviews/actions')
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
