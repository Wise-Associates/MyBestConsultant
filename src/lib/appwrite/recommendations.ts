import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import type { Recommendation } from '@/types'

const parseExpertises = (raw: unknown): { requested: string[]; endorsed: string[] } => {
  try {
    const j = typeof raw === 'string' && raw ? JSON.parse(raw) as { requested?: unknown; endorsed?: unknown } : {}
    const list = (v: unknown) => (Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean).slice(0, 12) : [])
    return { requested: list(j.requested), endorsed: list(j.endorsed) }
  } catch { return { requested: [], endorsed: [] } }
}

/**
 * Document → Recommendation. L'adresse email du recommandant n'est JAMAIS renvoyée à l'écran (profil, CVthèque, fiche candidat) :
 * elle ne sert qu'à lui envoyer la demande. `withEmail` n'est utilisé que côté serveur, pour l'envoi.
 */
export function docToRecommendation(d: Record<string, unknown>, withEmail = false): Recommendation {
  const ex = parseExpertises(d.expertisesJson)
  const s = (k: string) => (typeof d[k] === 'string' && d[k] ? (d[k] as string) : undefined)
  return {
    $id: d.$id as string,
    candidateId: d.candidateId as string,
    candidateName: d.candidateName as string,
    recipientName: d.recipientName as string,
    recipientEmail: withEmail ? (d.recipientEmail as string) : '',
    recipientCompany: s('recipientCompany'),
    recipientRole: s('recipientRole'),
    relationship: s('relationship'),
    experience: s('experience'),
    period: s('period'),
    requestedExpertises: ex.requested,
    endorsedExpertises: ex.endorsed,
    message: s('message'),
    status: d.status as Recommendation['status'],
    comment: s('comment'),
    rating: typeof d.rating === 'number' ? d.rating : undefined,
    submittedAt: s('submittedAt'),
    $createdAt: d.$createdAt as string,
  }
}

export async function getSubmittedRecommendations(candidateId: string): Promise<Recommendation[]> {
  try {
    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.RECOMMENDATIONS, [
      Query.equal('candidateId', candidateId),
      Query.equal('status', 'submitted'),
      Query.orderDesc('$createdAt'),
      Query.limit(25),
    ])
    return result.documents.map(d => docToRecommendation(d as unknown as Record<string, unknown>))
  } catch {
    return []
  }
}

/** Recommandations reçues de plusieurs candidats à la fois (matching), regroupées par candidat. */
export async function getSubmittedRecommendationsFor(candidateIds: string[]): Promise<Map<string, Recommendation[]>> {
  const out = new Map<string, Recommendation[]>()
  const ids = [...new Set(candidateIds)].slice(0, 100)
  if (ids.length === 0) return out
  try {
    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.RECOMMENDATIONS, [
      Query.equal('candidateId', ids), Query.equal('status', 'submitted'), Query.limit(500),
    ])
    for (const d of result.documents) {
      const r = docToRecommendation(d as unknown as Record<string, unknown>)
      out.set(r.candidateId, [...(out.get(r.candidateId) ?? []), r])
    }
  } catch { /* le matching fonctionne sans recommandations */ }
  return out
}

// Used as an extra criterion in the AI matching score (see Module 3) — null when the
// candidate has no submitted recommendations yet, so callers can skip the weighting
// entirely rather than penalizing candidates who simply haven't collected any.
export async function getAverageRecommendationRating(candidateId: string): Promise<number | null> {
  const recs = await getSubmittedRecommendations(candidateId)
  const ratings = recs.map(r => r.rating).filter((n): n is number => typeof n === 'number')
  if (ratings.length === 0) return null
  return ratings.reduce((a, b) => a + b, 0) / ratings.length
}
