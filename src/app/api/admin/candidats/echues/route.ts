import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { aoExpiredResponse } from '@/lib/ao/http'
import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'

// « Offres échues » de /admin/candidats : offres à valider dont la date limite est passée, à relire avant leur
// suppression groupée. Admin, boîtes de la plateforme seulement (cœur : src/lib/ao/http.ts).
// Lit toutes les offres à valider, comme l'export (5 000 au plus).
export const maxDuration = 60

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Session expirée : rechargez la page pour vous reconnecter.' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  return aoExpiredResponse(PLATFORM_TENANT_ID)
}
