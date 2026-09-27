// Core Sourcing IA logic, callable both from the admin-gated server actions
// (src/app/admin/sourcing/actions.ts) and from the automatic trigger fired on
// job creation (src/lib/auto-source-candidates.ts, which has no logged-in user
// to check). This file is NOT 'use server' on purpose — everything exported from
// a 'use server' file becomes a remotely-callable action, and these functions
// skip the admin auth check, so they must never be reachable directly from a client.
import { callLLM } from '@/lib/ai/llm-router'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { Query, ID } from 'node-appwrite'

export function wrapEmailHtml(title: string, bodyHtml: string): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F3F4F8; padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background-color:#FFFFFF; border-radius:16px; overflow:hidden; border:1px solid #E5E9F5;">
      <tr>
        <td style="background-color:#0B1D51; padding:32px 40px; text-align:center;">
          <span style="font-family:Georgia, 'Times New Roman', serif; font-weight:300; font-size:22px; color:#FFFFFF; letter-spacing:0.5px;">My Best Consultant</span>
        </td>
      </tr>
      <tr>
        <td style="padding:40px;">
          <h1 style="margin:0 0 16px; font-family:Georgia, 'Times New Roman', serif; font-weight:700; font-size:20px; color:#0B1D51;">${title}</h1>
          ${bodyHtml}
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px; background-color:#FAFBFD; border-top:1px solid #E5E9F5; text-align:center;">
          <p style="margin:0; font-size:11px; color:#ADB5CC;">My Best Consultant · La plateforme AI des consultants</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>`
}

export async function extractCVText(cvFileId: string): Promise<string> {
  try {
    const { storage } = createAdminClient()
    const bytes = await storage.getFileDownload(BUCKETS.CVS, cvFileId)
    const buffer = Buffer.from(bytes)

    const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50
    const isDocx = buffer[0] === 0x50 && buffer[1] === 0x4B

    if (isPdf) {
      if (typeof globalThis.DOMMatrix === 'undefined') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(globalThis as any).DOMMatrix = class DOMMatrix { constructor() { return this } }
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (buf: Buffer) => Promise<{ text: string }>
      const data = await pdfParse(buffer)
      const text = data.text.replace(/\s{3,}/g, '\n').trim()
      return text.length > 30 ? text.slice(0, 3000) : ''
    }

    if (isDocx) {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      return result.value.slice(0, 3000).trim()
    }

    const text = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\tÀ-ɏ]/g, ' ').replace(/\s{3,}/g, '\n').trim()
    return text.length > 50 ? text.slice(0, 3000) : ''
  } catch {
    return ''
  }
}

export interface CandidateMatch {
  candidateId: string
  name: string
  email: string
  score: number
  reason: string
}

const MAX_CANDIDATES = 30

export async function matchCandidatesForJob(jobId: string): Promise<{ matches: CandidateMatch[]; scanned: number; error?: string }> {
  try {
    const { databases } = createAdminClient()

    const job = await databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId)

    const [candidatesRes, applicantsRes] = await Promise.all([
      databases.listDocuments(DB_ID, COLLECTIONS.USERS, [
        Query.equal('role', 'candidate'),
        Query.limit(200),
      ]),
      databases.listDocuments(DB_ID, COLLECTIONS.APPLICATIONS, [
        Query.equal('jobId', jobId),
        Query.limit(500),
      ]),
    ])
    const alreadyApplied = new Set(applicantsRes.documents.map(a => a.candidateId as string))

    const withCv = candidatesRes.documents
      .filter(d => d.cvFileId && !d.optedOutOfOutreach && !alreadyApplied.has(d.$id))
      .slice(0, MAX_CANDIDATES)
    if (withCv.length === 0) return { matches: [], scanned: 0, error: 'Aucun candidat avec CV dans la base pour le moment' }

    const profiles = await Promise.all(withCv.map(async d => ({
      candidateId: d.$id,
      name: `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim(),
      email: d.email as string,
      cvText: await extractCVText(d.cvFileId as string),
    })))
    const usable = profiles.filter(p => p.cvText.length > 30)
    if (usable.length === 0) return { matches: [], scanned: profiles.length, error: 'Aucun CV lisible parmi les candidats' }

    const SYSTEM = `Tu es un expert en sourcing de candidats. On te donne une offre d'emploi et une liste de candidats (avec extrait de CV). Évalue la pertinence de chaque candidat pour ce poste.

Réponds UNIQUEMENT avec un tableau JSON valide, sans markdown :
[{"candidateId":"...","score":0-100,"reason":"une phrase expliquant pourquoi ce candidat correspond (ou pas)"}]

Inclus tous les candidats, même les moins pertinents (score bas). Sois honnête et précis sur le score.`

    const candidatesBlock = usable.map(p => `--- Candidat [${p.candidateId}] ${p.name} ---\n${p.cvText}`).join('\n\n')
    const userMsg = `=== OFFRE ===\nPoste : ${job.title}\nCompétences recherchées : ${((job.skills as string[]) ?? []).join(', ')}\nDescription : ${(job.description as string ?? '').slice(0, 1200)}\n\n=== CANDIDATS ===\n${candidatesBlock}`

    const { content } = await callLLM([{ role: 'user', content: userMsg }], SYSTEM, { module: 'matching' })
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return { matches: [], scanned: usable.length, error: 'Réponse IA invalide' }

    const parsed = JSON.parse(jsonMatch[0]) as { candidateId: string; score: number; reason: string }[]
    const byId = new Map(usable.map(p => [p.candidateId, p]))

    const matches: CandidateMatch[] = parsed
      .filter(m => byId.has(m.candidateId))
      .map(m => ({
        candidateId: m.candidateId,
        name: byId.get(m.candidateId)!.name,
        email: byId.get(m.candidateId)!.email,
        score: Math.min(100, Math.max(0, Number(m.score) || 0)),
        reason: String(m.reason ?? ''),
      }))
      .sort((a, b) => b.score - a.score)

    return { matches, scanned: usable.length }
  } catch (e) {
    return { matches: [], scanned: 0, error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

export async function generateOutreachMessageCore(candidateId: string, jobId: string): Promise<{ subject: string; message: string; error?: string }> {
  try {
    const { databases } = createAdminClient()
    const [candidate, job] = await Promise.all([
      databases.getDocument(DB_ID, COLLECTIONS.USERS, candidateId),
      databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId),
    ])

    const SYSTEM = `Tu rédiges un premier message de prise de contact d'un recruteur vers un candidat, pour lui proposer une mission. Ton : professionnel, chaleureux, direct, pas de flatterie excessive. 5-8 phrases maximum. Signe "L'équipe MyBestConsultant".

Réponds UNIQUEMENT avec un JSON valide : {"subject":"...", "message":"..."}
- "subject" est OBLIGATOIRE et JAMAIS vide : une ligne d'objet courte et concrète (ex: "Opportunité — Développeur Fullstack .NET chez [client]")
- "message" en texte brut, sauts de ligne avec \\n`
    const userMsg = `Candidat : ${candidate.firstName} ${candidate.lastName}\nOffre : ${job.title}\nCompétences recherchées : ${((job.skills as string[]) ?? []).join(', ')}\nLieu : ${job.location}`

    const { content } = await callLLM([{ role: 'user', content: userMsg }], SYSTEM)
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { subject: '', message: '', error: 'Réponse IA invalide' }
    const parsed = JSON.parse(jsonMatch[0])
    const subject = String(parsed.subject ?? '').trim() || `Opportunité — ${job.title}`
    return { subject, message: String(parsed.message ?? '') }
  } catch (e) {
    return { subject: '', message: '', error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

export async function sendOutreachEmailCore(candidateId: string, subject: string, message: string): Promise<{ ok?: boolean; error?: string }> {
  try {
    const { databases, messaging } = createAdminClient()
    const candidate = await databases.getDocument(DB_ID, COLLECTIONS.USERS, candidateId)
    const authId = candidate.userId as string
    if (!authId) return { error: 'Compte candidat introuvable' }

    const bodyHtml = message
      .split('\n')
      .map(line => `<p style="margin:0 0 12px; font-size:14px; line-height:1.7; color:#3D4566;">${line || '&nbsp;'}</p>`)
      .join('')

    const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
    const unsubscribeUrl = `${origin}/desabonnement?u=${candidateId}`
    const unsubscribeHtml = `<p style="margin:24px 0 0; font-size:12px; line-height:1.6; color:#ADB5CC;">Vous ne souhaitez plus recevoir ce type de proposition ? <a href="${unsubscribeUrl}" style="color:#ADB5CC;">Se désabonner</a>.</p>`

    await messaging.createEmail(
      ID.unique(),
      subject,
      wrapEmailHtml(subject, bodyHtml + unsubscribeHtml),
      [], [authId], [], [], [], [], false, true,
    )
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'envoi' }
  }
}
