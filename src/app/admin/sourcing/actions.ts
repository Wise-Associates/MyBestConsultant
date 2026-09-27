'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { getCurrentUser } from '@/lib/appwrite/auth'
import {
  matchCandidatesForJob, generateOutreachMessageCore, sendOutreachEmailCore,
  type CandidateMatch,
} from '@/lib/sourcing-core'

async function requireAdmin() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') throw new Error('Non autorisé')
  return user
}

// ── Job picker ───────────────────────────────────────────────────
export interface SourcingJob {
  $id: string
  title: string
  skills: string[]
  location: string
  contractType?: string
}

export async function getJobsForSourcing(): Promise<SourcingJob[]> {
  await requireAdmin()
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.JOBS, [
    Query.equal('isActive', true),
    Query.orderDesc('$createdAt'),
    Query.limit(100),
  ])
  return res.documents.map(d => ({
    $id: d.$id,
    title: d.title as string,
    skills: (d.skills as string[]) ?? [],
    location: d.location as string,
    contractType: d.contractType as string | undefined,
  }))
}

export async function findMatchingCandidates(jobId: string): Promise<{ matches: CandidateMatch[]; scanned: number; error?: string }> {
  await requireAdmin()
  return matchCandidatesForJob(jobId)
}

export async function generateOutreachMessage(candidateId: string, jobId: string): Promise<{ subject: string; message: string; error?: string }> {
  await requireAdmin()
  return generateOutreachMessageCore(candidateId, jobId)
}

export async function sendOutreachMessage(candidateId: string, subject: string, message: string): Promise<{ ok?: boolean; error?: string }> {
  await requireAdmin()
  return sendOutreachEmailCore(candidateId, subject, message)
}
