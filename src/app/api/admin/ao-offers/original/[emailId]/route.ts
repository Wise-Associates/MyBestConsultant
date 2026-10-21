import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { OriginalUnavailable, fetchOriginal, fetchOriginalAttachment } from '@/lib/ao/originals'
import { getAoEmail } from '@/lib/ao/repo'
import { getAoSource } from '@/lib/ao/sources'
import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'

// Téléchargement de l'e-mail d'origine d'une offre AO (.eml) ou d'une de ses pièces jointes (?attachment=<nom>), relu
// dans la boîte pour en vérifier l'authenticité. Admin, boîtes de la plateforme seulement. Le contenu vient d'un
// expéditeur extérieur : toujours servi en téléchargement, jamais affiché par le navigateur.
export const maxDuration = 60

const DocumentId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/

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

export async function GET(req: NextRequest, { params }: { params: Promise<{ emailId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const { emailId } = await params
  if (!DocumentId.test(emailId)) return NextResponse.json({ error: 'E-mail introuvable.' }, { status: 404 })
  const email = await getAoEmail(emailId)
  const source = email?.sourceId ? await getAoSource(email.sourceId) : null
  // L'admin n'ouvre que les e-mails des boîtes de la plateforme (ADR 0005).
  if (!email || !source || source.tenantId !== PLATFORM_TENANT_ID) return NextResponse.json({ error: 'E-mail introuvable.' }, { status: 404 })

  const attachment = req.nextUrl.searchParams.get('attachment')
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
