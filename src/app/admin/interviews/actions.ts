'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { callLLMForModule } from '@/lib/ai/llm-router'

// Tous les appels IA de ce fichier relèvent du module « Entretiens IA » (modèle réglable dans /admin/llm-config).
const callLLM = callLLMForModule('interview')
import { revalidatePath } from 'next/cache'

export interface AdminInterviewRow {
  id: string
  candidateName: string
  candidateEmail: string
  jobTitle: string
  status: 'pending' | 'in_progress' | 'completed' | 'analysed'
  createdAt: string
  completedAt?: string
  questionCount: number
  transcriptLength: number   // nb d'échanges
  tenantId: string
}

export interface AdminInterviewStats {
  total: number
  pending: number
  inProgress: number
  completed: number
  analysed: number
  completionRate: number
  avgTranscriptLength: number
  byJob: { title: string; count: number; completedCount: number }[]
  last7days: number
}

export interface InterviewDetail {
  id: string
  candidateName: string
  candidateEmail: string
  jobTitle: string
  status: AdminInterviewRow['status']
  createdAt: string
  completedAt?: string
  questions: { id: string; text: string; category: string; aiGenerated: boolean }[]
  transcript: { role: 'interviewer' | 'candidate'; content: string; timestamp: string }[]
  recordings: { questionIdx: number; fileId: string; url: string; role?: 'interviewer' | 'candidate'; mediaType?: 'audio' | 'video' }[]
  analysis?: {
    overallScore: number
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
}

export async function getInterviewDetail(id: string): Promise<{ detail: InterviewDetail | null; error?: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') return { detail: null, error: 'Non autorisé' }
  try {
    const { databases } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.INTERVIEWS, id)
    let questions: InterviewDetail['questions'] = []
    let transcript: InterviewDetail['transcript'] = []
    let analysis: InterviewDetail['analysis'] | undefined
    let rawRecordings: { questionIdx: number; fileId: string; role?: 'interviewer' | 'candidate'; mediaType?: 'audio' | 'video' }[] = []
    try { questions = JSON.parse(doc.questions as string ?? '[]') } catch { /* */ }
    try { transcript = JSON.parse(doc.transcript as string ?? '[]') } catch { /* */ }
    try { if (doc.analysis) analysis = JSON.parse(doc.analysis as string) } catch { /* */ }
    try { rawRecordings = JSON.parse((doc.recordings as string) ?? '[]') } catch { /* */ }

    const recordings = rawRecordings.map(r => ({
      ...r,
      url: `/api/recording/${r.fileId}`,
    }))

    return {
      detail: {
        id: doc.$id,
        candidateName: doc.candidateName as string,
        candidateEmail: doc.candidateEmail as string,
        jobTitle: doc.jobTitle as string,
        status: doc.status as AdminInterviewRow['status'],
        createdAt: doc.createdAt as string || doc.$createdAt,
        completedAt: doc.completedAt as string | undefined,
        questions,
        transcript,
        recordings,
        analysis,
      }
    }
  } catch (e) {
    return { detail: null, error: e instanceof Error ? e.message : 'Erreur' }
  }
}

export async function getAdminInterviews(): Promise<{
  rows: AdminInterviewRow[]
  stats: AdminInterviewStats
  error?: string
}> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') return { rows: [], stats: emptyStats(), error: 'Non autorisé' }

  try {
    const { databases } = createAdminClient()

    // Fetch all interviews (no tenant filter — admin voit tout dans son scope)
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.INTERVIEWS, [
      Query.orderDesc('$createdAt'),
      Query.limit(200),
    ])

    const rows: AdminInterviewRow[] = result.documents.map(doc => {
      let questionCount = 0
      let transcriptLength = 0
      try { questionCount = JSON.parse(doc.questions as string ?? '[]').length } catch { /* */ }
      try { transcriptLength = JSON.parse(doc.transcript as string ?? '[]').length } catch { /* */ }

      return {
        id: doc.$id,
        candidateName: (doc.candidateName as string) || 'Candidat inconnu',
        candidateEmail: (doc.candidateEmail as string) || '',
        jobTitle: (doc.jobTitle as string) || '—',
        status: (doc.status as AdminInterviewRow['status']) || 'pending',
        createdAt: doc.createdAt as string || doc.$createdAt,
        completedAt: doc.completedAt as string | undefined,
        questionCount,
        transcriptLength,
        tenantId: (doc.tenantId as string) || '',
      }
    })

    const stats = computeStats(rows)
    return { rows, stats }
  } catch (e) {
    return { rows: [], stats: emptyStats(), error: e instanceof Error ? e.message : 'Erreur' }
  }
}

