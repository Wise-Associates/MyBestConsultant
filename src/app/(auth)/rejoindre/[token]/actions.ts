'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { acceptInvite } from '@/lib/team'
import { createSession, getOrCreateUserProfile, setSessionCookies } from '@/lib/appwrite/auth'

const schema = z.object({
  token: z.string().min(10).max(120),
  password: z.string().min(8, 'Minimum 8 caractères').max(128),
  confirm: z.string(),
}).refine(v => v.password === v.confirm, { message: 'Les deux mots de passe ne correspondent pas', path: ['confirm'] })

// Active le compte invité puis ouvre directement sa session — pas de second écran de connexion.
export async function acceptInviteAction(formData: FormData): Promise<{ error: string }> {
  const parsed = schema.safeParse({
    token: formData.get('token'), password: formData.get('password'), confirm: formData.get('confirm'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  try {
    const res = await acceptInvite(parsed.data.token, parsed.data.password)
    if (res.error || !res.email) return { error: res.error ?? 'Invitation invalide' }

    const session = await createSession(res.email, parsed.data.password)
    const profile = await getOrCreateUserProfile(session.userId)
    await setSessionCookies(session.secret, profile.role)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Impossible d’activer le compte' }
  }
  redirect('/recruiter/dashboard')
}
