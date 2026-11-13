import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { SiteNavbar } from '@/components/shared/site-navbar'
import { SiteFooter } from '@/components/shared/site-footer'
import { LoadingProvider } from '@/components/shared/loading-provider'
import { VerifyEmailBanner } from '@/components/shared/verify-email-banner'
import { RecruiterIdentityProvider } from '@/components/recruiter/identity-context'
import { MbcAssistant } from '@/components/assistant/mbc-assistant'
import { AoSyncProvider } from '@/components/ao/ao-sync-provider'
import { RecruiterShell } from '@/components/recruiter/recruiter-sidebar'
import { SIDEBAR_COOKIE } from '@/lib/recruiter-nav'
import { RecruiterTrailRecorder } from '@/components/recruiter/back-link'

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

  // Menu latéral réduit à ses icônes si le recruteur l'a choisi (recruiter-sidebar.tsx).
  const sidebarCollapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === 'collapsed'

  return (
    <LoadingProvider>
      {/* Après la barre (pas avant) : la barre est en position fixe et recouvrirait ce
          bandeau, qui resterait invisible tout en poussant le contenu vers le bas —
          un vide noir fantôme sous la barre. */}
      <SiteNavbar />
      <VerifyEmailBanner verified={user.emailVerification} />
      <RecruiterIdentityProvider value={{ name: `${user.firstName} ${user.lastName}`.trim(), company }}>
        <main className="mbc-app">
          {/* Pages visitées dans l'onglet, pour les liens « Retour : <page d'origine> » (back-link.tsx). */}
          <Suspense fallback={null}>
            <RecruiterTrailRecorder />
          </Suspense>
          {/* Rubriques de l'espace recruteur dans un menu à gauche, sur toutes ses pages (demande du 2026-11-13 : à la place
              du sous-menu horizontal). */}
          <RecruiterShell initialCollapsed={sidebarCollapsed}>
            {/* « Synchroniser maintenant » des appels d'offres continue d'une page de l'espace recruteur à l'autre. */}
            <AoSyncProvider endpoint="/api/recruiter/ao/sync" pagePath="/recruiter/parametres/boites-ao" scope="de votre organisation">
              {children}
            </AoSyncProvider>
          </RecruiterShell>
          <MbcAssistant role="recruiter" verified={user.emailVerification} />
        </main>
      </RecruiterIdentityProvider>
      <SiteFooter />
    </LoadingProvider>
  )
}