function computeStats(rows: AdminInterviewRow[]): AdminInterviewStats {
  const total = rows.length
  const pending = rows.filter(r => r.status === 'pending').length
  const inProgress = rows.filter(r => r.status === 'in_progress').length
  const completed = rows.filter(r => r.status === 'completed').length
  const analysed = rows.filter(r => r.status === 'analysed').length
  const done = completed + analysed
  const completionRate = total > 0 ? Math.round((done / total) * 100) : 0
  const avgTranscriptLength = total > 0
    ? Math.round(rows.reduce((s, r) => s + r.transcriptLength, 0) / total)
    : 0

  // By job
  const jobMap = new Map<string, { count: number; completedCount: number }>()
  for (const r of rows) {
    const cur = jobMap.get(r.jobTitle) ?? { count: 0, completedCount: 0 }
    cur.count++
    if (r.status === 'completed' || r.status === 'analysed') cur.completedCount++
    jobMap.set(r.jobTitle, cur)
  }
  const byJob = [...jobMap.entries()]
    .map(([title, v]) => ({ title, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const last7days = rows.filter(r => r.createdAt > sevenDaysAgo).length

  return { total, pending, inProgress, completed, analysed, completionRate, avgTranscriptLength, byJob, last7days }
}

function emptyStats(): AdminInterviewStats {
  return { total: 0, pending: 0, inProgress: 0, completed: 0, analysed: 0, completionRate: 0, avgTranscriptLength: 0, byJob: [], last7days: 0 }
}

// Core analysis logic, no auth check — used both by the admin's manual "Analyser" button
// (analyzeInterview below) and automatically right after a candidate finishes an interview
// (see saveInterviewProgress in the public interview actions), which runs with no
// recruiter/admin session to check a role against.
export async function performInterviewAnalysis(id: string): Promise<{ analysis?: InterviewDetail['analysis']; error?: string }> {
  try {
    const { databases } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.INTERVIEWS, id)

    let transcript: InterviewDetail['transcript'] = []
    let questions: InterviewDetail['questions'] = []
    try { transcript = JSON.parse(doc.transcript as string ?? '[]') } catch { /* */ }
    try { questions = JSON.parse(doc.questions as string ?? '[]') } catch { /* */ }

    if (transcript.length === 0) return { error: 'Aucune transcription à analyser' }

    const convo = transcript.map(t =>
      `${t.role === 'interviewer' ? 'Alex (recruteur)' : 'Candidat'}: ${t.content}`
    ).join('\n\n')

    const { content } = await callLLM([{
      role: 'user',
      content: `Tu es un expert RH. Analyse cette transcription d'entretien pour le poste "${doc.jobTitle as string}".

TRANSCRIPTION:
${convo}

Réponds UNIQUEMENT avec ce JSON valide (sans markdown, sans commentaires):
{
  "overallScore": <0-100>,
  "communicationScore": <0-100>,
  "technicalScore": <0-100>,
  "motivationScore": <0-100>,
  "culturalFitScore": <0-100>,
  "recommendation": <"hire"|"consider"|"reject">,
  "summary": "<résumé en 2-3 phrases>",
  "keyInsights": ["<point fort 1>", "<point fort 2>", "<point fort 3>"],
  "redFlags": ["<point attention 1>"],
  "nextSteps": ["<étape 1>", "<étape 2>"],
  "analysedBy": "Claude AI"
}`,
    }])

    // Strip markdown code fences if present
    const raw = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const analysis: InterviewDetail['analysis'] = JSON.parse(raw)

    await databases.updateDocument(DB_ID, COLLECTIONS.INTERVIEWS, id, {
      analysis: JSON.stringify(analysis),
      status: 'analysed',
    })

    // Refreshes the Kanban's cached data so the result shows up next time the recruiter
    // opens/reloads it — the interview happens on the candidate's own session, so there's
    // no way to push the update into an already-open recruiter tab.
    try {
      if (doc.applicationId) {
        const application = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, doc.applicationId as string)
        revalidatePath(`/recruiter/pipeline/${application.jobId}`)
      }
    } catch { /* best-effort */ }

    return { analysis }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'analyse' }
  }
}

export async function analyzeInterview(id: string): Promise<{ analysis?: InterviewDetail['analysis']; error?: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Non autorisé' }
  return performInterviewAnalysis(id)
}
