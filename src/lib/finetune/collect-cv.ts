import { createHash } from 'node:crypto'
import { Query } from 'node-appwrite'
import { createAdminClient } from '../appwrite/client'
import { BUCKETS, COLLECTIONS, DB_ID } from '../appwrite/config'
import { listAllDocuments } from '../appwrite/list-all'
import { mapLimit } from '../concurrency'
import { cvFileKind } from '../cv-export/cv-data'
import { MAX_CV_CHARS, cvTextForExport, extractionPrompt, extractionRequest } from '../cv-export/prompt'
import type { AnonymizationMode } from '../cv-export/types'
import { extractTextFromFile } from '../import-file-extract'
import type { CollectStats } from './collect-scoring'
import { maskLeftoverContacts, textKey } from './cv-classification-dataset'
import { itemId, type DatasetItem } from './mbc-dataset'
import { keepsRealName, personFromFullName, pseudonymize, type Person } from './pseudonymize'

// Demandes de l'export CV (ADR 0063) : CV réels lus comme l'export les lit (lecture stricte, 40 000 caractères au plus),
// noms remplacés par des noms inventés — l'élève apprend à anonymiser un nom qu'il voit —, coordonnées masquées.

/**
 * CV gardés : 20 000 caractères au plus, pour que la demande et le dossier tiennent dans la longueur d'entraînement
 * (16 000 jetons) ; les plus longs restent lus par l'application, l'élève n'en apprend pas.
 */
const MAX_TRAINING_CV_CHARS = 20_000

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const rank = (seed: string, id: string) => createHash('sha256').update(`${seed}:${id}`).digest('hex')

/** Un tiers des dossiers en anonymisation renforcée (clients et employeurs remplacés), le reste en standard. */
const modeOf = (key: string): AnonymizationMode => (parseInt(rank('mode', key).slice(0, 2), 16) % 3 === 0 ? 'renforcee' : 'standard')

export async function collectCvExport(project: string, limit: number): Promise<{ items: DatasetItem[]; stats: CollectStats }> {
  const { databases, storage } = createAdminClient()
  const [users, viviers] = await Promise.all([
    listAllDocuments(databases, DB_ID, COLLECTIONS.USERS, [Query.equal('role', 'candidate'), Query.isNotNull('cvFileId'), Query.select(['$id', 'firstName', 'lastName', 'cvFileId'])]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.VIVIER_CVS, [Query.isNotNull('cvFileId'), Query.select(['$id', 'candidateName', 'cvFileId'])]),
  ])
  const sources: { fileId: string; bucket: string; person: Person }[] = [
    ...users.map(u => ({ fileId: str(u.cvFileId), bucket: BUCKETS.CVS, person: { first: str(u.firstName), last: str(u.lastName) } })),
    ...viviers.map(v => ({ fileId: str(v.cvFileId), bucket: BUCKETS.VIVIER_CVS, person: personFromFullName(str(v.candidateName)) })),
  ].filter(s => s.fileId && (s.person.first.trim() || s.person.last.trim()))
  // Tirage stable, avec une réserve : des CV seront écartés (scannés, trop longs).
  const ordered = [...sources].sort((a, b) => rank(`cv-export:${project}`, a.fileId).localeCompare(rank(`cv-export:${project}`, b.fileId))).slice(0, limit * 2)

  const stats: CollectStats = { tasks: {}, info: [] }
  const note = (reason?: string) => {
    const s = (stats.tasks['cv-export-extract'] ??= { kept: 0, skipped: {} })
    if (reason) s.skipped[reason] = (s.skipped[reason] ?? 0) + 1
    else s.kept++
  }
  const items: DatasetItem[] = []
  await mapLimit(ordered, 4, async src => {
    if (items.length >= limit) return
    let raw: string
    try {
      const buffer = Buffer.from(await storage.getFileDownload(src.bucket, src.fileId))
      const kind = cvFileKind(buffer)
      if (!kind) return note('format non pris en charge')
      raw = await extractTextFromFile(buffer, `cv.${kind}`, { maxChars: MAX_CV_CHARS + 1, strict: true })
    } catch {
      return note('CV illisible')
    }
    const cv = cvTextForExport(raw)
    if (!cv) return note('CV sans texte')
    if (cv.text.length > MAX_TRAINING_CV_CHARS) return note('CV trop long pour l’entraînement')
    const text = maskLeftoverContacts(pseudonymize(cv.text, [src.person]))
    if (keepsRealName(text, src.person)) return note('nom resté après remplacement')
    if (items.length >= limit) return
    const mode = modeOf(textKey(text))
    items.push({
      id: itemId('cv-export-extract', textKey(text), mode), group: textKey(text), project,
      system: extractionPrompt(mode), messages: [{ role: 'user', content: extractionRequest({ text, truncated: cv.truncated }) }],
      ctx: { task: 'cv-export-extract', mode },
    })
    note()
  })
  return { items, stats }
}
