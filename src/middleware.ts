import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { DASHBOARD_BY_ROLE } from '@/lib/dashboard-routes'

const ROLE_ROUTES: Record<string, string> = {
  '/candidate': 'candidate',
  '/recruiter': 'recruiter',
  '/admin': 'admin',
  '/hunter': 'hunter',
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const matchedPrefix = Object.keys(ROLE_ROUTES).find((prefix) =>
    pathname.startsWith(prefix),
  )

  if (!matchedPrefix) return NextResponse.next()

  const sessionCookie = request.cookies.get('mbc-session')?.value

  if (!sessionCookie) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  const roleCookie = request.cookies.get('mbc-role')?.value
  const requiredRole = ROLE_ROUTES[matchedPrefix]

  if (roleCookie && roleCookie !== requiredRole) {
    // Redirect to correct dashboard based on actual role
    return NextResponse.redirect(
      new URL(DASHBOARD_BY_ROLE[roleCookie as keyof typeof DASHBOARD_BY_ROLE] ?? '/login', request.url),
    )
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/candidate/:path*',
    '/recruiter/:path*',
    '/admin/:path*',
    '/hunter/:path*',
  ],
}
