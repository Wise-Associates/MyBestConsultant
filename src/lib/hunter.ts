import { randomBytes } from 'crypto'
import { ID, Query, type Models } from 'node-appwrite'
import { InputFile } from 'node-appwrite/file'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { wrapEmailHtml } from '@/lib/email-template'
import { extractCvProfile, type CvProfile } from '@/lib/cv-profile-extract'
import { HUNTER_PROFILE_ROLE } from '@/lib/candidate-identity'
import { getJobById, hasApplied } from '@/lib/appwrite/jobs'
import { autoScreenApplication } from '@/app/recruiter/screening/actions'
import { after } from 'next/server'

// Profil Chasseur de têtes (Module 14).
// Le vivier d'un chasseur est stocké comme des documents « users » de rôle `hunter_profile` (sans compte de
// connexion) rattachés au chasseur par `hunterUserId`. Ainsi une proposition est une candidature ordinaire
// (`candidateId` = ce profil) et tout l'espace recruteur — pipeline, screening, entretiens, rapports —
// fonctionne sans modification ; le chasseur reste l'intermédiaire (voir lib/candidate-identity).

export interface Hunter { userId: string; name: string; email: string; whatsapp?: string }

export interface HunterProfile {
  id: string
  firstName: string
  lastName: string
  title: string
  city: string
  skills: string[]
  yearsOfExperience: number | null
  summary: string
  contactEmail: string
  contactPhone: string
  rate: string
  availability: string
  notes: string
  cvFileId: string
  createdAt: string
  proposals: number
}

export type ProfileInput = Partial<Pick<HunterProfile,
  'firstName' | 'lastName' | 'title' | 'city' | 'skills' | 'yearsOfExperience' | 'summary' | 'contactEmail' | 'contactPhone' | 'rate' | 'availability' | 'notes'>>

export interface HunterProposal {
  applicationId: string
  profileId: string
  profileName: string
  profileTitle: string
  jobId: string
  jobTitle: string
  company: string
  status: string
  aiScore: number | null
  pitch: string
  createdAt: string
}

interface HunterMeta { title?: string; rate?: string; availability?: string; notes?: string }
type StoredProfile = Partial<CvProfile> & { hunter?: HunterMeta }

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
const parseStored = (raw: unknown): StoredProfile => { try { return typeof raw === 'string' && raw ? JSON.parse(raw) : {} } catch { return {} } }

function docToProfile(d: Models.Document, proposals = 0): HunterProfile {
  const r = d as unknown as Record<string, unknown>
  const p = parseStored(r.cvProfileJson)
  return {
    id: d.$id, firstName: (r.firstName as string) ?? '', lastName: (r.lastName as string) ?? '',
    title: p.hunter?.title ?? (r.desiredRoles as string) ?? '',
    city: (r.city as string) ?? '', skills: p.skills ?? [], yearsOfExperience: p.yearsOfExperience ?? null,
    summary: p.experienceSummary ?? '', contactEmail: p.candidateEmail ?? '', contactPhone: p.candidatePhone ?? (r.phone as string) ?? '',
    rate: p.hunter?.rate ?? '', availability: p.hunter?.availability ?? '', notes: p.hunter?.notes ?? '',
    cvFileId: (r.cvFileId as string) ?? '', createdAt: d.$createdAt, proposals,
  }
}

async function ownedProfileDoc(hunter: Hunter, profileId: string): Promise<Models.Document> {
  const { databases } = createAdminClient()
  const doc = await databases.getDocument(DB_ID, COLLECTIONS.USERS, profileId)
  if (doc.role !== HUNTER_PROFILE_ROLE || doc.hunterUserId !== hunter.userId) throw new Error('Profil introuvable')
  return doc
}

async function countProposals(profileIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (profileIds.length === 0) return counts
  const { databases } = createAdminClient()
  for (let i = 0; i < profileIds.length; i += 100) {
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.APPLICATIONS, [Query.equal('candidateId', profileIds.slice(i, i + 100)), Query.limit(500)])
    for (const a of res.documents) counts.set(a.candidateId as string, (counts.get(a.candidateId as string) ?? 0) + 1)
  }
  return counts
}

