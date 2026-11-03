import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { aoExpiredResponse } from '@/lib/ao/http'

// « Offres échues » de /recruiter/parametres/boites-ao : offres à valider dont la date limite est passée, à relire
// avant leur suppression groupée. Recruteurs de l'organisation, ses boîtes seulement (organisation de la session).
// Lit toutes les offres à valider, comme l'export (5 000 au plus).
export const maxDuration = 60

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Session expirée : rechargez la page pour vous reconnecter.' }, { status: 401 })
  if (user.role !== 'recruiter' || !user.tenantId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  return aoExpiredResponse(user.tenantId)
}
