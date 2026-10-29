import { NextRequest } from 'next/server'
import { downloadSavedVivierExport, generateVivierExport, recruiterGenerationScope, sessionRecruiter } from '@/lib/cv-export/http'

// Export d'un CV du vivier au format de l'ESN (ADR 0016) : mêmes conditions que la CV Thèque recruteur (modèle de
// l'organisation, abonnement actif, adresse e-mail vérifiée, quota du jour partagé), et seul le recruteur qui a importé
// le CV l'exporte ou retélécharge ses versions, comme seul il le voit dans son vivier.
export const maxDuration = 300

export async function POST(req: NextRequest, { params }: { params: Promise<{ cvId: string }> }) {
  const startedAt = Date.now()
  const current = await sessionRecruiter()
  if ('denied' in current) return current.denied
  const generation = await recruiterGenerationScope(current)
  if ('denied' in generation) return generation.denied
  return generateVivierExport(req, (await params).cvId, { tenantId: current.tenantId, userId: current.user.$id }, generation.scope, startedAt)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ cvId: string }> }) {
  const current = await sessionRecruiter()
  if ('denied' in current) return current.denied
  return downloadSavedVivierExport(req, (await params).cvId, { tenantId: current.tenantId, userId: current.user.$id })
}
