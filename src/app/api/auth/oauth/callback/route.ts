import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/appwrite/client'
import { getOrCreateUserProfile } from '@/lib/appwrite/auth'
import { enrichCandidateFromProvider, type OAuthProvider } from '@/lib/appwrite/oauth'
import { DASHBOARD_BY_ROLE } from '@/lib/dashboard-routes'
import type { UserRole } from '@/types'

// Landing point after a Google/LinkedIn OAuth2 token flow (see getOAuthUrl). Appwrite
// appends userId+secret on success; we exchange them for a real session server-side —
// same pattern as email/password login — so mbc-session/mbc-role get set consistently.
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId')
  const secret = req.nextUrl.searchParams.get('secret')
  if (!userId || !secret) {
    return NextResponse.redirect(new URL('/login?error=oauth', req.url))
  }

  try {
    // Must use an API-key client: per Appwrite's Session model docs, the `secret`
    // field — the only reason we call this endpoint — is only ever populated
    // "if the request was made with an API key". The guest client used here
    // originally always got secret: "", so the cookie was set but empty.
    const { account } = createAdminClient()
    const session = await account.createSession(userId, secret)
    const profile = await getOrCreateUserProfile(session.userId)
    const role = (profile.role as UserRole) ?? 'candidate'

    let enrichDiag: string | null = null
    if (role === 'candidate' && (session.provider === 'google' || session.provider === 'linkedin')) {
      enrichDiag = await enrichCandidateFromProvider(session.provider as OAuthProvider, profile.$id, session.providerAccessToken)
    }

    // Set cookies directly on the redirect response rather than via next/headers'
    // cookies() — that draft doesn't reliably attach to a manually-built
    // NextResponse.redirect() in a Route Handler, which was silently dropping the
    // session cookie (login "succeeded" but the very next request came back
    // unauthenticated).
    const dashboardUrl = new URL(DASHBOARD_BY_ROLE[role] ?? '/candidate/dashboard', req.url)
    // Temporary: shows exactly why the LinkedIn/Google photo import did or didn't
    // run, visible right in the address bar after login — remove once confirmed.
    if (enrichDiag) dashboardUrl.searchParams.set('_enrich', enrichDiag)
    const response = NextResponse.redirect(dashboardUrl)
    const isProduction = process.env.NODE_ENV === 'production'
    response.cookies.set('mbc-session', session.secret, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    })
    response.cookies.set('mbc-role', role, {
      httpOnly: false,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    })
    return response
  } catch (err) {
    // Temporary: surface the real reason in the redirect so we can tell apart a
    // rejected token exchange from a profile/cookie failure during live testing.
    const reason = err instanceof Error ? err.message : 'unknown'
    const failUrl = new URL('/login', req.url)
    failUrl.searchParams.set('error', 'oauth')
    failUrl.searchParams.set('reason', reason.slice(0, 200))
    return NextResponse.redirect(failUrl)
  }
}
