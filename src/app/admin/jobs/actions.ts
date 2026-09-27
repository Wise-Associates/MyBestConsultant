'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { oneMonthFromNow } from '@/lib/appwrite/jobs'
import { ID } from 'node-appwrite'
import { revalidatePath } from 'next/cache'

export async function updateJob(
  id: string,
  data: Partial<ExtractedJob & { isActive: boolean; expiresAt: string }>,
): Promise<{ ok?: boolean; error?: string }> {
  try {
    const { databases } = createAdminClient()
    const payload: Record<string, unknown> = {}
    if (data.title !== undefined) payload.title = data.title
    if (data.companyName !== undefined) payload.companyName = data.companyName || undefined
    if (data.location !== undefined) payload.location = data.location
    if (data.contractType !== undefined) payload.contractType = data.contractType
    if (data.remote !== undefined) payload.remote = data.remote
    if (data.salary !== undefined) payload.salary = data.salary ?? undefined
    if (data.skills !== undefined) payload.skills = data.skills.slice(0, 10)
    if (data.description !== undefined) payload.description = data.description
    if (data.isActive !== undefined) payload.isActive = data.isActive
    if (data.expiresAt !== undefined) payload.expiresAt = data.expiresAt || null
    await databases.updateDocument(DB_ID, COLLECTIONS.JOBS, id, payload)
    revalidatePath('/admin/jobs')
    revalidatePath('/recruiter/dashboard')
    revalidatePath('/jobs')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export async function deleteJob(id: string): Promise<{ ok?: boolean; error?: string }> {
  try {
    const { databases } = createAdminClient()
    await databases.deleteDocument(DB_ID, COLLECTIONS.JOBS, id)
    revalidatePath('/admin/jobs')
    revalidatePath('/recruiter/dashboard')
    revalidatePath('/jobs')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export interface ExtractedJob {
  title: string
  companyName: string
  location: string
  contractType: 'cdi' | 'cdd' | 'freelance' | 'mission'
  remote: 'onsite' | 'hybrid' | 'remote'
  salary: number | null
  skills: string[]
  description: string
  duration: string
  startDate: string
  experience: string
}

export type CreateJobsResult = { ok: true; created: number } | { error: string }

export async function createJobsFromExtracted(
  jobs: ExtractedJob[],
  tenantId: string,
): Promise<CreateJobsResult> {
  try {
    const { databases } = createAdminClient()
    const { tryAutoPostJobToLinkedIn } = await import('@/lib/linkedin-publish')
    const { tryAutoSourceCandidates } = await import('@/lib/auto-source-candidates')
    for (const job of jobs) {
      const doc = await databases.createDocument(DB_ID, COLLECTIONS.JOBS, ID.unique(), {
        tenantId,
        title: job.title,
        description: job.description,
        skills: job.skills.slice(0, 10),
        // "France" was too generic and would silently match any region/city search (it's
        // literally a substring of "Île-de-France"), polluting results. An honest
        // placeholder that doesn't accidentally match real place names is safer.
        location: job.location || 'Non spécifié',
        contractType: job.contractType || 'mission',
        remote: job.remote || 'hybrid',
        salary: job.salary ?? undefined,
        companyName: job.companyName || undefined,
        isActive: true,
        expiresAt: oneMonthFromNow(),
      })
      await tryAutoPostJobToLinkedIn({ ...doc, $id: doc.$id } as never)
      await tryAutoSourceCandidates({ ...doc, $id: doc.$id } as never)
    }
    revalidatePath('/admin/jobs')
    return { ok: true, created: jobs.length }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
