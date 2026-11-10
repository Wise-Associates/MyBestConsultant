import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { SiteNavbar } from '@/components/shared/site-navbar'
import { SiteFooter } from '@/components/shared/site-footer'
import { LoadingProvider } from '@/components/shared/loading-provider'
import { VerifyEmailBanner } from '@/components/shared/verify-email-banner'
import { HunterSubnav } from './hunter-shell'

export default async function HunterLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.role !== 'hunter') redirect('/login')
  return (
    <LoadingProvider>
      {/* Après la barre (pas avant) : la barre est en position fixe et recouvrirait ce
          bandeau, qui resterait invisible tout en poussant le contenu vers le bas —
          un vide noir fantôme sous la barre. */}
      <SiteNavbar />
      <VerifyEmailBanner verified={user.emailVerification} />
      <main className="mbc-app">
        {/* Rubriques de l'espace chasseur, sur toutes ses pages (comme le sous-menu de l'espace recruteur). */}
        <HunterSubnav />
        {children}
      </main>
      <SiteFooter />
    </LoadingProvider>
  )
}
