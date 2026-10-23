import { getActiveJobs } from '@/lib/appwrite/jobs'
import { canonicalCallbackUrl, getSocialConfig, isDevToolsEnabled, isMakeConfigured, listRecentPosts } from '@/lib/social'
import { getLLMConfig } from '@/lib/ai/llm-config-store'
import { isSceneStorageConfigured } from '@/lib/social-poster/store'
import { SocialClient } from './social-client'
import { SocialDevPanel } from './social-dev-panel'

// « Publier » et « Réessayer » (Server Actions de cette page) : photo de l'affiche par OpenAI (jusqu'à 2 min) puis envoi à Make.
export const maxDuration = 300

export default async function SocialAdminPage() {
  const [config, posts, jobs] = await Promise.all([getSocialConfig(), listRecentPosts(60).catch(() => []), getActiveJobs().catch(() => [])])
  const dev = isDevToolsEnabled()
  // Statut de la photo des affiches, outils développeur seulement.
  const llm = dev ? await getLLMConfig() : null
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
          posterEnv={{ openai: !!(llm?.openaiApiKey || process.env.OPENAI_API_KEY), scenes: isSceneStorageConfigured() }}
          zernioEnv={{ key: !!process.env.ZERNIO_API_KEY, account: !!process.env.ZERNIO_INSTAGRAM_ACCOUNT_ID }}
        />
      ) : null}
    />
  )
}
