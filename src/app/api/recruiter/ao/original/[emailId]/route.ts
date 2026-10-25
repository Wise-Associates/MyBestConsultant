import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { aoOriginalResponse } from '@/lib/ao/http'

// Téléchargement de l'e-mail d'origine d'un appel d'offres (.eml) ou d'une de ses pièces jointes (?attachment=<nom>),
// relu dans la boîte. Recruteurs de l'organisation, e-mails de ses boîtes seulement (cœur : src/lib/ao/http.ts).
export const maxDuration = 60

export async function GET(req: NextRequest, { params }: { params: Promise<{ emailId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (user.role !== 'recruiter' || !user.tenantId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const { emailId } = await params
  return aoOriginalResponse(user.tenantId, emailId, req.nextUrl.searchParams.get('attachment'))
}
