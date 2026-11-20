import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getOAuthUrl } from '@/lib/appwrite/oauth'
import { afterAuthPath, offerReturnPath } from '@/lib/dashboard-routes'
import { LoginForm } from './login-form'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reason?: string; redirect?: string }>
}) {
  const { error, reason, redirect: returnTo } = await searchParams
  const user = await getCurrentUser()
  if (user) redirect(afterAuthPath(user.role, returnTo))

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
  return (
    <LoginForm
      googleUrl={getOAuthUrl('google', origin)}
      linkedinUrl={getOAuthUrl('linkedin', origin)}
      oauthError={error === 'oauth'}
      oauthReason={reason}
      returnTo={offerReturnPath(returnTo)}
    />
  )
}
