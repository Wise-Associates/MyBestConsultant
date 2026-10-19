import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { buildAoWorkbook } from '@/lib/ao/excel'
import { filterAoOffers, filtersFromSearchParams } from '@/lib/ao/filters'
import { listAoOfferRows } from '@/lib/ao/repo'

// Téléchargement Excel des offres AO affichées (mêmes filtres que la page, passés dans l'URL).
// Contient les vraies données (client compris) : réservé aux admins.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const rows = filterAoOffers(await listAoOfferRows(), filtersFromSearchParams(req.nextUrl.searchParams))
  const file = buildAoWorkbook(rows)
  const name = `ao-offers-${new Date().toISOString().slice(0, 10)}.xlsx`
  return new NextResponse(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
