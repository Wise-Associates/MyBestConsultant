import { redirect, notFound } from 'next/navigation'
import { after } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getJobById, jobTabCounts } from '@/lib/appwrite/jobs'
import { getJobMatches, unmatchedApplicationIds } from '@/lib/matching-core'
import { autoScreenApplication } from '@/lib/screening-core'
import { isJobWeightsConfigured, loadWeightsForJob } from '@/lib/scoring-weights-store'
import { MatchingClient } from './matching-client'
import { jobMetaLine } from '@/components/recruiter/job-tabs'
import { viewerCanOpenJob } from '@/lib/job-ownership'
import { loadOfferViewer } from '@/lib/offer-viewer'
import { isAutoMatchingEnabled } from '@/lib/ai-matches-store'
import { loadCriteriaContext } from '@/lib/criteria-rescore'
import { defaultCriteriaSet } from '@/lib/offer-criteria'

// « Rafraîchir » : un appel d'IA par candidat de la base, 5 à la fois (sourcing-core.ts), dans chacune de ses deux requêtes.
export const maxDuration = 300

export default async function MatchingPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  const job = await getJobById(jobId)
  if (!job) notFound()
  // Offre que le recruteur ouvre (ADR 0043 : un membre, les siennes seulement).
  if (!viewerCanOpenJob(job, await loadOfferViewer(user))) redirect('/recruiter/dashboard')

  // Scores aux poids du recruteur : ceux du candidat, sinon de l'offre (colonne de droite), sinon globaux (bouton du bandeau).
  const [saved, tabCounts] = await Promise.all([loadWeightsForJob(user.userId, jobId), jobTabCounts(job, user.tenantId)])
  const { weights, global, job: jobWeights, candidates, unreadable, jobUnreadable, candidatesUnreadable } = saved
  // Critères de l'offre et les miens (ADR 0061) : détail de ses scores ; critères de l'offre illisibles, la page s'arrête
  // (error.tsx) plutôt que de montrer les scores comme notés sur le barème.
  const criteria = await loadCriteriaContext(jobId, saved)
  const { matches } = await getJobMatches(jobId, user.tenantId, user.$id, weights, candidates, criteria ?? undefined)

  // Toute candidature doit avoir son matching : celles que l'analyse automatique a manquées sont relancées en tâche de fond.
  const retry = unmatchedApplicationIds(matches)
  if (retry.length > 0) after(async () => { for (const id of retry) await autoScreenApplication(id) })

  // Remonté quand le recruteur change ses poids (router.refresh) : la liste, gardée dans l'état du client, reprend ses
  // scores. Ses critères (ADR 0061) : la liste reprend celle du serveur sans remonter la page (onglet, messages gardés).
  return <MatchingClient key={JSON.stringify(weights)} jobId={jobId} jobTitle={job.title} jobMeta={jobMetaLine(job)} jobSkills={job.skills ?? []}
    initialMatches={matches} tabCounts={tabCounts ?? undefined} weights={weights} weightsUnreadable={unreadable} globalWeights={global}
    jobWeights={isJobWeightsConfigured() ? { weights: jobWeights, unreadable: jobUnreadable, candidates, candidatesUnreadable } : undefined} now={new Date().toISOString()}
    reviewEnabled={isAutoMatchingEnabled() && job.tenantId === user.tenantId}
    criteria={criteria && { general: criteria.general, own: criteria.own, candidates: criteria.candidates }}
    criteriaStart={defaultCriteriaSet({ title: job.title, skills: job.skills ?? [], location: job.location })}
    canEditCriteria={job.tenantId === user.tenantId} />
}
