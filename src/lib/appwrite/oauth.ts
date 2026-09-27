import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { ID } from 'node-appwrite'
import { InputFile } from 'node-appwrite/file'

export type OAuthProvider = 'google' | 'linkedin'

// Deterministic URL, built locally — no network call needed. The browser navigates
// here directly; Appwrite issues a 302 to the provider, then back to our callback
// route with ?userId=&secret= (success) once the provider flow completes.
export function getOAuthUrl(provider: OAuthProvider, origin: string): string {
  const endpoint = process.env.APPWRITE_ENDPOINT!
  const projectId = process.env.APPWRITE_PROJECT_ID!
  const params = new URLSearchParams({
    project: projectId,
    success: `${origin}/api/auth/oauth/callback`,
    failure: `${origin}/login?error=oauth`,
  })
  return `${endpoint}/account/tokens/oauth2/${provider}?${params.toString()}`
}

const USERINFO_URL: Record<OAuthProvider, string> = {
  google: 'https://openidconnect.googleapis.com/v1/userinfo',
  linkedin: 'https://api.linkedin.com/v2/userinfo',
}

// Both providers expose the same OpenID Connect basics this way — name, email,
// profile picture. LinkedIn's headline/experience/skills need its partner-gated
// Talent/Marketing APIs, which we don't have access to. Best-effort: never throws,
// never blocks login, and only fills fields that are still empty so it can't
// clobber something the candidate already set themselves.
export async function enrichCandidateFromProvider(provider: OAuthProvider, userDocId: string, accessToken: string): Promise<string> {
  try {
    if (!accessToken) return 'no-access-token'
    const res = await fetch(USERINFO_URL[provider], {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return `userinfo-http-${res.status}`
    const info = (await res.json()) as { given_name?: string; family_name?: string; picture?: string }
    if (!info.picture) return 'no-picture-field'

    const { databases, storage } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.USERS, userDocId)
    const patch: Record<string, unknown> = {}

    if (!doc.photoUrl) {
      const imgRes = await fetch(info.picture)
      if (!imgRes.ok) return `image-download-http-${imgRes.status}`
      const buffer = Buffer.from(await imgRes.arrayBuffer())
      const file = await storage.createFile(BUCKETS.LOGOS, ID.unique(), InputFile.fromBuffer(buffer, 'oauth-photo.jpg'))
      const endpoint = process.env.APPWRITE_ENDPOINT!
      const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!
      patch.photoUrl = `${endpoint}/storage/buckets/${BUCKETS.LOGOS}/files/${file.$id}/view?project=${projectId}`
    }
    if (!doc.firstName && info.given_name) patch.firstName = info.given_name
    if (!doc.lastName && info.family_name) patch.lastName = info.family_name

    if (Object.keys(patch).length > 0) {
      await databases.updateDocument(DB_ID, COLLECTIONS.USERS, userDocId, patch)
    }
    return 'ok'
  } catch (e) {
    return `error:${e instanceof Error ? e.message.slice(0, 60) : 'unknown'}`
  }
}
