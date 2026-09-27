'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { translateAuthError } from '@/lib/appwrite/auth-errors'

export async function resetPasswordAction(formData: FormData): Promise<{ error?: string; success?: true }> {
  const userId = formData.get('userId') as string
  const secret = formData.get('secret') as string
  const password = formData.get('password') as string
  const confirm = formData.get('confirm') as string

  if (!userId || !secret) return { error: 'Lien invalide ou expiré' }
  if (!password || password.length < 8) return { error: 'Mot de passe trop court (8 caractères minimum)' }
  if (password !== confirm) return { error: 'Les mots de passe ne correspondent pas' }

  try {
    const { account } = createAdminClient()
    await account.updateRecovery(userId, secret, password)
    return { success: true }
  } catch (e) {
    return { error: translateAuthError(e, 'reset') }
  }
}
