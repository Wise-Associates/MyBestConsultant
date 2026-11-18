'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { saveAlertEmails } from '@/lib/recruiter-alerts-store'

// Réglage des e-mails d'alerte (/recruiter/alertes, ADR 0045) : propre au recruteur de la session, gardé dans les
// préférences de son compte.

export async function setAlertEmailsAction(input: unknown): Promise<{ enabled?: boolean; error?: string }> {
  const parsed = z.boolean().safeParse(input)
  if (!parsed.success) return { error: 'Choix invalide.' }
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: 'Session expirée : rechargez la page et reconnectez-vous.' }
  try {
    await saveAlertEmails(user.userId, parsed.data)
    revalidatePath('/recruiter/alertes')
    return { enabled: parsed.data }
  } catch (err) {
    console.error('[alertes] réglage des e-mails non enregistré', err instanceof Error ? err.message : err)
    return { error: 'Réglage non enregistré : réessayez dans quelques instants.' }
  }
}
