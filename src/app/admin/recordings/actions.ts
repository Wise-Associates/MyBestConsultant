'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { getCurrentUser } from '@/lib/appwrite/auth'

export interface RecordingRow {
  fileId: string
  url: string
  sessionId: string
  candidateName: string
  jobTitle: string
  role: 'interviewer' | 'candidate'
  questionText: string
  isFullTrack: boolean
  mediaType: 'audio' | 'video'
  createdAt: string
}

export async function getAllRecordings(): Promise<{ rows: RecordingRow[]; error?: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') return { rows: [], error: 'Non autorisé' }

  try {
    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.INTERVIEWS, [
      Query.orderDesc('$createdAt'),
      Query.limit(200),
    ])

    const rows: RecordingRow[] = []
    for (const doc of result.documents) {
      let recordings: { questionIdx: number; fileId: string; role?: 'interviewer' | 'candidate'; mediaType?: 'audio' | 'video' }[] = []
      let questions: { text: string }[] = []
      try { recordings = JSON.parse((doc.recordings as string) ?? '[]') } catch { /* */ }
      try { questions = JSON.parse((doc.questions as string) ?? '[]') } catch { /* */ }
      if (recordings.length === 0) continue

      for (const rec of recordings) {
        rows.push({
          fileId: rec.fileId,
          url: `/api/recording/${rec.fileId}`,
          sessionId: doc.$id,
          candidateName: (doc.candidateName as string) || 'Candidat inconnu',
          jobTitle: (doc.jobTitle as string) || '—',
          role: rec.role ?? 'candidate',
          questionText: rec.questionIdx === -1 ? '' : questions[rec.questionIdx]?.text ?? '',
          isFullTrack: rec.questionIdx === -1,
          mediaType: rec.mediaType ?? 'audio',
          createdAt: (doc.createdAt as string) || doc.$createdAt,
        })
      }
    }

    // Sessions with a merged full-track recording no longer need their (now redundant —
    // see interview-room-candidate.tsx's AudioContext mixing) per-question interviewer
    // clips listed alongside it. Older sessions predating that merge have no full track,
    // so their fragments are all that's available and stay visible.
    const sessionsWithFullTrack = new Set(rows.filter(r => r.isFullTrack).map(r => r.sessionId))
    const dedupedRows = rows.filter(r => !(r.role === 'interviewer' && sessionsWithFullTrack.has(r.sessionId)))

    dedupedRows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    return { rows: dedupedRows }
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : 'Erreur' }
  }
}
