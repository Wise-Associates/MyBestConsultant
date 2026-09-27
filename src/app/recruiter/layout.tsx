import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { SiteNavbar } from '@/components/shared/site-navbar'
import { SiteFooter } from '@/components/shared/site-footer'
import { LoadingProvider } from '@/components/shared/loading-provider'
import { VerifyEmailBanner } from '@/components/shared/verify-email-banner'
import { RecruiterIdentityProvider } from '@/components/recruiter/identity-context'

export default async function RecruiterLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.role !== 'recruiter') redirect('/login')

  // Nom du recruteur + de son entreprise : sert à pré-remplir les modèles de message (ex. WhatsApp).
  let company = ''
  if (user.tenantId) {
    try {
      const { databases } = createAdminClient()
      company = ((await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, user.tenantId)).name as string) ?? ''
    } catch { /* nom d'entreprise vide : les modèles s'adaptent */ }
  }

  return (
    <LoadingProvider>
      {/* Après la barre (pas avant) : la barre est en position fixe et recouvrirait ce
          bandeau, qui resterait invisible tout en poussant le contenu vers le bas —
          un vide noir fantôme sous la barre. */}
      <SiteNavbar />
      <VerifyEmailBanner verified={user.emailVerification} />
      <RecruiterIdentityProvider value={{ name: `${user.firstName} ${user.lastName}`.trim(), company }}>
        <main className="mbc-app">{children}</main>
      </RecruiterIdentityProvider>
      <SiteFooter />
    </LoadingProvider>
  )
}
