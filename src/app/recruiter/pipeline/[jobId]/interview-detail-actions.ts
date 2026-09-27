'use server'

import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import type { InterviewDetail, AdminInterviewRow } from '@/app/admin/interviews/actions'

// Recruiter-scoped mirrors of the admin interview-detail actions — same data shape (so the
// admin's InterviewDetailModal can be reused as-is via its getDetail/onAnalyze props), but
// gated on role === 'recruiter' + tenant ownership instead of role === 'admin'.

async function requireOwnedInterview(id: string) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) throw new Error('Non autorisé')
  const { databases } = createAdminClient()
  const doc = await databases.getDocument(DB_ID, COLLECTIONS.INTERVIEWS, id)
  if (doc.tenantId !== user.tenantId) throw new Error('Non autorisé')
  return { databases, doc }
}

export async function getInterviewDetailForRecruiter(id: string): Promise<{ detail: InterviewDetail | null; error?: string }> {
  try {
    const { doc } = await requireOwnedInterview(id)

    let questions: InterviewDetail['questions'] = []
    let transcript: InterviewDetail['transcript'] = []
    let analysis: InterviewDetail['analysis'] | undefined
    let rawRecordings: { questionIdx: number; fileId: string; role?: 'interviewer' | 'candidate'; mediaType?: 'audio' | 'video' }[] = []
    try { questions = JSON.parse(doc.questions as string ?? '[]') } catch { /* */ }
    try { transcript = JSON.parse(doc.transcript as string ?? '[]') } catch { /* */ }
    try { if (doc.analysis) analysis = JSON.parse(doc.analysis as string) } catch { /* */ }
    try { rawRecordings = JSON.parse((doc.recordings as string) ?? '[]') } catch { /* */ }

    const recordings = rawRecordings.map(r => ({ ...r, url: `/api/recording/${r.fileId}` }))

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
      },
    }
  } catch (e) {
    return { detail: null, error: e instanceof Error ? e.message : 'Erreur' }
  }
}

export async function analyzeInterviewForRecruiter(id: string): Promise<{ analysis?: InterviewDetail['analysis']; error?: string }> {
  try {
    await requireOwnedInterview(id)
    const { performInterviewAnalysis } = await import('@/app/admin/interviews/actions')
    return await performInterviewAnalysis(id)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}
