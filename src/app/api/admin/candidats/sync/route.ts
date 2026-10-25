import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { aoSyncResponse } from '@/lib/ao/http'
import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'

// Un passage de « Synchroniser maintenant » de /admin/candidats (quelques e-mails), enchaîné par AoSyncProvider.
// Admin, boîtes de la plateforme seulement (cœur : src/lib/ao/http.ts).
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Session expirée : rechargez la page et reconnectez-vous.' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  return aoSyncResponse(req, PLATFORM_TENANT_ID, 'admin')
}
