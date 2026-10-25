import 'server-only'
import { NextResponse } from 'next/server'
import { buildAoWorkbook } from './excel'
import { filterAoOffers, filtersFromSearchParams } from './filters'
import { OriginalUnavailable, fetchOriginal, fetchOriginalAttachment } from './originals'
import { aoAccessFor } from './offer-actions'
import { listAoOfferRows } from './repo'
import { listSources } from './sources'

// Cœur des routes de téléchargement du tableau AO, pour /api/admin/candidats/… (plateforme) et /api/recruiter/ao/…
// (organisation du recruteur) : chaque route vérifie l'appelant puis passe l'organisation de SA session.

/**
 * Excel des offres AO affichées (mêmes filtres que la page, passés dans l'URL). Contient les vraies données, client
 * compris : usage interne de l'organisation.
 */
export async function aoExportResponse(tenantId: string, searchParams: URLSearchParams): Promise<NextResponse> {
  const sourceIds = (await listSources(tenantId)).map(s => s.$id)
  const rows = filterAoOffers(await listAoOfferRows(sourceIds), filtersFromSearchParams(searchParams))
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

/** Nom de fichier pour Content-Disposition : version ASCII, plus l'original encodé (RFC 5987). */
function disposition(filename: string): string {
  const ascii = filename.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '').slice(0, 150) || 'piece-jointe'
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename.slice(0, 200))}`
}

function download(content: Buffer, filename: string, contentType: string): NextResponse {
  return new NextResponse(new Uint8Array(content), {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': disposition(filename),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
    },
  })
}

/**
 * E-mail d'origine d'une offre AO (.eml) ou une de ses pièces jointes (`attachment`), relu dans la boîte pour en
 * vérifier l'authenticité. E-mails des boîtes de l'organisation seulement (ADR 0005). Le contenu vient d'un
 * expéditeur extérieur : toujours servi en téléchargement, jamais affiché par le navigateur.
 */
export async function aoOriginalResponse(tenantId: string, emailId: string, attachment: string | null): Promise<NextResponse> {
  const found = await aoAccessFor(tenantId).email(emailId)
  if (!found) return NextResponse.json({ error: 'E-mail introuvable.' }, { status: 404 })
  const { email, source } = found
  try {
    if (attachment !== null) {
      if (!email.attachments.includes(attachment)) return NextResponse.json({ error: 'Pièce jointe introuvable.' }, { status: 404 })
      const file = await fetchOriginalAttachment(email, source, attachment)
      // Type annoncé par l'expéditeur ignoré : téléchargement brut, jamais interprété par le navigateur.
      return download(file.content, attachment, 'application/octet-stream')
    }
    return download(await fetchOriginal(email, source), `ao-${email.$id}.eml`, 'message/rfc822')
  } catch (err) {
    if (err instanceof OriginalUnavailable) return NextResponse.json({ error: err.message }, { status: 410 })
    console.error('AO: e-mail d\'origine illisible', emailId, err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Boîte de réception injoignable pour le moment : réessayez dans un instant.' }, { status: 502 })
  }
}
