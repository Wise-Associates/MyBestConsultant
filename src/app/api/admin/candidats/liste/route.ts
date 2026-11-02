import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { aoListPageResponse } from '@/lib/ao/http'
import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'

// « Afficher 50 offres de plus » de /admin/candidats : les 50 offres filtrées suivantes (filtres et ?depuis= dans l'URL).
// Admin, boîtes de la plateforme seulement (cœur : src/lib/ao/http.ts).
export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Session expirée : rechargez la page pour vous reconnecter.' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  return aoListPageResponse(PLATFORM_TENANT_ID, req.nextUrl.searchParams)
}
