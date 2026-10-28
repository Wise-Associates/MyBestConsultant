import 'server-only'
import { releaseDailySlot, takeDailySlotId } from '@/lib/ao/state'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import type { UserProfile } from '@/types'
import { CV_EXPORT_DAILY_LIMITS, CV_TEMPLATE_DAILY_LIMITS, QUOTA_MESSAGE, TEMPLATE_MESSAGE, generationDenial, templateUploadDenial } from './access'
import { getEsnTemplateInfo, type EsnTemplateInfo } from './templates'

// « Format ESN » dans la CV Thèque des recruteurs (ADR 0010) : l'organisation vient toujours de la session. Partagé par
// la page, ses actions et les routes /api/recruiter/cv-export et /api/recruiter/cv-templates, qui vérifient chacune le
// recruteur avant de l'appeler.

export interface RecruiterExportState {
  tenantId: string
  /** Modèle de l'organisation ; null : pas de modèle, donc pas de « Format ESN ». */
  template: EsnTemplateInfo | null
  /** Raison du refus de générer (abonnement, adresse e-mail) ; null : permis, sous réserve du quota du jour. */
  generationDenied: string | null
  /** Raison du refus de déposer un modèle (adresse e-mail) ; null : permis, sous réserve du quota du jour. */
  uploadDenied: string | null
}

/** État de l'export pour un recruteur ; null si le compte n'est pas un recruteur rattaché à une organisation. */
export async function recruiterExportState(user: UserProfile): Promise<RecruiterExportState | null> {
  if (user.role !== 'recruiter' || !user.tenantId) return null
  const tenantId = user.tenantId
  const [template, tenant] = await Promise.all([
    getEsnTemplateInfo(tenantId),
    createAdminClient().databases.getDocument(DB_ID, COLLECTIONS.TENANTS, tenantId),
  ])
  const subscriptionStatus = typeof tenant.subscriptionStatus === 'string' ? tenant.subscriptionStatus : null
  return {
    tenantId,
    template,
    generationDenied: generationDenial({ tenantId, subscriptionStatus, emailVerified: user.emailVerification }),
    uploadDenied: templateUploadDenial({ emailVerified: user.emailVerification }),
  }
}

/**
 * Prend un dépôt ou un aperçu de modèle sur le quota du jour de l'organisation (et, pour un dépôt, cartographié par
 * l'IA, sur celui de toutes les organisations) : message de refus, ou null si permis. Un dépôt refusé ensuite compte.
 */
export async function takeTemplateSlot(use: 'upload' | 'preview', tenantId: string, now: Date): Promise<string | null> {
  if (use === 'preview') {
    return (await takeDailySlotId('cvTemplatePreview', tenantId, now, CV_TEMPLATE_DAILY_LIMITS.previews)) ? null : TEMPLATE_MESSAGE.previewQuota
  }
  const own = await takeDailySlotId('cvTemplateOrg', tenantId, now, CV_TEMPLATE_DAILY_LIMITS.uploads)
  if (!own) return TEMPLATE_MESSAGE.uploadQuota
  if (!(await takeDailySlotId('cvTemplateAll', 'platform', now, CV_TEMPLATE_DAILY_LIMITS.uploadsAllOrganisations))) {
    console.warn('[cv-export] plafond quotidien des dépôts de modèle atteint pour toutes les organisations')
    // La place de l'organisation n'a pas servi : rendue, pour ne pas compter un refus de la plateforme contre elle.
    await releaseDailySlot(own)
    return TEMPLATE_MESSAGE.uploadPlatformQuota
  }
  return null
}

/** Nom de l'organisation, écrit comme auteur dans les exports (`esn` de la cartographie). */
export async function organisationName(tenantId: string): Promise<string> {
  const tenant = await createAdminClient().databases.getDocument(DB_ID, COLLECTIONS.TENANTS, tenantId)
  const name = typeof tenant.name === 'string' ? tenant.name.trim() : ''
  return name.length >= 2 ? name.slice(0, 100) : 'Votre ESN'
}

/** Refus (message, statut HTTP : 429 par défaut), ou `release` pour rendre les places prises. */
export type GenerationSlot = { refused: string; status?: number } | { release: () => Promise<void> }

/**
 * Prend une génération sur les quotas du jour (organisation, puis toutes) : refus avec son message, ou `release` pour
 * rendre les places si la génération échoue sans frais (CV illisible, IA non configurée ou indisponible).
 */
export async function takeRecruiterGenerationSlot(tenantId: string, now: Date): Promise<GenerationSlot> {
  const own = await takeDailySlotId('cvExportOrg', tenantId, now, CV_EXPORT_DAILY_LIMITS.perOrganisation)
  if (!own) return { refused: QUOTA_MESSAGE.organisation }
  const all = await takeDailySlotId('cvExportAll', 'platform', now, CV_EXPORT_DAILY_LIMITS.allOrganisations)
  if (!all) {
    console.warn('[cv-export] plafond quotidien de toutes les organisations atteint')
    // La place de l'organisation n'a pas servi : rendue, pour ne pas compter un refus de la plateforme contre elle.
    await releaseDailySlot(own)
    return { refused: QUOTA_MESSAGE.platform }
  }
  return { release: async () => { await Promise.all([releaseDailySlot(own), releaseDailySlot(all)]) } }
}
