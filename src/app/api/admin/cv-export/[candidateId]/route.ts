import { NextRequest } from 'next/server'
import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'
import { adminDenial, deny, downloadSavedExport, generateExport } from '@/lib/cv-export/http'
import { cvExportErrorName, isCvExportStorageMissing } from '@/lib/cv-export/store'
import { TemplateError } from '@/lib/cv-export/template-check'
import { loadEsnTemplate } from '@/lib/cv-export/templates'

// Export d'un candidat de la CV Thèque admin au format de l'ESN, modèle de la plateforme (déposé dans la CV Thèque
// admin, sinon Wise Associates du dépôt). Admin seulement, sans quota. POST génère et enregistre, GET retélécharge la
// version enregistrée (src/lib/cv-export/http.ts).
export const maxDuration = 300

export async function POST(req: NextRequest, { params }: { params: Promise<{ candidateId: string }> }) {
  const startedAt = Date.now()
  const denied = await adminDenial()
  if (denied) return denied
  let template
  try {
    template = await loadEsnTemplate(PLATFORM_TENANT_ID)
  } catch (err) {
    // Modèle déposé illisible : jamais de repli silencieux sur celui du dépôt, l'export serait dans un autre modèle.
    console.error('[cv-export] modèle de la plateforme illisible', err instanceof TemplateError ? err.message : cvExportErrorName(err))
    if (err instanceof TemplateError) {
      return deny(422, `Modèle CV de la plateforme inutilisable (${err.message}) : déposez-le à nouveau ou retirez-le (bouton « Modèle CV »).`)
    }
    if (isCvExportStorageMissing(err)) {
      return deny(503, 'Modèle CV : collection ou bucket cv_templates introuvable. Lancez npm run cv-export:setup -- <env> --apply sur ce projet.')
    }
    return deny(503, 'Modèle CV de la plateforme illisible pour le moment (stockage) : réessayez dans quelques instants.')
  }
  if (!template) return deny(500, 'Modèle de la plateforme introuvable.')
  return generateExport(req, (await params).candidateId, { tenantId: PLATFORM_TENANT_ID, template }, startedAt)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ candidateId: string }> }) {
  const denied = await adminDenial()
  if (denied) return denied
  return downloadSavedExport(req, (await params).candidateId, PLATFORM_TENANT_ID)
}
