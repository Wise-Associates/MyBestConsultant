import 'server-only'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'
import { countActiveJobs } from '@/lib/appwrite/jobs'
import { acceptedTerms } from '@/lib/plan-offers'
import { loadOffer } from '@/lib/plan-offers-store'
import { STANDARD_ENTITLEMENTS, activeJobsDenial, entitlementsOf, type Entitlements } from '@/lib/plans'

// Abonnement et droits d'une organisation, relus côté serveur au moment d'agir (ADR 0034) : par chaque Server Action,
// route ou passage planifié qui ouvre une fonction réservée, prend une place de quota, invite ou publie. L'organisation
// vient toujours de la session ou du document visé, jamais du navigateur.

export interface TenantAccess {
  /** `tenants.subscriptionStatus` ; null : aucun. */
  subscriptionStatus: string | null
  entitlements: Entitlements
}

/** Organisation « plateforme » (offres et boîtes de l'admin) : pas de document `tenants`, tous les droits. */
const PLATFORM_ACCESS: TenantAccess = { subscriptionStatus: 'active', entitlements: STANDARD_ENTITLEMENTS }

/** Accès d'une organisation déjà lue (document `tenants`) ; `customTerms` : droits de son offre sur mesure acceptée. */
function tenantAccessOf(tenant: Record<string, unknown>, customTerms: Entitlements | null): TenantAccess {
  return {
    subscriptionStatus: typeof tenant.subscriptionStatus === 'string' ? tenant.subscriptionStatus : null,
    entitlements: entitlementsOf(tenant, customTerms),
  }
}

/**
 * Relit l'organisation et, pour la formule « custom », son offre sur mesure acceptée (plan_offers ; sans elle, droits
 * standard). Une erreur d'Appwrite (organisation introuvable comprise) remonte à l'appelant.
 */
export async function loadTenantAccess(tenantId: string): Promise<TenantAccess> {
  if (tenantId === PLATFORM_TENANT_ID) return PLATFORM_ACCESS
  const tenant = await createAdminClient().databases.getDocument(DB_ID, COLLECTIONS.TENANTS, tenantId)
  const customTerms = tenant.plan === 'custom' ? acceptedTerms(await loadOffer(tenantId)) : null
  return tenantAccessOf(tenant, customTerms)
}

/**
 * Refus de publier, réactiver ou importer `adding` offres quand la formule limite les offres actives et que la limite
 * serait dépassée ; null sinon. Deux publications simultanées peuvent la dépasser (compte puis écriture, sans verrou) :
 * accepté, la limite est commerciale, pas de sécurité.
 */
export async function activeJobsLimitDenial(tenantId: string, adding = 1): Promise<string | null> {
  const { entitlements } = await loadTenantAccess(tenantId)
  if (entitlements.maxActiveJobs === null) return null
  return activeJobsDenial(entitlements, await countActiveJobs(tenantId), adding)
}