export async function listHunterProfiles(hunterUserId: string): Promise<HunterProfile[]> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [Query.equal('hunterUserId', hunterUserId), Query.orderDesc('$createdAt'), Query.limit(500)])
  const counts = await countProposals(res.documents.map(d => d.$id))
  return res.documents.map(d => docToProfile(d, counts.get(d.$id) ?? 0))
}

function buildStored(existing: StoredProfile, input: ProfileInput): StoredProfile {
  const skills = input.skills ? [...new Set(input.skills.map(s => clip(s, 40)).filter(Boolean))].slice(0, 40) : existing.skills ?? []
  const years = input.yearsOfExperience === undefined ? existing.yearsOfExperience ?? null : (typeof input.yearsOfExperience === 'number' && input.yearsOfExperience >= 0 ? Math.min(60, Math.round(input.yearsOfExperience)) : null)
  return {
    ...existing,
    skills, yearsOfExperience: years,
    experienceSummary: input.summary !== undefined ? clip(input.summary, 2500) : existing.experienceSummary ?? '',
    candidateEmail: input.contactEmail !== undefined ? clip(input.contactEmail, 200) || null : existing.candidateEmail ?? null,
    candidatePhone: input.contactPhone !== undefined ? clip(input.contactPhone, 30) || null : existing.candidatePhone ?? null,
    hunter: {
      title: input.title !== undefined ? clip(input.title, 120) : existing.hunter?.title ?? '',
      rate: input.rate !== undefined ? clip(input.rate, 60) : existing.hunter?.rate ?? '',
      availability: input.availability !== undefined ? clip(input.availability, 80) : existing.hunter?.availability ?? '',
      notes: input.notes !== undefined ? clip(input.notes, 1000) : existing.hunter?.notes ?? '',
    },
  }
}

async function insertProfile(hunter: Hunter, input: ProfileInput, base: StoredProfile, cvFileId: string): Promise<HunterProfile> {
  const { databases } = createAdminClient()
  const key = randomBytes(8).toString('hex')
  const stored = buildStored(base, input)
  const doc = await databases.createDocument(DB_ID, COLLECTIONS.USERS, ID.unique(), {
    // userId/email sont uniques et obligatoires : valeurs synthétiques, jamais utilisées pour se connecter ni pour écrire.
    userId: `hp_${key}`, email: `hp-${key}@hunter-profile.invalid`, role: HUNTER_PROFILE_ROLE, hunterUserId: hunter.userId,
    firstName: clip(input.firstName, 100) || 'Profil', lastName: clip(input.lastName, 100) || 'sans nom',
    city: clip(input.city, 100) || null, phone: stored.candidatePhone ?? null, cvFileId: cvFileId || null,
    cvProfileJson: JSON.stringify(stored), desiredRoles: stored.hunter?.title ?? '', openToWork: false, optedOutOfOutreach: true,
  })
  return docToProfile(doc)
}

export async function createHunterProfile(hunter: Hunter, input: ProfileInput): Promise<{ profile?: HunterProfile; error?: string }> {
  if (!clip(input.firstName, 100) && !clip(input.lastName, 100)) return { error: 'Indiquez au moins un nom.' }
  return { profile: await insertProfile(hunter, input, {}, '') }
}

