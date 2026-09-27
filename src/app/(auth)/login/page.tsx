import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getOAuthUrl } from '@/lib/appwrite/oauth'
import { DASHBOARD_BY_ROLE } from '@/lib/dashboard-routes'
import { LoginForm } from './login-form'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reason?: string }>
}) {
  const user = await getCurrentUser()
  if (user) redirect(DASHBOARD_BY_ROLE[user.role] ?? '/')

  const { error, reason } = await searchParams
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
  return (
    <LoginForm
      googleUrl={getOAuthUrl('google', origin)}
      linkedinUrl={getOAuthUrl('linkedin', origin)}
      oauthError={error === 'oauth'}
      oauthReason={reason}
    />
  )
}
