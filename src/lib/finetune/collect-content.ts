import { createHash } from 'node:crypto'
import { Query, type Models } from 'node-appwrite'
import { createAdminClient } from '../appwrite/client'
import { BUCKETS, COLLECTIONS, DB_ID } from '../appwrite/config'
import { listAllDocuments } from '../appwrite/list-all'
import { mapLimit } from '../concurrency'
import { CV_PROFILE_MIN_TEXT, CV_PROFILE_SYSTEM } from '../cv-profile-prompt'
import { cvProfileTextFromBuffer } from '../cv-profile-text'
import { socialCopyPrompt } from '../social-copy-prompt'
import { jobLiteOf } from '../social-content'
import type { CollectStats } from './collect-scoring'
import { maskLeftoverContacts, textKey } from './cv-classification-dataset'
import { itemId, type DatasetItem } from './mbc-dataset'
import { keepsRealName, personFromFullName, pseudonymize, type Person } from './pseudonymize'

// Demandes du profil extrait d'un CV et des publications sociales d'une offre (ADR 0063). Profil : CV lu comme
// l'application le lit (cvProfileTextFromBuffer, 8 000 caractères), nom et coordonnées remplacés par des valeurs
// inventées — le profil demande nom, e-mail et téléphone, l'élève doit apprendre à les recopier, pas des « [EMAIL] ».

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const hash = (s: string) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16)
const ascii = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]+/g, '')

/** Coordonnées masquées remplacées par celles, inventées, de la personne au faux nom (domaine réservé aux exemples). */
function withFakeContacts(text: string, fake: Person): string {
  const email = `${ascii(fake.first) || 'contact'}.${ascii(fake.last) || 'cv'}@example.com`
  const digits = String(hash(`${fake.first}${fake.last}`)).padStart(8, '0').slice(0, 8)
  const phone = `06 ${digits.match(/../g)?.join(' ')}`
  return text.replaceAll('[EMAIL]', email).replaceAll('[TÉLÉPHONE]', phone)
}

export async function collectContent(project: string, limits: { cvProfile: number; social: number }): Promise<{ items: DatasetItem[]; stats: CollectStats }> {
  const { databases, storage } = createAdminClient()
  const [users, viviers, jobs] = await Promise.all([
    listAllDocuments(databases, DB_ID, COLLECTIONS.USERS, [Query.equal('role', 'candidate'), Query.isNotNull('cvFileId'), Query.select(['$id', 'firstName', 'lastName', 'cvFileId'])]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.VIVIER_CVS, [Query.isNotNull('cvFileId'), Query.select(['$id', 'candidateName', 'cvFileId'])]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.JOBS, [Query.select(['$id', 'title', 'description', 'skills', 'location', 'contractType', 'remote', 'salary', 'companyName'])]),
  ])
  const stats: CollectStats = { tasks: {}, info: [] }
  const note = (task: string, reason?: string) => {
    const s = (stats.tasks[task] ??= { kept: 0, skipped: {} })
    if (reason) s.skipped[reason] = (s.skipped[reason] ?? 0) + 1
    else s.kept++
  }
  const items: DatasetItem[] = []

  // Profil de CV : la lecture des PDF rend parfois un texte vide au premier essai d'un processus (pdf-parse sous charge) :
  // relu une fois avant d'écarter le CV.
  const sources = [
    ...users.map(u => ({ fileId: str(u.cvFileId), bucket: BUCKETS.CVS, person: { first: str(u.firstName), last: str(u.lastName) } })),
    ...viviers.map(v => ({ fileId: str(v.cvFileId), bucket: BUCKETS.VIVIER_CVS, person: personFromFullName(str(v.candidateName)) })),
  ].filter(s => s.fileId && (s.person.first.trim() || s.person.last.trim()))
    .sort((a, b) => hash(`profile:${project}:${a.fileId}`) - hash(`profile:${project}:${b.fileId}`)).slice(0, limits.cvProfile * 2)
  await mapLimit(sources, 3, async src => {
    if (items.length >= limits.cvProfile) return
    let text = ''
    try {
      const buffer = Buffer.from(await storage.getFileDownload(src.bucket, src.fileId))
      text = await cvProfileTextFromBuffer(buffer)
      if (text.length < 200) text = await cvProfileTextFromBuffer(buffer)
    } catch {
      return note('cv-profile', 'CV illisible')
    }
    if (text.length < CV_PROFILE_MIN_TEXT) return note('cv-profile', 'CV sans texte')
    const masked = maskLeftoverContacts(pseudonymize(text, [src.person]))
    if (keepsRealName(masked, src.person)) return note('cv-profile', 'nom resté après remplacement')
    // Faux nom de la personne, tel que le texte l'écrit désormais : repris pour l'adresse et le téléphone inventés.
    const fake = { first: pseudonymize(src.person.first, [src.person]), last: pseudonymize(src.person.last, [src.person]) }
    const user = withFakeContacts(masked, fake)
    if (items.length >= limits.cvProfile) return
    items.push({ id: itemId('cv-profile', textKey(user)), group: textKey(user), project, system: CV_PROFILE_SYSTEM, messages: [{ role: 'user', content: user }], ctx: { task: 'cv-profile' } })
    note('cv-profile')
  })

  // Publication sociale : offres réelles, au nom de leur entreprise (comme une offre de la plateforme).
  const eligible = jobs.filter((j: Models.Document) => str(j.title).trim() && str(j.description).length >= 150)
    .sort((a, b) => hash(`social:${project}:${a.$id}`) - hash(`social:${project}:${b.$id}`)).slice(0, limits.social)
  for (const job of eligible) {
    const lite = jobLiteOf({
      id: job.$id, title: str(job.title), location: str(job.location), contractType: str(job.contractType), remote: str(job.remote),
      salary: typeof job.salary === 'number' ? job.salary : undefined, skills: Array.isArray(job.skills) ? job.skills.filter((s): s is string => typeof s === 'string') : [],
      description: maskLeftoverContacts(str(job.description)), companyName: str(job.companyName),
    }, str(job.companyName), false)
    const prompt = socialCopyPrompt(lite)
    items.push({ id: itemId('social-copy', textKey(prompt.user)), group: `offre:${textKey(prompt.user)}`, project, system: prompt.system, messages: [{ role: 'user', content: prompt.user }], ctx: { task: 'social-copy', job: lite } })
    note('social-copy')
  }
  return { items, stats }
}
