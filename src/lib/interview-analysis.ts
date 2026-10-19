import 'server-only'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { callLLMForModule } from '@/lib/ai/llm-router'
import { revalidatePath } from 'next/cache'
import type { InterviewDetail } from '@/app/admin/interviews/actions'

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