/** Importe un CV (PDF/Word) : stocké, lu par l'IA (nom, coordonnées, compétences, expériences) et ajouté au vivier. */
export async function importHunterCv(hunter: Hunter, file: File): Promise<{ profile?: HunterProfile; error?: string; extracted?: boolean }> {
  if (!(file instanceof File) || file.size === 0) return { error: 'Fichier vide ou illisible.' }
  if (file.size > 10 * 1024 * 1024) return { error: `« ${file.name} » dépasse 10 Mo.` }
  if (!/\.(pdf|docx?)$/i.test(file.name)) return { error: `« ${file.name} » : format non accepté (PDF ou Word).` }
  try {
    const { storage } = createAdminClient()
    const stored = await storage.createFile(BUCKETS.CVS, ID.unique(), InputFile.fromBuffer(Buffer.from(await file.arrayBuffer()), file.name))
    let extracted: CvProfile | null = null
    try { extracted = await extractCvProfile(stored.$id, BUCKETS.CVS) } catch { /* extraction IA best-effort */ }

    const fallbackName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
    const [first, ...rest] = (extracted?.candidateName || fallbackName).split(/\s+/)
    const profile = await insertProfile(hunter, {
      firstName: first, lastName: rest.join(' '),
      title: extracted?.experiences?.[0]?.title ?? '',
    }, extracted ?? {}, stored.$id)
    return { profile, extracted: !!extracted }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Échec de l’import.' }
  }
}

