import { getActiveJobs } from '@/lib/appwrite/jobs'
import { canonicalCallbackUrl, getSocialConfig, isDevToolsEnabled, isMakeConfigured, listRecentPosts } from '@/lib/social'
import { SocialClient } from './social-client'
import { SocialDevPanel } from './social-dev-panel'

export default async function SocialAdminPage() {
  const [config, posts, jobs] = await Promise.all([getSocialConfig(), listRecentPosts(60).catch(() => []), getActiveJobs().catch(() => [])])
  const dev = isDevToolsEnabled()
  return (
    <SocialClient
      initialConfig={config}
      initialPosts={posts}
      jobs={jobs.slice(0, 100).map(j => ({ id: j.$id, title: j.title, company: j.companyName ?? '' }))}
      env={{ configured: isMakeConfigured() }}
      devPanel={dev ? (
        <SocialDevPanel
          env={{ webhook: (process.env.MAKE_SOCIAL_WEBHOOK_URL ?? '').startsWith('https://'), secret: (process.env.SOCIAL_WEBHOOK_SECRET ?? '').length >= 16, configured: isMakeConfigured() }}
          callbackUrl={await canonicalCallbackUrl()}
          zernioEnv={{ kie: !!process.env.KIE_API_KEY, key: !!process.env.ZERNIO_API_KEY, account: !!process.env.ZERNIO_INSTAGRAM_ACCOUNT_ID }}
        />
      ) : null}
    />
  )
}
