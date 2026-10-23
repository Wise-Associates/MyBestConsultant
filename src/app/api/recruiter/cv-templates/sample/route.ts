import { deny, sessionRecruiter, templateSampleResponse } from '@/lib/cv-export/http'
import { takeTemplateSlot } from '@/lib/cv-export/recruiter'
import { cvExportErrorName } from '@/lib/cv-export/store'

// Aperçu du modèle de l'organisation du recruteur (organisation de la session, jamais de la requête) : le candidat
// fictif rendu en français et en anglais (.zip), pour vérifier la mise en page. Aucune donnée réelle. Chaque aperçu rend
// le modèle, que tout recruteur peut déposer : quota du jour par organisation.
export const maxDuration = 60

export async function GET() {
  const current = await sessionRecruiter()
  if ('denied' in current) return current.denied
  let refused: string | null
  try {
    refused = await takeTemplateSlot('preview', current.tenantId, new Date())
  } catch (err) {
    console.error('[cv-export] quota d\'aperçu du modèle illisible', current.tenantId, cvExportErrorName(err))
    return deny(503, 'Aperçu impossible pour le moment : réessayez dans quelques instants.')
  }
  if (refused) return deny(429, refused)
  return templateSampleResponse(current.tenantId)
}
