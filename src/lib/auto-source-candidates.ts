import type { Job } from '@/types'

// Only contact candidates the AI is genuinely confident about, and cap the volume per
// job so a single job posting can't blast the entire candidate base at once.
const AUTO_SOURCE_TOP_N = 5
const AUTO_SOURCE_MIN_SCORE = 65

// Fires automatically right after a job is created (mirrors tryAutoPostJobToLinkedIn's
// call sites and its silent-failure contract — sourcing must never block job creation).
export async function tryAutoSourceCandidates(job: Job & { $id: string }): Promise<void> {
  try {
    const { matchCandidatesForJob, generateOutreachMessageCore, sendOutreachEmailCore } = await import('@/lib/sourcing-core')

    const { matches } = await matchCandidatesForJob(job.$id)
    const top = matches.filter(m => m.score >= AUTO_SOURCE_MIN_SCORE).slice(0, AUTO_SOURCE_TOP_N)

    for (const match of top) {
      const { subject, message, error } = await generateOutreachMessageCore(match.candidateId, job.$id)
      if (error || !message) continue
      await sendOutreachEmailCore(match.candidateId, subject, message)
    }
  } catch {
    // best-effort — a sourcing failure must never break job creation
  }

  // "Matching IA" — persists the full ranked candidate pool for this job (not just the
  // top N contacted above) so the recruiter can browse it and pick who to screen.
  try {
    const { runPoolMatching } = await import('@/lib/matching-core')
    await runPoolMatching(job.$id)
  } catch {
    // best-effort — a matching failure must never break job creation
  }
}
