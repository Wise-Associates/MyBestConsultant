import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { buildAoWorkbook } from './excel'
import { AO_PAGE_SIZE, filtersFromSearchParams, listOffsetFromSearchParams } from './filters'
import { emailViewDocument, emailViewError } from './email-view'
import { OriginalUnavailable, fetchOriginal, fetchOriginalAttachment, parseOriginalView } from './originals'
import { syncAoNow } from './offer-actions'
import { aoAccessFor } from './platform-view'
import { listAllAoOfferRows, listAoOfferRowsRange } from './repo'
import { loadAoTracking } from './tracking-store'
import type { AoListPage } from './dashboard-types'

// Cœur des routes de téléchargement du tableau AO, pour /api/admin/candidats/… (plateforme) et /api/recruiter/ao/…
// (organisation du recruteur) : chaque route vérifie l'appelant puis passe l'organisation de SA session.

/**
 * Un passage de « Synchroniser maintenant » (POST). Une route et non une Server Action : le navigateur exécute les
 * Server Actions une par une, et ces passages (jusqu'à 2 min chacun) enchaînés en arrière-plan par AoSyncProvider
 * retiendraient toutes les autres actions du site. Comme le cookie de session ne suffit pas pour un POST qui coûte des
 * appels d'IA, la demande doit venir d'une page du site (un navigateur envoie toujours Sec-Fetch-Site).
 * `?tableau=<filtres du tableau>` : envoyé quand la page AO est affichée, qui reçoit son tableau à jour.
 */
export async function aoSyncResponse(req: NextRequest, tenantId: string, holder: string): Promise<NextResponse> {
  const site = req.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const pageQuery = req.nextUrl.searchParams.get('tableau')
  return NextResponse.json(await syncAoNow(tenantId, holder, pageQuery?.slice(0, 2000) ?? null), { headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Excel des offres AO filtrées (mêmes filtres que la page, passés dans l'URL ; 5 000 offres au plus).
 * Contient les vraies données, client compris : usage interne de l'organisation.
 */
export async function aoExportResponse(tenantId: string, searchParams: URLSearchParams): Promise<NextResponse> {
  const rows = await listAllAoOfferRows(tenantId, filtersFromSearchParams(searchParams))
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

/**
 * « Afficher 50 offres de plus » du tableau : les 50 offres filtrées qui suivent `depuis`, avec leur suivi de
 * publication. Une route GET plutôt qu'une Server Action : le navigateur exécute les Server Actions une par une, et
 * « Préparer la publication » ou « Publier » (une minute et plus) retiendraient ce chargement.
 */
export async function aoListPageResponse(tenantId: string, searchParams: URLSearchParams): Promise<NextResponse> {
  const headers = { 'Cache-Control': 'no-store' }
  let page: AoListPage
  try {
    const { rows, total } = await listAoOfferRowsRange(tenantId, filtersFromSearchParams(searchParams), listOffsetFromSearchParams(searchParams), AO_PAGE_SIZE)
    page = { rows, total, tracking: {} }
  } catch (err) {
    console.error('AO: lot suivant du tableau illisible', tenantId, errorText(err))
    return NextResponse.json({ error: 'Chargement impossible pour le moment : réessayez dans un instant.' }, { status: 502, headers })
  }
  try {
    page.tracking = await loadAoTracking(page.rows)
  } catch (err) {
    // Comme la page : les offres s'affichent, leur suivi est calculé sans les faits lus.
    console.error('AO: suivi des publications du lot suivant illisible', tenantId, errorText(err))
    page.trackingError = 'Suivi des publications indisponible pour ces offres : rechargez la page dans quelques instants.'
  }
  return NextResponse.json(page, { headers })
}

/**
 * Version affichable de l'e-mail d'origine. Toute issue est une page lisible dans le cadre (le panneau ne voit pas son
 * contenu) : e-mail introuvable, boîte injoignable, e-mail impossible à afficher — chacune avec son message.
 */
async function emailViewResponse(tenantId: string, emailId: string): Promise<NextResponse> {
  let raw: Buffer
  try {
    const found = await aoAccessFor(tenantId).email(emailId)
    if (!found) return emailView(emailViewError('E-mail introuvable.'), 404)
    raw = await fetchOriginal(found.email, found.source)
  } catch (err) {
    if (err instanceof OriginalUnavailable) return emailView(emailViewError(err.message), 410)
    console.error('AO: e-mail d\'origine illisible (affichage)', emailId, errorText(err))
    return emailView(emailViewError('Boîte de réception injoignable pour le moment : réessayez dans un instant.'), 502)
  }
  try {
    return emailView(emailViewDocument(await parseOriginalView(raw)))
  } catch (err) {
    console.error('AO: e-mail d\'origine impossible à afficher', emailId, errorText(err))
    return emailView(emailViewError('Cet e-mail ne peut pas être affiché : téléchargez le fichier .eml pour le lire.'), 500)
  }
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

// Page de l'e-mail affichée dans le panneau : aucun script (sandbox sans allow-scripts, origine opaque : ni cookie ni
// accès à la page), aucun chargement extérieur (default-src 'none' ; images intégrées en data: seulement), cadre
// autorisé dans nos pages seulement. allow-popups : les liens s'ouvrent dans un nouvel onglet, hors du bac à sable.
const EMAIL_VIEW_CSP = "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'self'"

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * Refus d'afficher l'e-mail (session expirée, rôle) : une page lisible dans le cadre, le panneau ne pouvant pas lire
 * son contenu (origine opaque). Pour les routes, quand `?vue=html` est demandé.
 */
export const aoEmailViewDenied = (message: string, status: number) => emailView(emailViewError(message), status)

function emailView(html: string, status = 200): NextResponse {
  return new NextResponse(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': EMAIL_VIEW_CSP,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  })
}

/**
 * E-mail d'origine d'une offre AO (.eml), une de ses pièces jointes (`attachment`), sa version affichable (`view` :
 * HTML nettoyé, email-view.ts) ou cette même version en fichier .html (`htmlFile`), relus dans la boîte. E-mails des
 * boîtes de l'organisation seulement (ADR 0005). Le contenu vient d'un expéditeur extérieur : fichiers servis en
 * téléchargement, jamais interprétés par le navigateur ; la version affichable est nettoyée puis servie sous une CSP
 * sandbox (EMAIL_VIEW_CSP), et le fichier .html porte sa propre CSP (il est ouvert depuis le disque).
 */
export async function aoOriginalResponse(
  tenantId: string, emailId: string, attachment: string | null, view = false, htmlFile = false,
): Promise<NextResponse> {
  if (view) return emailViewResponse(tenantId, emailId)
  const found = await aoAccessFor(tenantId).email(emailId)
  if (!found) return NextResponse.json({ error: 'E-mail introuvable.' }, { status: 404 })
  const { email, source } = found
  try {
    if (htmlFile) {
      const raw = await fetchOriginal(email, source)
      let html: string
      try {
        html = emailViewDocument(await parseOriginalView(raw))
      } catch (err) {
        console.error('AO: e-mail d\'origine impossible à convertir en HTML', emailId, errorText(err))
        return NextResponse.json({ error: 'Cet e-mail ne peut pas être converti en HTML : téléchargez le fichier .eml.' }, { status: 500 })
      }
      return download(Buffer.from(html, 'utf-8'), `ao-${email.$id}.html`, 'text/html; charset=utf-8')
    }
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
