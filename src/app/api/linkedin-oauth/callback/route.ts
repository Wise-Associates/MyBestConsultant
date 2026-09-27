import { NextRequest, NextResponse } from 'next/server'
import {
  exchangeCodeForToken,
  getLinkedInPersonUrn,
  saveLinkedInPublishConfig,
} from '@/lib/linkedin-publish'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  if (error || !code) {
    const msg = searchParams.get('error_description') ?? error ?? 'Connexion annulée'
    return NextResponse.redirect(`${appUrl}/admin/linkedin?linkedin_error=${encodeURIComponent(msg)}`)
  }

  try {
    const { accessToken } = await exchangeCodeForToken(code)
    const personUrn = await getLinkedInPersonUrn(accessToken)

    await saveLinkedInPublishConfig({
      accessToken,
      personUrn,
      authorUrn: personUrn,  // par défaut : profil personnel
      authorLabel: 'Mon profil LinkedIn',
      autoPostOnPublish: true,
    })

    return NextResponse.redirect(`${appUrl}/admin/linkedin?linkedin_connected=1`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur OAuth'
    return NextResponse.redirect(`${appUrl}/admin/linkedin?linkedin_error=${encodeURIComponent(msg)}`)
  }
}
