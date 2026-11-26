// Scans a candidate's CV and extracts a structured profile (skills, experience summary).
// Shared by the candidate dashboard (auto-run on upload) and the admin CV Thèque
// (manual re-scan for CVs uploaded before this feature existed).
// Texte du CV, consignes et lecture de la réponse dans des modules purs (cv-profile-text.ts, cv-profile-prompt.ts) : un
// script les reproduit à l'identique (exemples d'affinage) ; ici, seulement le téléchargement et l'appel d'IA.
import { callLLM } from '@/lib/ai/llm-router'
import { createAdminClient } from '@/lib/appwrite/client'
import { BUCKETS } from '@/lib/appwrite/config'
import { CV_PROFILE_MIN_TEXT, CV_PROFILE_SYSTEM, parseCvProfileResponse, type CvProfile } from '@/lib/cv-profile-prompt'
import { cvProfileTextFromBuffer } from '@/lib/cv-profile-text'

// Types définis dans cv-profile-prompt.ts, toujours importés d'ici par les pages et les actions.
export type { CvEducation, CvExperience, CvLanguage, CvProfile } from '@/lib/cv-profile-prompt'

async function extractCVText(cvFileId: string, bucketId: string): Promise<string> {
  try {
    const { storage } = createAdminClient()
    const bytes = await storage.getFileDownload(bucketId, cvFileId)
    return await cvProfileTextFromBuffer(Buffer.from(bytes))
  } catch {
    return ''
  }
}

/**
 * Profil tiré du CV par l'IA ; null si le texte est trop court ou l'IA en échec. `tenantId` : organisation du vivier
 * (« admin » pour la plateforme), vide pour un candidat ou un chasseur (journal de consommation de l'IA, ADR 0064).
 */
export async function extractCvProfile(cvFileId: string, bucketId: string = BUCKETS.CVS, tenantId = ''): Promise<CvProfile | null> {
  const text = await extractCVText(cvFileId, bucketId)
  if (text.length < CV_PROFILE_MIN_TEXT) return null

  try {
    const { content } = await callLLM([{ role: 'user', content: text }], CV_PROFILE_SYSTEM, { usage: { feature: 'cv-profile-extract', tenantId } })
    return parseCvProfileResponse(content, new Date())
  } catch {
    return null
  }
}
