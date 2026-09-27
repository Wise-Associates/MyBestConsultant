import { getHomepage } from '@/app/admin/pages/actions'
import { getSiteConfig } from '@/lib/site-config'
import { SiteNavbar } from '@/components/shared/site-navbar'
import { SiteFooter } from '@/components/shared/site-footer'
import { SectionRenderer } from '@/components/page-builder/section-renderer'
import { HomepageHero } from '@/components/homepage/homepage-hero'
import { HomepageMission } from '@/components/homepage/homepage-mission'
import { HomepageAbout } from '@/components/homepage/homepage-about'
import { HomepageFeatures } from '@/components/homepage/homepage-features'
import { HomepageTestimonials } from '@/components/homepage/homepage-testimonials'
import type { PageSection } from '@/app/admin/pages/types'

export default async function HomePage() {
  const [homepage, cfg] = await Promise.all([getHomepage(), getSiteConfig()])
  const extraSections: PageSection[] = homepage ? JSON.parse(homepage.sections) : []

  return (
    <div style={{ background: '#FFFFFF', color: '#221B0C', fontFamily: 'var(--font-body)', minHeight: '100vh' }}>
      <SiteNavbar />
      <HomepageHero />
      <HomepageMission />
      <HomepageAbout />
      <HomepageFeatures title={cfg.homepageContent.featuresTitle} subtitle={cfg.homepageContent.featuresSubtitle} />
      <HomepageTestimonials />
      {extraSections.length > 0 && (
        <div style={{ background: 'var(--color-background)', color: 'var(--color-text)' }}>
          {extraSections.map((section, i) => (
            <SectionRenderer key={i} section={section} />
          ))}
        </div>
      )}
      <SiteFooter currentSlug="home" />
    </div>
  )
}
