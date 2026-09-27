import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { readAttachment } from '@/lib/support'
import { isImageAttachment } from '@/lib/support-shared'

export const dynamic = 'force-dynamic'

// Sert une pièce jointe du Help Desk. Le bucket est privé : l'accès n'est accordé que si la session
// appartient à l'auteur du ticket ou à un administrateur, ET que le fichier figure bien dans ce ticket
// (une note interne n'est jamais servie à l'utilisateur).
export async function GET(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params
  const ticketId = new URL(req.url).searchParams.get('t') ?? ''
  const user = await getCurrentUser()
  if (!user || !['recruiter', 'candidate', 'hunter', 'admin'].includes(user.role) || !ticketId) return new NextResponse('Introuvable', { status: 404 })

  const file = await readAttachment(
    { userId: user.userId, name: `${user.firstName} ${user.lastName}`, email: user.email, role: user.role, tenantId: user.tenantId },
    ticketId, fileId,
  ).catch(() => null)
  if (!file) return new NextResponse('Introuvable', { status: 404 })

  const { attachment, data } = file
  // Images et PDF s'affichent dans le navigateur ; tout le reste est téléchargé (jamais exécuté/affiché).
  const inline = isImageAttachment(attachment) || /\.pdf$/i.test(attachment.name)
  const filename = encodeURIComponent(attachment.name.replace(/[\r\n"]/g, ''))
  return new NextResponse(data, {
    headers: {
      'Content-Type': inline ? (attachment.type || 'application/octet-stream') : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${filename}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'private, max-age=300',
    },
  })
}
