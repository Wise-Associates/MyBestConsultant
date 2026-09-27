'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { revalidatePath } from 'next/cache'

export interface GroupQueueItem {
  $id: string
  jobId: string
  jobTitle: string
  groupName: string
  groupUrl: string
  visibility: 'public' | 'private' | 'unknown'
  reason: string
  status: 'pending' | 'done' | 'skipped'
  doneAt: string | null
  createdAt: string
}

export async function getGroupQueue(): Promise<GroupQueueItem[]> {
  try {
    const { databases } = createAdminClient()
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.LINKEDIN_GROUP_QUEUE, [
      Query.orderDesc('$createdAt'),
      Query.limit(300),
    ])
    return res.documents.map(d => ({
      $id: d.$id,
      jobId: d.jobId as string,
      jobTitle: d.jobTitle as string,
      groupName: d.groupName as string,
      groupUrl: d.groupUrl as string,
      visibility: (d.visibility as GroupQueueItem['visibility']) in VIS_VALUES ? d.visibility : 'unknown',
      reason: (d.reason as string) ?? '',
      status: (d.status as GroupQueueItem['status']) in STATUS_VALUES ? d.status : 'pending',
      doneAt: (d.doneAt as string) ?? null,
      createdAt: d.$createdAt as string,
    }))
  } catch {
    // A misconfigured collection ID or a transient Appwrite error must not crash the
    // whole admin page — show an empty queue instead of a hard Server Component error.
    return []
  }
}

const VIS_VALUES = { public: true, private: true, unknown: true }
const STATUS_VALUES = { pending: true, done: true, skipped: true }

export async function updateGroupStatus(
  id: string,
  status: 'done' | 'skipped' | 'pending',
): Promise<{ ok?: boolean; error?: string }> {
  try {
    const { databases } = createAdminClient()
    await databases.updateDocument(DB_ID, COLLECTIONS.LINKEDIN_GROUP_QUEUE, id, {
      status,
      doneAt: status === 'done' ? new Date().toISOString() : null,
    })
    revalidatePath('/admin/linkedin-groups')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

export async function getPendingGroupsCount(): Promise<number> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.LINKEDIN_GROUP_QUEUE, [
    Query.equal('status', 'pending'),
    Query.limit(1),
  ])
  return res.total
}
