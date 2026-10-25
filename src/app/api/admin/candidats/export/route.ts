import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { aoExportResponse } from '@/lib/ao/http'
import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'

// Téléchargement Excel des offres AO affichées (mêmes filtres que la page, passés dans l'URL).
// Contient les vraies données (client compris) : réservé aux admins, boîtes de la plateforme.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  return aoExportResponse(PLATFORM_TENANT_ID, req.nextUrl.searchParams)
}
