'use server'

import { z } from 'zod'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { revalidatePath } from 'next/cache'
import { adminEditDenial, offerDocument, offerPriceText, offerState, type OfferInput, type OfferState, type PlanOffer } from '@/lib/plan-offers'
import { isPlanOffersConfigured, loadOffer, loadOffers, withdrawOffer, writeOffer } from '@/lib/plan-offers-store'

async function requireAdmin() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') throw new Error('Non autorisé')
  return user
}

export type SubStatus = 'active' | 'trialing' | 'past_due' | 'suspended' | 'cancelled' | 'refunded'
export type BillingPeriod = 'monthly' | 'annual'

/** Offre sur mesure d'une organisation, pour la liste et le formulaire de l'admin (ADR 0034). */
export interface AdminOffer {
  state: OfferState
  priceText: string
  acceptedAt: string | null
  /** Pourquoi l'offre ne peut pas être modifiée ni retirée (adminEditDenial) ; null si elle le peut. */
  lockedReason: string | null
  /** Conditions, pour pré-remplir le formulaire (`validUntil` : AAAA-MM-JJ). */
  input: OfferInput
}

export interface Subscriber {
  tenantId: string
  companyName: string
  recruiterName: string
  recruiterEmail: string
  /** Formule (plans.ts) ; `gold` / `max` : anciennes formules de l'admin, encore lisibles. */
  plan: string | null
  status: SubStatus | null
  period: BillingPeriod | null
  amount: number | null
  startedAt: string | null
  notes: string
  offer: AdminOffer | null
}

function adminOffer(offer: PlanOffer | undefined, tenantPlan: unknown, now: Date): AdminOffer | null {
  if (!offer) return null
  const { terms } = offer
  return {
    state: offerState(offer, now),
    priceText: offerPriceText(offer),
    acceptedAt: offer.acceptedAt,
    lockedReason: adminEditDenial(offer, tenantPlan, now),
    input: {
      name: offer.name,
      priceCents: offer.priceCents,
      period: offer.period,
      paymentMethod: offer.paymentMethod,
      daysUntilDue: offer.daysUntilDue,
      maxUsers: terms.maxUsers,
      maxActiveJobs: terms.maxActiveJobs,
      features: (Object.keys(terms.features) as (keyof typeof terms.features)[]).filter(f => terms.features[f]),
      dailyQuotas: { ...terms.dailyQuotas },
      validUntil: offer.validUntil.slice(0, 10),
    },
  }
}

