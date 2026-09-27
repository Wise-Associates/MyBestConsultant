'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { revalidatePath } from 'next/cache'
import { getLinkedInPublishConfig, postJobToLinkedIn, buildPostTextPublic } from '@/lib/linkedin-publish'
import type { Job } from '@/types'

export interface LinkedInPostJob {
  $id: string
  title: string
  location: string
  contractType: string
  remote: string
  salary: number | null
  skills: string[]
  companyName: string | null
  description: string
  isActive: boolean
  linkedinPostedAt: string | null
  $createdAt: string
  tenantId: string
}

export interface LinkedInChannelConfig {
  channel: 'make' | 'direct'
  makeWebhookUrl: string
  appPublicUrl: string
  linkedinConnected: boolean
  configDocId: string | null
}

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

export async function saveLinkedInChannelConfig(data: {
  channel: 'make' | 'direct'
  makeWebhookUrl: string
  appPublicUrl: string
}): Promise<{ ok?: boolean; error?: string }> {
  try {
    const { databases } = createAdminClient()
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.LINKEDIN_CONFIG, [Query.limit(1)])

    const payload = {
      publishChannel: data.channel,
      makeWebhookUrl: data.makeWebhookUrl,
      appPublicUrl: data.appPublicUrl,
    }

    if (res.documents.length > 0) {
      await databases.updateDocument(DB_ID, COLLECTIONS.LINKEDIN_CONFIG, res.documents[0].$id, payload)
    } else {
      const { ID } = await import('node-appwrite')
      await databases.createDocument(DB_ID, COLLECTIONS.LINKEDIN_CONFIG, ID.unique(), {
        keywords: [], locations: [], jobTypes: ['full_time'],
        experienceLevels: ['mid', 'senior'], remoteFilter: 'any', industries: [],
        frequency: 'manual', maxResults: 25, autoPublish: false, isActive: true,
        linkedinAutoPost: false,
        ...payload,
      })
    }

    revalidatePath('/admin/linkedin-posts')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

export async function getJobsForLinkedIn(): Promise<LinkedInPostJob[]> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.JOBS, [
    Query.orderDesc('$createdAt'),
    Query.limit(200),
  ])
  return res.documents.map(d => ({
    $id: d.$id,
    title: d.title as string,
    location: d.location as string,
    contractType: d.contractType as string,
    remote: d.remote as string,
    salary: d.salary as number | null,
    skills: (d.skills as string[]) ?? [],
    companyName: d.companyName as string | null,
    description: d.description as string,
    isActive: d.isActive as boolean,
    linkedinPostedAt: d.linkedinPostedAt as string | null,
    $createdAt: d.$createdAt,
    tenantId: d.tenantId as string,
  }))
}

export async function postJobAction(jobId: string): Promise<{ ok?: boolean; error?: string }> {
  try {
    const { databases } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId)
    const job = doc as unknown as Job & { $id: string }

    const cfg = await getLinkedInChannelConfig()

    if (cfg.channel === 'make' && cfg.makeWebhookUrl) {
      const text = buildPostTextPublic(job, cfg.appPublicUrl)
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
          jobId: job.$id,
          text,
        }),
      })
      if (!res.ok) throw new Error(`Make webhook error: ${res.status}`)
    } else {
      const liCfg = await getLinkedInPublishConfig()
      if (!liCfg?.accessToken) throw new Error('LinkedIn non connecté — allez dans Scraping LinkedIn pour connecter')
      const result = await postJobToLinkedIn(job, liCfg.accessToken, liCfg.authorUrn)
      if (result.error) throw new Error(result.error)
    }

    await databases.updateDocument(DB_ID, COLLECTIONS.JOBS, jobId, {
      linkedinPostedAt: new Date().toISOString(),
    })

    revalidatePath('/admin/linkedin-posts')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

export async function previewPostText(jobId: string): Promise<string> {
  try {
    const { databases } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId)
    const job = doc as unknown as Job & { $id: string }
    const cfg = await getLinkedInChannelConfig()
    return buildPostTextPublic(job, cfg.appPublicUrl)
  } catch {
    return ''
  }
}
