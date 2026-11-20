import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getOAuthUrl } from '@/lib/appwrite/oauth'
import { afterAuthPath } from '@/lib/dashboard-routes'
import { RegisterForm } from './register-form'

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ redirect?: string }> }) {
  const user = await getCurrentUser()
  if (user) redirect(afterAuthPath(user.role, (await searchParams).redirect))

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
  return (
    <Suspense>
      <RegisterForm googleUrl={getOAuthUrl('google', origin)} linkedinUrl={getOAuthUrl('linkedin', origin)} />
    </Suspense>
  )
}
