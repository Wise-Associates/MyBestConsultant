import 'server-only'
import { Query } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { getSocialConfig, isMakeConfigured, latestSocialStateByJob } from '@/lib/social'
import { SOURCING_MIN_SCORE } from '@/lib/sourcing-rules'
import { batchByLength } from './repo'
import { trackingSteps, type AoTrackingFacts, type TrackingStep } from './tracking'
import type { AoOfferStatus } from './types'

/**
 * Étapes de suivi des offres publiées de `rows` (colonne « Suivi » du tableau AO, section du panneau), à l'heure `now`.
 * `rows` vient de loadAoView, déjà limité aux boîtes de l'organisation de l'appelant : seules ses offres publiques sont
 * lues. Lectures par lots : offre publique (en ligne ?), dernière diffusion, scores du sourcing. Les offres non publiées
 * n'ont rien à relire : le tableau calcule leurs étapes lui-même. Les erreurs remontent à la page, avec la lecture en
 * cause.
 */
export async function loadAoTracking(
  rows: { $id: string; status: AoOfferStatus; jobId: string | null }[],
  now = Date.now(),
): Promise<Record<string, TrackingStep[]>> {
  const published = rows.filter((r): r is typeof r & { jobId: string } => r.jobId !== null)
  if (!published.length) return {}
  const batches = batchByLength([...new Set(published.map(r => r.jobId))])
  const [jobs, social, scores, socialAuto] = await Promise.all([
    labelled('offres publiques (jobs)', readJobs(batches)),
    labelled('diffusions (social_posts)', Promise.all(batches.map(latestSocialStateByJob)).then(maps => new Map(maps.flatMap(m => [...m])))),
    labelled('sourcing (job_matches)', readScores(batches)),
    // Réglage relu comme le fait la publication automatique (tryAutoPublishJob).
    isMakeConfigured() ? getSocialConfig().then(cfg => cfg.autoPublish) : Promise.resolve(false),
  ])
  return Object.fromEntries(published.map(r => {
    const score = scores.get(r.jobId)
    const facts: AoTrackingFacts = {
      job: jobs.get(r.jobId) ?? null, social: social.get(r.jobId) ?? null, scored: !!score, qualified: score?.qualified ?? 0,
    }
    return [r.$id, trackingSteps(r, facts, { now, socialAuto })]
  }))
}

/** La page journalise l'erreur : elle doit dire quelle lecture a échoué. */
function labelled<T>(read: string, promise: Promise<T>): Promise<T> {
  return promise.catch((err: unknown) => {
    const code = (err as { code?: unknown }).code
    throw new Error(`${read} : ${err instanceof Error ? err.message : String(err)}${code ? ` (code ${code})` : ''}`, { cause: err })
  })
}

async function readJobs(batches: string[][]): Promise<Map<string, NonNullable<AoTrackingFacts['job']>>> {
  const { databases } = createAdminClient()
  const pages = await Promise.all(batches.map(batch => databases.listDocuments(DB_ID, COLLECTIONS.JOBS, [
    // Avec Query.select, Appwrite ne renvoie que les champs nommés, $id et dates comprises.
    Query.equal('$id', batch), Query.select(['$id', '$createdAt', 'isActive', 'expiresAt', 'linkedinPostedAt']), Query.limit(batch.length),
  ])))
  const text = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return new Map(pages.flatMap(p => p.documents).map(d => [d.$id, {
    isActive: d.isActive === true, expiresAt: text(d.expiresAt), createdAt: d.$createdAt, linkedinPostedAt: text(d.linkedinPostedAt),
  }]))
}

/**
 * Un sourcing note au plus 30 candidats (MAX_CANDIDATES, sourcing-core.ts) ; 200 lignes par offre laissent de la marge
 * (deux calculs simultanés). La lecture est bornée quoi que contienne job_matches : la collection a encore des
 * permissions client (correction en attente), un nombre arbitraire de lignes ne doit pas allonger le rendu de la page.
 */
const MAX_SCORES_PER_JOB = 200

/** Par offre publique ayant des scores : nombre de candidats de la base notés SOURCING_MIN_SCORE ou plus. */
async function readScores(batches: string[][]): Promise<Map<string, { qualified: number }>> {
  const { databases } = createAdminClient()
  const scores = new Map<string, { qualified: number }>()
  const PAGE = 500
  await Promise.all(batches.map(async batch => {
    let cursor: string | undefined
    for (let page = 0; page < Math.ceil((batch.length * MAX_SCORES_PER_JOB) / PAGE); page++) {
      const res = await databases.listDocuments(DB_ID, COLLECTIONS.JOB_MATCHES, [
        Query.equal('jobId', batch), Query.select(['$id', 'jobId', 'score']), Query.limit(PAGE), ...(cursor ? [Query.cursorAfter(cursor)] : []),
      ])
      for (const d of res.documents) {
        const entry = scores.get(d.jobId as string) ?? { qualified: 0 }
        if (typeof d.score === 'number' && d.score >= SOURCING_MIN_SCORE) entry.qualified++
        scores.set(d.jobId as string, entry)
      }
      if (res.documents.length < PAGE) return
      cursor = res.documents[res.documents.length - 1].$id
    }
  }))
  return scores
}