export async function updateHunterProfile(hunter: Hunter, profileId: string, input: ProfileInput): Promise<{ profile?: HunterProfile; error?: string }> {
  try {
    const doc = await ownedProfileDoc(hunter, profileId)
    const stored = buildStored(parseStored(doc.cvProfileJson), input)
    const { databases } = createAdminClient()
    const updated = await databases.updateDocument(DB_ID, COLLECTIONS.USERS, profileId, {
      firstName: input.firstName !== undefined ? clip(input.firstName, 100) || (doc.firstName as string) : (doc.firstName as string),
      lastName: input.lastName !== undefined ? clip(input.lastName, 100) : (doc.lastName as string),
      city: input.city !== undefined ? clip(input.city, 100) || null : (doc.city as string | null),
      phone: stored.candidatePhone ?? null, desiredRoles: stored.hunter?.title ?? '', cvProfileJson: JSON.stringify(stored),
    })
    return { profile: docToProfile(updated, (await countProposals([profileId])).get(profileId) ?? 0) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

export async function deleteHunterProfile(hunter: Hunter, profileId: string): Promise<{ error?: string }> {
  try {
    const doc = await ownedProfileDoc(hunter, profileId)
    // Un profil déjà proposé reste consultable par les recruteurs (leur pipeline y fait référence) : on ne le supprime pas.
    if (((await countProposals([profileId])).get(profileId) ?? 0) > 0) return { error: 'Ce profil a déjà été proposé à un recruteur : il ne peut plus être supprimé.' }
    const { databases, storage } = createAdminClient()
    await databases.deleteDocument(DB_ID, COLLECTIONS.USERS, profileId)
    if (doc.cvFileId) { try { await storage.deleteFile(BUCKETS.CVS, doc.cvFileId as string) } catch { /* déjà supprimé */ } }
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

// ── Propositions ──────────────────────────────────────────────────────────────

export async function proposeProfiles(hunter: Hunter, jobId: string, profileIds: string[], pitchRaw: string): Promise<{ proposed: number; skipped: string[]; error?: string }> {
  const pitch = clip(pitchRaw, 2800)
  const job = await getJobById(jobId)
  if (!job || !job.isActive || (job.expiresAt && new Date(job.expiresAt) < new Date())) return { proposed: 0, skipped: [], error: 'Cette offre n’est plus ouverte.' }
  if (profileIds.length === 0) return { proposed: 0, skipped: [], error: 'Choisissez au moins un profil à proposer.' }

  const { databases } = createAdminClient()
  const skipped: string[] = []
  const done: HunterProfile[] = []
  for (const id of [...new Set(profileIds)].slice(0, 10)) {
    try {
      const doc = await ownedProfileDoc(hunter, id)
      const profile = docToProfile(doc)
      if (!doc.cvFileId) { skipped.push(`${profile.firstName} ${profile.lastName} : ajoutez un CV avant de le proposer`); continue }
      if (await hasApplied(jobId, id)) { skipped.push(`${profile.firstName} ${profile.lastName} : déjà proposé sur cette offre`); continue }
      const created = await databases.createDocument(DB_ID, COLLECTIONS.APPLICATIONS, ID.unique(), {
        jobId, tenantId: job.tenantId, candidateId: id, cvFileId: doc.cvFileId as string, status: 'pending', coverLetter: pitch || null,
      })
      // Comme pour toute candidature : le matching (score IA + résumé) se lance dès la réception.
      try { after(() => autoScreenApplication(created.$id)) } catch { void autoScreenApplication(created.$id) }
      done.push(profile)
    } catch { skipped.push('Un profil n’a pas pu être proposé') }
  }

  if (done.length > 0) await notifyRecruiter(job.tenantId, job.title, job.$id, hunter, done)
  return { proposed: done.length, skipped }
}

async function notifyRecruiter(tenantId: string, jobTitle: string, jobId: string, hunter: Hunter, profiles: HunterProfile[]) {
  if (!tenantId || process.env.SUPPORT_EMAILS === 'off') return
  try {
    const { databases, messaging } = createAdminClient()
    const tenant = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, tenantId)
    const recruiterId = tenant.recruiterId as string | undefined
    if (!recruiterId) return
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const list = profiles.map(p => `<li style="margin:0 0 6px;"><strong>${esc(`${p.firstName} ${p.lastName}`.trim())}</strong>${p.title ? ` — ${esc(p.title)}` : ''}</li>`).join('')
    const body = `
      <p style="margin:0 0 14px; font-size:14px; line-height:1.7; color:#45454A;"><strong>${esc(hunter.name)}</strong>, chasseur de têtes, vous propose ${profiles.length > 1 ? `${profiles.length} profils` : 'un profil'} pour l’offre <strong>${esc(jobTitle)}</strong> :</p>
      <ul style="margin:0 0 18px; padding-left:18px; font-size:14px; color:#45454A;">${list}</ul>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px auto 6px;"><tr><td style="border-radius:10px; background-color:#E8A33D;"><a href="${origin}/recruiter/pipeline/${jobId}" target="_blank" style="display:inline-block; padding:12px 28px; font-size:14px; font-weight:700; color:#FFFFFF; text-decoration:none; border-radius:10px;">Voir dans le pipeline</a></td></tr></table>`
    await messaging.createEmail(ID.unique(), `Nouveau profil proposé par un chasseur : ${jobTitle}`, wrapEmailHtml('Un chasseur vous propose un profil', body), [], [recruiterId], [], [], [], [], false, true)
  } catch (e) {
    console.error('[hunter] notification recruteur échouée :', e instanceof Error ? e.message : e)
  }
}

export async function listProposals(hunterUserId: string): Promise<HunterProposal[]> {
  const profiles = await listHunterProfiles(hunterUserId)
  if (profiles.length === 0) return []
  const { databases } = createAdminClient()
  const apps: Models.Document[] = []
  for (let i = 0; i < profiles.length; i += 100) {
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.APPLICATIONS, [Query.equal('candidateId', profiles.slice(i, i + 100).map(p => p.id)), Query.orderDesc('$createdAt'), Query.limit(500)])
    apps.push(...res.documents)
  }
  const jobIds = [...new Set(apps.map(a => a.jobId as string))]
  const jobs = new Map<string, { title: string; company: string }>()
  for (let i = 0; i < jobIds.length; i += 100) {
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.JOBS, [Query.equal('$id', jobIds.slice(i, i + 100)), Query.limit(100)]).catch(() => null)
    for (const j of res?.documents ?? []) jobs.set(j.$id, { title: j.title as string, company: (j.companyName as string) || '' })
  }
  const byId = new Map(profiles.map(p => [p.id, p]))
  return apps.map(a => {
    const p = byId.get(a.candidateId as string)!
    const j = jobs.get(a.jobId as string)
    return {
      applicationId: a.$id, profileId: p.id, profileName: `${p.firstName} ${p.lastName}`.trim(), profileTitle: p.title,
      jobId: a.jobId as string, jobTitle: j?.title ?? 'Offre supprimée', company: j?.company ?? '', status: (a.status as string) || 'pending',
      aiScore: typeof a.aiScore === 'number' ? a.aiScore : null, pitch: (a.coverLetter as string) ?? '', createdAt: a.$createdAt,
    }
  })
}
