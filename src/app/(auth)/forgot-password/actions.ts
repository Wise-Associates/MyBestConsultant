'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { translateAuthError } from '@/lib/appwrite/auth-errors'

export async function forgotPasswordAction(formData: FormData): Promise<{ error?: string; success?: true }> {
  const email = (formData.get('email') as string)?.trim()
  if (!email) return { error: 'Email requis' }

  try {
    const { account } = createAdminClient()
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
    await account.createRecovery(email, `${origin}/reset-password`)
    return { success: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur'
    // Don't leak whether the email exists — always succeed from user perspective
    if (msg.toLowerCase().includes('user') || msg.toLowerCase().includes('not found')) return { success: true }
    return { error: translateAuthError(e, 'forgot') }
  }
}
