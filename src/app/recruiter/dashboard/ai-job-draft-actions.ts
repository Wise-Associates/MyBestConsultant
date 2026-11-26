'use server'

import { callLLM } from '@/lib/ai/llm-router'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { jobDraftPrompt, jobImprovePrompt, parseJobDraftAnswer, type JobDraft } from '@/lib/job-draft-prompts'

export type { JobDraft } from '@/lib/job-draft-prompts'

// Structured job-posting generation from short recruiter input, reviewed/editable in the
// create-job dialog before publishing — same shape as /admin/jobs' file-based extraction,
// but driven by a short text prompt instead of an uploaded document.
export async function generateJobDraft(
  prompt: string,
  regenerateFrom?: JobDraft,
): Promise<{ draft: JobDraft } | { error: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') return { error: 'Non autorisé' }

  const trimmed = prompt.trim()
  if (!trimmed) return { error: 'Décrivez le besoin en quelques mots' }

  try {
    const { system, user: userMsg } = jobDraftPrompt({ need: trimmed, previousDraft: regenerateFrom })
    const { content } = await callLLM([{ role: 'user', content: userMsg }], system)
    return parseJobDraftAnswer(content)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur de génération' }
  }
}

// "Améliorer l'offre" — takes whatever is currently in the form (typed manually, imported
// from the library, or already AI-generated) and reworks it per the recruiter's instruction.
// Unlike generateJobDraft, it covers every field of the form (title, location, contractType,
// remote, salary, skills, description) so a single prompt can target any of them.
export async function improveJobDraft(
  prompt: string,
  currentDraft: JobDraft,
): Promise<{ draft: JobDraft } | { error: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') return { error: 'Non autorisé' }

  const trimmed = prompt.trim()
  if (!trimmed) return { error: 'Décrivez ce que l\'IA doit améliorer' }
  if (!currentDraft.title.trim() && !currentDraft.description.trim()) {
    return { error: 'Rédigez d\'abord un titre ou une description à améliorer' }
  }

  try {
    const { system, user: userMsg } = jobImprovePrompt({ request: trimmed, currentDraft })
    const { content } = await callLLM([{ role: 'user', content: userMsg }], system)
    return parseJobDraftAnswer(content)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur d\'amélioration' }
  }
}
