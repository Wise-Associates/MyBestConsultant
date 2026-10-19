import 'server-only'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import type { LinkedInChannelConfig } from '@/app/admin/linkedin-posts/actions'

// Read by auto-post on job creation (recruiter/social flows, no admin session) — the admin
// screen goes through the protected getLinkedInChannelConfig action in /admin/linkedin-posts.
export async function getLinkedInChannelConfig(): Promise<LinkedInChannelConfig> {
  const { databases } = createAdminClient()
  let doc: Record<string, unknown> | null = null
  let configDocId: string | null = null

  try {
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.LINKEDIN_CONFIG, [Query.limit(1)])
    if (res.documents.length > 0) {
      doc = res.documents[0] as unknown as Record<string, unknown>
      configDocId = res.documents[0].$id
    }
  } catch { /* no config yet */ }

  const envMakeUrl = process.env.MAKE_WEBHOOK_URL ?? ''
  const savedChannel = (doc?.publishChannel as string) || (envMakeUrl ? 'make' : 'direct')
  const savedMakeUrl = (doc?.makeWebhookUrl as string) || envMakeUrl
  const savedAppUrl = (doc?.appPublicUrl as string) || process.env.NEXT_PUBLIC_APP_URL || 'https://mybestconsultant.com'
  const hasToken = !!(doc?.linkedinAccessToken as string)

  return {
    channel: savedChannel as 'make' | 'direct',
    makeWebhookUrl: savedMakeUrl,
    appPublicUrl: savedAppUrl,
    linkedinConnected: hasToken,
    configDocId,
  }
}
