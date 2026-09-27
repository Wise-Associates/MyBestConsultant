// LinkedIn OAuth + UGC Posts API
// Scopes requis: openid profile w_member_social
// Pour page entreprise: ajouter w_organization_social (requiert LinkedIn MDP partner approval)

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import type { Job } from '@/types'

const LI_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization'
const LI_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken'
const LI_API = 'https://api.linkedin.com/v2'

// ── OAuth helpers ─────────────────────────────────────────────────

export function getLinkedInAuthUrl(state: string): string {
  const clientId = process.env.LINKEDIN_CLIENT_ID!
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/linkedin-oauth/callback`
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: 'openid profile w_member_social',
  })
  return `${LI_AUTH_URL}?${params.toString()}`
}

export async function exchangeCodeForToken(code: string): Promise<{
  accessToken: string
  expiresIn: number
}> {
  const clientId = process.env.LINKEDIN_CLIENT_ID!
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET!
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/linkedin-oauth/callback`

  const res = await fetch(LI_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`LinkedIn token error: ${err}`)
  }
  const data = await res.json() as { access_token: string; expires_in: number }
  return { accessToken: data.access_token, expiresIn: data.expires_in }
}

export async function getLinkedInPersonUrn(accessToken: string): Promise<string> {
  // OpenID Connect userinfo endpoint — returns sub (person ID)
  const res = await fetch(`${LI_API}/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`LinkedIn userinfo error: ${res.status}`)
  const data = await res.json() as { sub: string; name?: string; picture?: string }
  return `urn:li:person:${data.sub}`
}

export async function getLinkedInOrganizations(accessToken: string): Promise<Array<{
  id: string
  name: string
  urn: string
}>> {
  // Récupère les pages entreprises dont l'utilisateur est admin
  const res = await fetch(
    `${LI_API}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`,
    { headers: { Authorization: `Bearer ${accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' } },
  )
  if (!res.ok) return []
  const data = await res.json() as { elements?: Array<{ organization: string }> }
  const orgs = data.elements ?? []

  // Résoudre les noms (best-effort)
  const results: Array<{ id: string; name: string; urn: string }> = []
  for (const org of orgs.slice(0, 5)) {
    const urn = org.organization  // e.g. "urn:li:organization:12345"
    const id = urn.split(':').pop() ?? ''
    try {
      const orgRes = await fetch(`${LI_API}/organizations/${id}`, {
        headers: { Authorization: `Bearer ${accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' },
      })
      if (orgRes.ok) {
        const orgData = await orgRes.json() as { localizedName?: string }
        results.push({ id, name: orgData.localizedName ?? urn, urn })
      }
    } catch { /* ignore individual failures */ }
  }
  return results
}

// ── Config Appwrite ───────────────────────────────────────────────

export interface LinkedInPublishConfig {
  accessToken: string
  personUrn: string
  authorUrn: string         // personUrn ou organization URN selon choix
  authorLabel: string       // "Mon profil" ou nom de la page
  autoPostOnPublish: boolean
  connectedAt: string
}

export async function getLinkedInPublishConfig(): Promise<LinkedInPublishConfig | null> {
  try {
    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.LINKEDIN_CONFIG, [Query.limit(1)])
    if (result.documents.length === 0) return null
    const doc = result.documents[0]
    if (!doc.linkedinAccessToken) return null
    return {
      accessToken: doc.linkedinAccessToken as string,
      personUrn: doc.linkedinPersonUrn as string,
      authorUrn: (doc.linkedinAuthorUrn as string) || (doc.linkedinPersonUrn as string),
      authorLabel: (doc.linkedinAuthorLabel as string) || 'Mon profil',
      autoPostOnPublish: (doc.linkedinAutoPost as boolean) ?? true,
      connectedAt: (doc.linkedinConnectedAt as string) || '',
    }
  } catch {
    return null
  }
}

export async function saveLinkedInPublishConfig(cfg: {
  accessToken: string
  personUrn: string
  authorUrn: string
  authorLabel: string
  autoPostOnPublish: boolean
}): Promise<void> {
  const { databases } = createAdminClient()
  const result = await databases.listDocuments(DB_ID, COLLECTIONS.LINKEDIN_CONFIG, [Query.limit(1)])
  const payload = {
    linkedinAccessToken: cfg.accessToken,
    linkedinPersonUrn: cfg.personUrn,
    linkedinAuthorUrn: cfg.authorUrn,
    linkedinAuthorLabel: cfg.authorLabel,
    linkedinAutoPost: cfg.autoPostOnPublish,
    linkedinConnectedAt: new Date().toISOString(),
  }
  if (result.documents.length > 0) {
    await databases.updateDocument(DB_ID, COLLECTIONS.LINKEDIN_CONFIG, result.documents[0].$id, payload)
  } else {
    const { ID } = await import('node-appwrite')
    await databases.createDocument(DB_ID, COLLECTIONS.LINKEDIN_CONFIG, ID.unique(), {
      keywords: [], locations: [], jobTypes: ['full_time'],
      experienceLevels: ['mid', 'senior'], remoteFilter: 'any', industries: [],
      frequency: 'manual', maxResults: 25, autoPublish: false, isActive: true,
      ...payload,
    })
  }
}

export async function disconnectLinkedIn(): Promise<void> {
  const { databases } = createAdminClient()
  const result = await databases.listDocuments(DB_ID, COLLECTIONS.LINKEDIN_CONFIG, [Query.limit(1)])
  if (result.documents.length === 0) return
  await databases.updateDocument(DB_ID, COLLECTIONS.LINKEDIN_CONFIG, result.documents[0].$id, {
    linkedinAccessToken: null,
    linkedinPersonUrn: null,
    linkedinAuthorUrn: null,
    linkedinAuthorLabel: null,
    linkedinAutoPost: false,
    linkedinConnectedAt: null,
  })
}

// ── Post builder ──────────────────────────────────────────────────

function cleanMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '')           // titres markdown
    .replace(/\*\*(.+?)\*\*/g, '$1')     // gras
    .replace(/\*(.+?)\*/g, '$1')         // italique
    .replace(/`(.+?)`/g, '$1')           // code inline
    .replace(/^[-•*]\s+/gm, '')          // listes
    .replace(/\n{3,}/g, '\n\n')          // sauts de ligne excessifs
    .trim()
}

function buildPostText(job: Job & { $id: string }, appUrl?: string): string {
  const url = appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.com'

  const contractMap: Record<string, string> = {
    cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission / Consulting',
  }
  const remoteMap: Record<string, string> = {
    onsite: 'Présentiel', hybrid: 'Hybride', remote: 'Full Remote',
  }

  const lines: string[] = []

  lines.push(`Nouvelle opportunité : ${job.title}`)
  lines.push('')

  const meta: string[] = []
  if (job.location) meta.push(job.location)
  if (job.contractType) meta.push(contractMap[job.contractType] ?? job.contractType)
  if (job.remote) meta.push(remoteMap[job.remote] ?? job.remote)
  if (meta.length > 0) lines.push(meta.join(' · '))

  if (job.companyName) lines.push(job.companyName)

  if (job.salary) {
    const unit = (job.contractType === 'cdi' || job.contractType === 'cdd') ? 'EUR/an' : 'EUR/j TJM'
    lines.push(`${job.salary.toLocaleString('fr-FR')} ${unit}`)
  }
  lines.push('')

  if (job.skills.length > 0) {
    lines.push(`Competences : ${job.skills.join(' · ')}`)
    lines.push('')
  }

  if (job.description) {
    const clean = cleanMarkdown(job.description)
    if (clean) {
      // LinkedIn UGC posts: 3000 chars max — on ne tronque que pour respecter cette limite technique de l'API
      lines.push(clean.length > 2900 ? clean.slice(0, 2900) + '…' : clean)
      lines.push('')
    }
  }

  lines.push(`Postulez ici : ${url}/jobs/${job.$id}`)
  lines.push('')

  const tags = ['#recrutement', '#emploi', '#opportunite']
  for (const s of job.skills.slice(0, 4)) {
    const tag = s.replace(/[^a-zA-Z0-9]/g, '')
    if (tag) tags.push(`#${tag}`)
  }
  if (job.contractType === 'freelance' || job.contractType === 'mission') tags.push('#freelance #consulting')
  if (job.companyName) {
    const co = job.companyName.replace(/[^a-zA-Z0-9]/g, '')
    if (co) tags.push(`#${co}`)
  }
  lines.push(tags.join(' '))

  return lines.join('\n')
}

export { buildPostText as buildPostTextPublic }

// ── Publish to LinkedIn ───────────────────────────────────────────

export async function postJobToLinkedIn(
  job: Job & { $id: string },
  accessToken: string,
  authorUrn: string,
): Promise<{ postId?: string; error?: string }> {
  const text = buildPostText(job)

  const body = {
    author: authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  }

  const res = await fetch(`${LI_API}/ugcPosts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    return { error: `LinkedIn API error (${res.status}): ${err.slice(0, 200)}` }
  }

  const postId = res.headers.get('x-restli-id') ?? undefined
  return { postId }
}

// ── Auto-post (called after any job creation) ─────────────────────

export async function tryAutoPostJobToLinkedIn(job: Job & { $id: string }): Promise<void> {
  try {
    // Same channel resolution as the manual "Publier" button (admin/linkedin-posts),
    // so auto-post on import can never diverge from what's actually configured/working.
    const { getLinkedInChannelConfig } = await import('@/app/admin/linkedin-posts/actions')
    const cfg = await getLinkedInChannelConfig()

    let posted = false

    if (cfg.channel === 'make' && cfg.makeWebhookUrl) {
      const text = buildPostText(job, cfg.appPublicUrl)
      const res = await fetch(cfg.makeWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: job.title,
          location: job.location,
          contractType: job.contractType,
          remote: job.remote,
          salary: job.salary,
          skills: job.skills,
          companyName: job.companyName,
          description: job.description,
          jobId: job.$id,
          text,
        }),
      })
      posted = res.ok
    } else if (cfg.linkedinConnected) {
      const liCfg = await getLinkedInPublishConfig()
      if (liCfg?.autoPostOnPublish && liCfg.accessToken) {
        const result = await postJobToLinkedIn(job, liCfg.accessToken, liCfg.authorUrn)
        posted = !result.error
      }
    }

    if (posted) {
      const { createAdminClient } = await import('@/lib/appwrite/client')
      const { DB_ID, COLLECTIONS } = await import('@/lib/appwrite/config')
      const { databases } = createAdminClient()
      await databases.updateDocument(DB_ID, COLLECTIONS.JOBS, job.$id, {
        linkedinPostedAt: new Date().toISOString(),
      })
    }
  } catch {
    // silent — auto-post failure must not break job creation
  }
}
