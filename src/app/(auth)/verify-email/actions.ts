'use server'

import { AppwriteException } from 'node-appwrite'
import { createGuestClient, createSessionClient } from '@/lib/appwrite/client'
import { getSessionToken } from '@/lib/appwrite/auth'
import { translateAuthError } from '@/lib/appwrite/auth-errors'

export async function sendVerificationEmailAction(): Promise<{ error?: string; success?: true }> {
  const sessionToken = await getSessionToken()
  if (!sessionToken) return { error: 'Non connecté' }

  try {
    const { account } = createSessionClient(sessionToken)
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
    await account.createVerification(`${origin}/verify-email/confirm`)
    return { success: true }
  } catch (e) {
    // La cause (type et message Appwrite, qui ne contiennent pas l'adresse) va dans les journaux ; l'utilisateur lit un
    // message en français. Le message nomme le paramètre refusé, par exemple l'hôte de l'URL de retour absent des plateformes.
    console.error('[verify-email] envoi impossible :', e instanceof AppwriteException ? `${e.type} — ${e.message}` : e instanceof Error ? e.message : e)
    return { error: translateAuthError(e, 'verify') }
  }
}

export async function confirmVerificationAction(userId: string, secret: string): Promise<{ error?: string; success?: true }> {
  if (!userId || !secret) return { error: 'Lien invalide ou expiré' }

  try {
    const { account } = createGuestClient()
    await account.updateVerification(userId, secret)
    return { success: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur'
    if (msg.includes('expired') || msg.includes('invalid')) return { error: 'Lien expiré ou invalide. Redemandez un email de vérification.' }
    return { error: msg }
  }
}
