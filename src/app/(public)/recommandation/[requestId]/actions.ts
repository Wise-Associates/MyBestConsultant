'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'

export async function submitRecommendation(
  requestId: string,
  data: { comment: string; rating: number; endorsed?: string[] },
): Promise<{ ok?: boolean; error?: string }> {
  const comment = data.comment.trim()
  const rating = Math.round(data.rating)
  if (!comment) return { error: 'Merci de laisser un commentaire' }
  if (rating < 1 || rating > 5) return { error: 'Note invalide' }

  try {
    const { databases } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.RECOMMENDATIONS, requestId)
    if (doc.status === 'submitted') return { error: 'Cette recommandation a déjà été soumise' }

    // Expertises confirmées par le recommandant : uniquement parmi celles proposées dans la demande.
    let requested: string[] = []
    try { requested = (JSON.parse((doc.expertisesJson as string) || '{}') as { requested?: string[] }).requested ?? [] } catch { /* demande sans expertises */ }
    const endorsed = requested.length > 0 ? (data.endorsed ?? []).filter(e => requested.includes(e)) : []
    if (requested.length > 0 && endorsed.length === 0) return { error: 'Confirmez au moins une expertise sur laquelle porte votre recommandation' }

    await databases.updateDocument(DB_ID, COLLECTIONS.RECOMMENDATIONS, requestId, {
      expertisesJson: JSON.stringify({ requested, endorsed }),
      comment,
      rating,
      status: 'submitted',
      submittedAt: new Date().toISOString(),
    })
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'enregistrement' }
  }
}
