import { PLATFORM_NAME, PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'
import { cvExportErrorName, isCvExportStorageMissing } from '@/lib/cv-export/store'
import { getEsnTemplateInfo, isCvTemplateStorageConfigured, type EsnTemplateInfo } from '@/lib/cv-export/templates'
import { getCvthequeCandidates } from './actions'
import { CvthequeClient } from './cvtheque-client'

/** Modèle « Format ESN » de la plateforme ; la CV Thèque s'affiche même si sa lecture échoue, avec la raison. */
async function platformTemplate(): Promise<{ template: EsnTemplateInfo | null; error?: string }> {
  try {
    return { template: await getEsnTemplateInfo(PLATFORM_TENANT_ID) }
  } catch (err) {
    console.error('[cv-export] modèle de la plateforme illisible', cvExportErrorName(err))
    return {
      template: null,
      error: isCvExportStorageMissing(err)
        ? 'Modèle CV : collection ou bucket cv_templates introuvable. Lancez npm run cv-export:setup -- <env> --apply sur ce projet, ou retirez les variables APPWRITE_*_CV_TEMPLATES.'
        : 'Modèle CV de la plateforme illisible pour le moment (Appwrite) : rechargez la page. « Format ESN » échouera tant qu\'il reste illisible.',
    }
  }
}

export default async function CvthequePage() {
  const [{ candidates, error }, platform] = await Promise.all([getCvthequeCandidates(), platformTemplate()])
  return (
    <CvthequeClient initialCandidates={candidates} loadError={error} exportEsn={platform.template?.esn ?? PLATFORM_NAME}
      template={platform.template} templateError={platform.error} templateStorage={isCvTemplateStorageConfigured()} />
  )
}
