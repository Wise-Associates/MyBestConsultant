import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { aoExportResponse } from '@/lib/ao/http'

// Téléchargement Excel des appels d'offres affichés dans /recruiter/parametres/boites-ao (mêmes filtres, dans l'URL).
// Vraies données, client compris : recruteurs de l'organisation, ses boîtes seulement (organisation de la session).
export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (user.role !== 'recruiter' || !user.tenantId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  return aoExportResponse(user.tenantId, req.nextUrl.searchParams)
}
