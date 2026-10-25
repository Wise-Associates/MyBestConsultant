import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { aoOriginalResponse } from '@/lib/ao/http'
import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'

// Téléchargement de l'e-mail d'origine d'une offre AO (.eml) ou d'une de ses pièces jointes (?attachment=<nom>).
// Admin, boîtes de la plateforme seulement (cœur : src/lib/ao/http.ts).
export const maxDuration = 60

export async function GET(req: NextRequest, { params }: { params: Promise<{ emailId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const { emailId } = await params
  return aoOriginalResponse(PLATFORM_TENANT_ID, emailId, req.nextUrl.searchParams.get('attachment'))
}
