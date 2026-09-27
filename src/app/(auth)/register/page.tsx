import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getOAuthUrl } from '@/lib/appwrite/oauth'
import { DASHBOARD_BY_ROLE } from '@/lib/dashboard-routes'
import { RegisterForm } from './register-form'

export default async function RegisterPage() {
  const user = await getCurrentUser()
  if (user) redirect(DASHBOARD_BY_ROLE[user.role] ?? '/')

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
  return (
    <Suspense>
      <RegisterForm googleUrl={getOAuthUrl('google', origin)} linkedinUrl={getOAuthUrl('linkedin', origin)} />
    </Suspense>
  )
}
