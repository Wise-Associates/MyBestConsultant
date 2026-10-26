import type { Job } from '@/types'
import type { MatchResult } from '@/lib/sourcing-core'
import { bestMatches } from '@/lib/sourcing-rules'

// Only contact candidates the AI is genuinely confident about, and cap the volume per
// job so a single job posting can't blast the entire candidate base at once.

// Fires automatically right after a job is created (mirrors tryAutoPostJobToLinkedIn's
// call sites and its silent-failure contract — sourcing must never block job creation).
// Runs in after() for AO publications: nobody waits for it there, so failures are logged.
export async function tryAutoSourceCandidates(job: Job & { $id: string }): Promise<void> {
  let ranking: MatchResult | undefined
  try {
    const { matchCandidatesForJob, generateOutreachMessageCore, sendOutreachEmailCore } = await import('@/lib/sourcing-core')

    ranking = await matchCandidatesForJob(job.$id)
    const top = bestMatches(ranking.matches)

    for (const match of top) {
      const { subject, message, error } = await generateOutreachMessageCore(match.candidateId, job.$id)
      if (error || !message) continue
      await sendOutreachEmailCore(match.candidateId, subject, message)
    }
  } catch (e) {
    // best-effort — a sourcing failure must never break job creation
    console.error('[sourcing] sourcing automatique échoué', job.$id, e instanceof Error ? e.message : e)
  }

  // "Matching IA" — persists the full ranked candidate pool for this job (not just the
  // top N contacted above) so the recruiter can browse it and pick who to screen. Reuses the
  // ranking above instead of a second identical AI call on the same CVs (about 1 min).
  try {
    const { runPoolMatching } = await import('@/lib/matching-core')
    const run = await runPoolMatching(job.$id, ranking)
    if (run.error) console.warn('[sourcing] matching de la base candidats non enregistré', job.$id, run.error)
  } catch (e) {
    // best-effort — a matching failure must never break job creation
    console.error('[sourcing] matching de la base candidats échoué', job.$id, e instanceof Error ? e.message : e)
  }
}
