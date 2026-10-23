import { NextRequest } from 'next/server'
import { deny, downloadSavedExport, generateExport, sessionRecruiter } from '@/lib/cv-export/http'
import { recruiterExportState, takeRecruiterGenerationSlot } from '@/lib/cv-export/recruiter'
import { cvExportErrorName } from '@/lib/cv-export/store'
import { TemplateError, checkTemplate } from '@/lib/cv-export/template-check'
import { loadEsnTemplate, type EsnTemplate } from '@/lib/cv-export/templates'

// Export d'un candidat de la CV Thèque recruteur au format de l'ESN, dans le modèle de l'organisation du recruteur
// (ADR 0010). Organisation lue dans la session, jamais dans la requête. POST : modèle déposé, abonnement actif, adresse
// e-mail vérifiée et quota du jour ; GET (version enregistrée de l'organisation) : sans condition d'abonnement ni quota.
export const maxDuration = 300

const TEMPLATE_UNUSABLE = 'Le modèle CV de votre organisation est inutilisable pour le moment : téléchargez son aperçu (bouton « Modèle CV »), déposez-le à nouveau ou contactez-nous.'
const NO_TEMPLATE = 'Aucun modèle CV ESN pour votre organisation : déposez-le depuis la CV Thèque (bouton « Modèle CV »).'
const UNAVAILABLE = '« Format ESN » momentanément indisponible : réessayez dans quelques instants.'

export async function POST(req: NextRequest, { params }: { params: Promise<{ candidateId: string }> }) {
  const startedAt = Date.now()
  const current = await sessionRecruiter()
  if ('denied' in current) return current.denied
  const { tenantId } = current

  let template: EsnTemplate | null
  try {
    const state = await recruiterExportState(current.user)
    if (state?.generationDenied) return deny(403, state.generationDenied)
    if (!state?.template) return deny(404, NO_TEMPLATE)
    template = await loadEsnTemplate(tenantId)
  } catch (err) {
    // Cartographie enregistrée illisible (TemplateError) : à redéposer ; sinon panne passagère du stockage.
    console.error('[cv-export] modèle de l\'organisation illisible', tenantId, err instanceof TemplateError ? err.message : cvExportErrorName(err))
    return err instanceof TemplateError ? deny(422, TEMPLATE_UNUSABLE) : deny(503, UNAVAILABLE)
  }
  if (!template) return deny(404, NO_TEMPLATE)
  const checked = template

  return generateExport(req, (await params).candidateId, {
    tenantId,
    template: checked,
    // Juste avant l'IA, une fois la demande et le CV validés : places du jour, puis rendu fictif du modèle (jusqu'à
    // environ 2 s), qui ne coûte ainsi pas plus que le quota. Un modèle devenu inutilisable rend les places, sans frais.
    reserve: async () => {
      const slot = await takeRecruiterGenerationSlot(tenantId, new Date())
      if ('refused' in slot) return slot
      try {
        checkTemplate(checked.bytes, checked.map)
        return slot
      } catch (err) {
        console.error('[cv-export] modèle de l\'organisation inutilisable', tenantId, err instanceof TemplateError ? err.message : cvExportErrorName(err))
        await slot.release().catch(releaseErr => console.error('[cv-export] places de quota non rendues', tenantId, cvExportErrorName(releaseErr)))
        return { refused: TEMPLATE_UNUSABLE, status: 422 }
      }
    },
    publicErrors: true,
  }, startedAt)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ candidateId: string }> }) {
  // Retélécharger ne dépend ni du modèle ni de l'abonnement : seulement de la session et de son organisation.
  const current = await sessionRecruiter()
  if ('denied' in current) return current.denied
  return downloadSavedExport(req, (await params).candidateId, current.tenantId)
}
