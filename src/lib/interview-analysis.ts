import 'server-only'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { callLLMForModule } from '@/lib/ai/llm-router'
import { interviewEndAnalysisPrompt, parseInterviewEndAnalysis } from '@/lib/interview-prompts'
import { revalidatePath } from 'next/cache'
import type { InterviewDetail } from '@/app/admin/interviews/actions'
import { organisationOf } from '@/lib/ai/usage'

// Tous les appels IA de ce fichier relèvent du module « Entretiens IA » (modèle réglable dans /admin/llm-config).
const callLLM = callLLMForModule('interview')

// Core analysis logic, no auth check — used both by the admin's manual "Analyser" button
// (analyzeInterview in /admin/interviews/actions) and automatically right after a candidate
// finishes an interview (see saveInterviewProgress in the public interview actions), which
// runs with no recruiter/admin session to check a role against. Callers do their own auth
// check; never export this from a 'use server' file (it would become a public endpoint).
export async function performInterviewAnalysis(id: string): Promise<{ analysis?: InterviewDetail['analysis']; error?: string }> {
  try {
    const { databases } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.INTERVIEWS, id)

    let transcript: InterviewDetail['transcript'] = []
    let questions: InterviewDetail['questions'] = []
    try { transcript = JSON.parse(doc.transcript as string ?? '[]') } catch { /* */ }
    try { questions = JSON.parse(doc.questions as string ?? '[]') } catch { /* */ }

    if (transcript.length === 0) return { error: 'Aucune transcription à analyser' }

    const prompt = interviewEndAnalysisPrompt({ jobTitle: doc.jobTitle as string, transcript })
    const { content } = await callLLM([{ role: 'user', content: prompt.user }], undefined, { feature: 'interview-analysis-auto', tenantId: organisationOf(String(doc.tenantId ?? '')) })

    const analysis = parseInterviewEndAnalysis(content)

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
