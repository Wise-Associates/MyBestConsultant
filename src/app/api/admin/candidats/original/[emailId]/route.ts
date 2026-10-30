import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { aoEmailViewDenied, aoOriginalResponse } from '@/lib/ao/http'
import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'

// E-mail d'origine d'une offre AO (.eml, en téléchargement), une de ses pièces jointes (?attachment=<nom>) ou sa version affichable (?vue=html).
// Admin, boîtes de la plateforme seulement (cœur : src/lib/ao/http.ts).
export const maxDuration = 60

export async function GET(req: NextRequest, { params }: { params: Promise<{ emailId: string }> }) {
  // Affichage dans le panneau : un refus s'affiche aussi dans le cadre, en clair.
  const view = req.nextUrl.searchParams.get('vue') === 'html'
  const user = await getCurrentUser()
  if (!user) return view ? aoEmailViewDenied('Session expirée : rechargez la page pour vous reconnecter.', 401) : NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (user.role !== 'admin') return view ? aoEmailViewDenied('Accès refusé.', 403) : NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const { emailId } = await params
  return aoOriginalResponse(PLATFORM_TENANT_ID, emailId, req.nextUrl.searchParams.get('attachment'), view)
}
