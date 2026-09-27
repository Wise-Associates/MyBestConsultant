'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { revalidatePath } from 'next/cache'

async function requireAdmin() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') throw new Error('Non autorisé')
  return user
}

export type PlanId = 'free' | 'gold' | 'max'
export type SubStatus = 'active' | 'trialing' | 'past_due' | 'suspended' | 'cancelled' | 'refunded'
export type BillingPeriod = 'monthly' | 'annual'

export interface Subscriber {
  tenantId: string
  companyName: string
  recruiterName: string
  recruiterEmail: string
  plan: PlanId | null
  status: SubStatus | null
  period: BillingPeriod | null
  amount: number | null
  startedAt: string | null
  notes: string
}

export async function getSubscribers(): Promise<{ subscribers: Subscriber[]; error?: string }> {
  try {
    await requireAdmin()
    const { databases } = createAdminClient()

    const tenants = await databases.listDocuments(DB_ID, COLLECTIONS.TENANTS, [Query.limit(500)])
    const recruiterIds = tenants.documents.map(t => t.recruiterId as string).filter(Boolean)

    const usersByAuthId = new Map<string, { name: string; email: string }>()
    if (recruiterIds.length > 0) {
      const users = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [
        Query.equal('userId', recruiterIds),
        Query.limit(500),
      ])
      for (const u of users.documents) {
        usersByAuthId.set(u.userId as string, {
          name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim(),
          email: (u.email as string) ?? '',
        })
      }
    }

    const subscribers: Subscriber[] = tenants.documents.map(t => {
      const recruiter = usersByAuthId.get(t.recruiterId as string)
      return {
        tenantId: t.$id,
        companyName: t.name as string,
        recruiterName: recruiter?.name ?? '—',
        recruiterEmail: recruiter?.email ?? '—',
        plan: (t.plan as PlanId) || null,
        status: (t.subscriptionStatus as SubStatus) || null,
        period: (t.subscriptionPeriod as BillingPeriod) || null,
        amount: (t.subscriptionAmount as number) ?? null,
        startedAt: (t.subscriptionStartedAt as string) || null,
        notes: (t.subscriptionNotes as string) || '',
      }
    })

    return { subscribers }
  } catch (e) {
    return { subscribers: [], error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

export async function updateSubscription(tenantId: string, data: {
  plan: PlanId | null
  status: SubStatus | null
  period: BillingPeriod | null
  amount: number | null
}): Promise<{ ok?: boolean; error?: string }> {
  try {
    await requireAdmin()
    const { databases } = createAdminClient()
    const payload: Record<string, unknown> = {
      plan: data.plan,
      subscriptionStatus: data.status,
      subscriptionPeriod: data.period,
      subscriptionAmount: data.amount,
    }
    // Set the start date the first time a plan becomes active
    if (data.plan && data.status === 'active') {
      const doc = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, tenantId)
      if (!doc.subscriptionStartedAt) payload.subscriptionStartedAt = new Date().toISOString()
    }
    await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, tenantId, payload)
    revalidatePath('/admin/subscriptions')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

export async function setSubscriptionStatus(tenantId: string, status: SubStatus): Promise<{ ok?: boolean; error?: string }> {
  try {
    await requireAdmin()
    const { databases } = createAdminClient()
    await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, tenantId, { subscriptionStatus: status })
    revalidatePath('/admin/subscriptions')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

export async function grantFreeMonth(tenantId: string): Promise<{ ok?: boolean; error?: string }> {
  try {
    await requireAdmin()
    const { databases } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, tenantId)
    const existingNotes = (doc.subscriptionNotes as string) || ''
    const entry = `Mois offert le ${new Date().toLocaleDateString('fr-FR')}`
    await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, tenantId, {
      subscriptionNotes: existingNotes ? `${existingNotes}\n${entry}` : entry,
    })
    revalidatePath('/admin/subscriptions')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}
