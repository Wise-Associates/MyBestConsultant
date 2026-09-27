'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'

export async function unsubscribeFromOutreach(candidateId: string): Promise<{ ok?: boolean; error?: string }> {
  try {
    const { databases } = createAdminClient()
    await databases.updateDocument(DB_ID, COLLECTIONS.USERS, candidateId, {
      optedOutOfOutreach: true,
    })
    return { ok: true }
  } catch {
    return { error: 'Lien invalide ou expiré.' }
  }
}
