import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'
import { adminDenial, templateSampleResponse } from '@/lib/cv-export/http'

// Aperçu du modèle de la plateforme (déposé dans la CV Thèque admin, sinon celui du dépôt) : le candidat fictif rendu en
// français et en anglais (.zip), pour vérifier la mise en page. Admin seulement ; aucune donnée réelle.
export const maxDuration = 60

export async function GET() {
  const denied = await adminDenial()
  if (denied) return denied
  return templateSampleResponse(PLATFORM_TENANT_ID)
}
