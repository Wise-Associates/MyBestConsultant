'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { revalidatePath } from 'next/cache'

export interface GenericQuestion {
  id: string
  text: string
  category: 'intro' | 'technical' | 'behavioral' | 'motivation' | 'closing'
  enabled: boolean
}

const DEFAULT_GENERIC_QUESTIONS: GenericQuestion[] = [
  { id: 'gq-1', text: 'Pouvez-vous vous présenter et résumer votre parcours ?', category: 'intro', enabled: true },
  { id: 'gq-2', text: 'Qu\'est-ce qui vous motive à postuler à ce poste ?', category: 'motivation', enabled: true },
  { id: 'gq-3', text: 'Décrivez une situation professionnelle difficile et comment vous l\'avez gérée.', category: 'behavioral', enabled: true },
  { id: 'gq-4', text: 'Quelles sont vos disponibilités et vos attentes salariales ?', category: 'closing', enabled: true },
  { id: 'gq-5', text: 'Avez-vous des questions pour nous ?', category: 'closing', enabled: true },
]

export async function getGenericQuestions(): Promise<GenericQuestion[]> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return DEFAULT_GENERIC_QUESTIONS

  try {
    const { databases } = createAdminClient()
    const tenant = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, user.tenantId)
    const raw = tenant.genericQuestions as string | undefined
    if (!raw) return DEFAULT_GENERIC_QUESTIONS
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_GENERIC_QUESTIONS
  } catch {
    return DEFAULT_GENERIC_QUESTIONS
  }
}

export async function saveGenericQuestions(questions: GenericQuestion[]): Promise<{ error?: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: 'Non autorisé' }

  try {
    const { databases } = createAdminClient()
    await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, user.tenantId, {
      genericQuestions: JSON.stringify(questions),
    })
    revalidatePath('/recruiter/interviews/questions')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

// Enabled generic questions merged ahead of the AI-generated set, so every
// interview starts with the tenant's standard questions already in place —
// the recruiter can still remove/edit them per launch in the review step.
export async function getEnabledGenericQuestions(): Promise<GenericQuestion[]> {
  const all = await getGenericQuestions()
  return all.filter(q => q.enabled)
}
