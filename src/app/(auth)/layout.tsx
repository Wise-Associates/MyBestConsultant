import { SiteNavbar } from '@/components/shared/site-navbar'
import { SiteFooter } from '@/components/shared/site-footer'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNavbar />
      <main>{children}</main>
      <SiteFooter />
    </>
  )
}
