import { NextRequest } from 'next/server'
import { downloadSavedExport, generateExport, recruiterGenerationScope, sessionRecruiter } from '@/lib/cv-export/http'

// Export d'un candidat de la CV Thèque recruteur au format de l'ESN, dans le modèle de l'organisation du recruteur
// (ADR 0010). Organisation lue dans la session, jamais dans la requête. POST : modèle déposé, abonnement actif, adresse
// e-mail vérifiée et quota du jour ; GET (version enregistrée de l'organisation) : sans condition d'abonnement ni quota.
export const maxDuration = 300

export async function POST(req: NextRequest, { params }: { params: Promise<{ candidateId: string }> }) {
  const startedAt = Date.now()
  const current = await sessionRecruiter()
  if ('denied' in current) return current.denied
  const generation = await recruiterGenerationScope(current)
  if ('denied' in generation) return generation.denied
  return generateExport(req, (await params).candidateId, generation.scope, startedAt)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ candidateId: string }> }) {
  // Retélécharger ne dépend ni du modèle ni de l'abonnement : seulement de la session et de son organisation.
  const current = await sessionRecruiter()
  if ('denied' in current) return current.denied
  return downloadSavedExport(req, (await params).candidateId, current.tenantId)
}
