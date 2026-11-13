'use server'

import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { getStripe } from '@/lib/stripe'
import { roleOf, teamActionDenial } from '@/lib/team-roles'

// Portail de facturation Stripe de l'organisation (/recruiter/abonnement, ADR 0033) : factures, moyen de paiement,
// résiliation. Réservé au propriétaire ; le client Stripe est celui de l'organisation de la session, jamais un
// identifiant venu du navigateur, et l'adresse de retour est fixe.

const PORTAL_TIMEOUT_MS = 15_000

export async function openBillingPortalAction(): Promise<{ url?: string; error?: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: 'Session expirée : rechargez la page et reconnectez-vous.' }
  let tenant: Record<string, unknown>
  try {
    const { databases } = createAdminClient()
    tenant = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, user.tenantId) as unknown as Record<string, unknown>
  } catch (err) {
    console.error('[abonnement] organisation illisible', err instanceof Error ? err.message : String(err))
    return { error: 'Abonnement illisible pour le moment : réessayez dans quelques instants.' }
  }
  const denied = teamActionDenial(roleOf(user.userId, tenant), 'billing')
  if (denied) return { error: denied }
  const customer = typeof tenant.stripeCustomerId === 'string' ? tenant.stripeCustomerId : ''
  if (!customer) return { error: 'Aucun paiement par carte pour votre organisation : contactez le support pour votre facturation.' }
  if (!process.env.STRIPE_SECRET_KEY) return { error: 'Paiement non configuré sur la plateforme : contactez le support.' }
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
  try {
    const session = await getStripe().billingPortal.sessions.create(
      { customer, return_url: `${origin}/recruiter/abonnement` },
      { timeout: PORTAL_TIMEOUT_MS },
    )
    // Adresse de Stripe seulement : le navigateur y est envoyé tel quel.
    if (!session.url.startsWith('https://')) throw new Error('adresse du portail inattendue')
    return { url: session.url }
  } catch (err) {
    // Type d'erreur seulement : le message de Stripe peut citer l'identifiant du client.
    console.error('[abonnement] portail de facturation impossible', err instanceof Error ? err.name : 'inconnu')
    return { error: 'Portail de facturation indisponible pour le moment : réessayez, ou contactez le support.' }
  }
}