export async function getSubscribers(): Promise<{ subscribers: Subscriber[]; offersEnabled: boolean; error?: string }> {
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

    // Offres sur mesure (ADR 0034) : illisibles, la liste s'affiche sans elles (journalisé).
    const now = new Date()
    const offers = await loadOffers(tenants.documents.map(t => t.$id)).catch(err => {
      console.error('[admin abonnements] offres sur mesure illisibles', err instanceof Error ? err.message : String(err))
      return new Map<string, PlanOffer>()
    })

    const subscribers: Subscriber[] = tenants.documents.map(t => {
      const recruiter = usersByAuthId.get(t.recruiterId as string)
      return {
        tenantId: t.$id,
        companyName: t.name as string,
        recruiterName: recruiter?.name ?? '—',
        recruiterEmail: recruiter?.email ?? '—',
        plan: (t.plan as string) || null,
        status: (t.subscriptionStatus as SubStatus) || null,
        period: (t.subscriptionPeriod as BillingPeriod) || null,
        amount: (t.subscriptionAmount as number) ?? null,
        startedAt: (t.subscriptionStartedAt as string) || null,
        notes: (t.subscriptionNotes as string) || '',
        offer: adminOffer(offers.get(t.$id), t.plan, now),
      }
    })

    return { subscribers, offersEnabled: isPlanOffersConfigured() }
  } catch (e) {
    return { subscribers: [], offersEnabled: false, error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

// Formules (plans.ts) et anciennes formules de l'admin, pour qu'un abonné « Gold » modifié sans changer de formule la garde.
const subscriptionSchema = z.object({
  plan: z.enum(['free', 'essentiel', 'pro', 'custom', 'gold', 'max']).nullable(),
  status: z.enum(['active', 'trialing', 'past_due', 'suspended', 'cancelled', 'refunded']).nullable(),
  period: z.enum(['monthly', 'annual']).nullable(),
  amount: z.number().int().min(0).max(10_000_000).nullable(),
})
const tenantIdSchema = z.string().regex(/^[\w-]{1,36}$/)

export async function updateSubscription(tenantId: string, input: {
  plan: string | null
  status: SubStatus | null
  period: BillingPeriod | null
  amount: number | null
}): Promise<{ ok?: boolean; error?: string }> {
  try {
    await requireAdmin()
    const parsed = subscriptionSchema.safeParse(input)
    if (!parsed.success || !tenantIdSchema.safeParse(tenantId).success) return { error: 'Formule, statut, période ou montant (entier) invalide.' }
    const data = parsed.data
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

/**
 * Prépare (ou remplace) l'offre sur mesure d'une organisation (ADR 0034) : une proposition, que son propriétaire ou un
 * administrateur accepte depuis /recruiter/abonnement. Une offre déjà acceptée est figée (adminEditDenial).
 */
export async function saveCustomOfferAction(tenantId: unknown, input: unknown): Promise<{ offer?: AdminOffer; error?: string }> {
  try {
    await requireAdmin()
    if (!isPlanOffersConfigured()) return { error: 'Offres sur mesure indisponibles : APPWRITE_COLLECTION_PLAN_OFFERS non définie.' }
    const id = tenantIdSchema.safeParse(tenantId)
    if (!id.success) return { error: 'Organisation introuvable.' }
    const now = new Date()
    const doc = offerDocument(input, now)
    if ('error' in doc) return { error: doc.error }
    // Relues juste avant l'écriture : l'organisation doit exister (404 sinon), et une offre acceptée entre-temps n'est
    // pas écrasée (Appwrite n'a pas d'écriture conditionnelle : il reste un instant entre lecture et écriture, ADR 0034).
    const tenant = await createAdminClient().databases.getDocument(DB_ID, COLLECTIONS.TENANTS, id.data)
    const denied = adminEditDenial(await loadOffer(id.data), tenant.plan, now)
    if (denied) return { error: denied }
    await writeOffer(id.data, doc.data)
    revalidatePath('/admin/subscriptions')
    const saved = await loadOffer(id.data)
    return { offer: adminOffer(saved ?? undefined, tenant.plan, now) ?? undefined }
  } catch (e) {
    console.error('[admin abonnements] offre sur mesure non enregistrée', e instanceof Error ? e.message : String(e))
    return { error: 'Offre non enregistrée : réessayez dans quelques instants.' }
  }
}

/** Retire une offre sur mesure proposée (une offre acceptée reste : la formule de l'organisation se change d'abord). */
export async function withdrawCustomOfferAction(tenantId: unknown): Promise<{ ok?: boolean; error?: string }> {
  try {
    await requireAdmin()
    const id = tenantIdSchema.safeParse(tenantId)
    if (!id.success || !isPlanOffersConfigured()) return { error: 'Offre introuvable.' }
    const offer = await loadOffer(id.data)
    if (!offer || offer.status === 'withdrawn') return { error: 'Offre introuvable.' }
    const tenant = await createAdminClient().databases.getDocument(DB_ID, COLLECTIONS.TENANTS, id.data)
    const denied = adminEditDenial(offer, tenant.plan, new Date())
    if (denied) return { error: denied }
    await withdrawOffer(id.data)
    revalidatePath('/admin/subscriptions')
    return { ok: true }
  } catch (e) {
    console.error('[admin abonnements] offre sur mesure non retirée', e instanceof Error ? e.message : String(e))
    return { error: 'Offre non retirée : réessayez dans quelques instants.' }
  }
}
