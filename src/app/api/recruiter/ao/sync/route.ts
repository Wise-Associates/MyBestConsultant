import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { aoSyncResponse } from '@/lib/ao/http'
import { aoRefusal } from '@/lib/ao/tenancy'
import { featureDenial } from '@/lib/plans'
import { loadTenantAccess } from '@/lib/tenant-access'

// Un passage de « Synchroniser maintenant » de /recruiter/parametres/boites-ao, enchaîné par AoSyncProvider.
// Recruteurs, boîtes de l'organisation de la session seulement, abonnement actif et formule qui comprend le suivi des
// appels d'offres (l'IA qui lit les e-mails est à nos frais).
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Session expirée : rechargez la page et reconnectez-vous.' }, { status: 401 })
  if (user.role !== 'recruiter' || !user.tenantId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const access = await loadTenantAccess(user.tenantId)
  const refusal = aoRefusal(user.tenantId, access.subscriptionStatus, access.entitlements)
  if (refusal === 'inactive') {
    return NextResponse.json({ error: 'Abonnement inactif : vos boîtes ne sont pas lues. Elles le seront dès sa réactivation.' })
  }
  if (refusal === 'not_included') return NextResponse.json({ error: featureDenial(access.entitlements, 'aoSourcing') })
  return aoSyncResponse(req, user.tenantId, 'recruiter')
}
