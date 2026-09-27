import { ensureHomepage } from '@/app/admin/pages/actions'
import { HomepageEditor, DEFAULT_SCENE, type SceneCfg } from './homepage-editor'
import { getSiteConfig, getRawScenesConfig, buildCssVars } from '@/lib/site-config'

// The public homepage no longer renders the "Scènes" carousel (replaced by 5 bespoke
// sections: hero card carousel, mission, about, features, testimonials) — the "Scènes"
// tab below is kept as-is (still saves valid data) but nothing on the live site reads
// it anymore. The "Contenu" tab is what actually edits the 5 new sections' text.
export default async function HomepagePage() {
  const pageId = await ensureHomepage()
  const [config, rawScenes] = await Promise.all([getSiteConfig(), getRawScenesConfig()])
  const cssVars = buildCssVars(config)

  const scenes: SceneCfg[] = Array.from({ length: 5 }, (_, i) => ({
    ...DEFAULT_SCENE,
    ...(rawScenes[i] ?? {}),
  }))

  return (
    <HomepageEditor
      pageId={pageId}
      initialCssVars={cssVars}
      initialConfig={{
        siteName: config.siteName,
        siteTagline: config.siteTagline,
        logoUrl: config.logoUrl,
        heroCtaRecruiter: config.heroCtaRecruiter,
        heroCtaCandidate: config.heroCtaCandidate,
        statsJobs: config.statsJobs,
        statsCompanies: config.statsCompanies,
        statsCandidates: config.statsCandidates,
        footerText: config.footerText,
        contactEmail: config.contactEmail,
        googleTagId: config.googleTagId,
        scenes,
        trustedLogos: config.trustedLogos,
        homepageContent: config.homepageContent,
      }}
    />
  )
}
