'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { ALERT_THRESHOLD_OPTIONS } from '@/lib/recruiter-alerts'
import { saveAlertEmails, saveAlertThreshold } from '@/lib/recruiter-alerts-store'

// Réglages des alertes (/recruiter/alertes, ADR 0045 et 0047) : e-mails et seuil, propres au recruteur de la session,
// gardés dans les préférences de son compte.

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

export async function setAlertThresholdAction(input: unknown): Promise<{ threshold?: number; error?: string }> {
  const threshold = ALERT_THRESHOLD_OPTIONS.find(t => t === input)
  if (threshold === undefined) return { error: 'Seuil invalide.' }
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: 'Session expirée : rechargez la page et reconnectez-vous.' }
  try {
    await saveAlertThreshold(user.userId, threshold)
    revalidatePath('/recruiter/alertes')
    return { threshold }
  } catch (err) {
    console.error('[alertes] seuil non enregistré', err instanceof Error ? err.message : err)
    return { error: 'Réglage non enregistré : réessayez dans quelques instants.' }
  }
}
