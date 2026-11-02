import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { aoListPageResponse } from '@/lib/ao/http'

// « Afficher 50 offres de plus » de /recruiter/parametres/boites-ao : les 50 offres filtrées suivantes (filtres et
// ?depuis= dans l'URL). Recruteurs de l'organisation, ses boîtes seulement (organisation de la session).
export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Session expirée : rechargez la page pour vous reconnecter.' }, { status: 401 })
  if (user.role !== 'recruiter' || !user.tenantId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  return aoListPageResponse(user.tenantId, req.nextUrl.searchParams)
}
