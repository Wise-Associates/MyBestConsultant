// Core Sourcing IA logic, callable both from the admin-gated server actions
// (src/app/admin/sourcing/actions.ts) and from the automatic trigger fired on
// job creation (src/lib/auto-source-candidates.ts, which has no logged-in user
// to check). This file is NOT 'use server' on purpose — everything exported from
// a 'use server' file becomes a remotely-callable action, and these functions
// skip the admin auth check, so they must never be reachable directly from a client.
import { callLLM } from '@/lib/ai/llm-router'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { Query, ID, type Models } from 'node-appwrite'
import {
  CV_CHARS_FOR_SCORING, criteriaCounts, cvTextForScoring, judgedScore, judgementSummary, offerCriteria, parseJudgements, parseScoringNotes,
  scoringSystemPrompt, scoringUserMessage, type MatchJudgements, type OfferCriteria, type ScoringNotes,
} from '@/lib/match-scoring'
import { listAllByValues, listAllDocuments } from '@/lib/appwrite/list-all'
import { mapLimit } from '@/lib/concurrency'
import { withCheckedTitles } from '@/lib/title-check'

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

/** Texte du CV, `maxChars` caractères au plus (3 000 pour un résumé) ; '' sans texte ou si le fichier est illisible (journalisé). */
export async function extractCVText(cvFileId: string, maxChars = 3000, bucketId: string = BUCKETS.CVS): Promise<string> {
  try {
    return await cvFileText(cvFileId, maxChars, bucketId)
  } catch (e) {
    console.error('[cv] lecture du CV impossible', cvFileId, e instanceof Error ? e.message : e)
    return ''
  }
}

/** Texte d'un fichier CV ; '' s'il n'en a pas (PDF scanné). Lève si le fichier ne peut pas être lu (stockage, fichier abîmé). */
async function cvFileText(cvFileId: string, maxChars: number, bucketId: string): Promise<string> {
  const { storage } = createAdminClient()
  const bytes = await storage.getFileDownload(bucketId, cvFileId)
  const buffer = Buffer.from(bytes)

  const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50
  const isDocx = buffer[0] === 0x50 && buffer[1] === 0x4B

  if (isPdf) {
    if (typeof globalThis.DOMMatrix === 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdf-parse attend DOMMatrix, absent de Node : bouchon minimal sur globalThis, qui n'a pas ce type
      ;(globalThis as any).DOMMatrix = class DOMMatrix { constructor() { return this } }
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fichier interne de pdf-parse (son index lit un PDF d'exemple au chargement), sans types
    const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (buf: Buffer) => Promise<{ text: string }>
    const data = await pdfParse(buffer)
    const text = data.text.replace(/\s{3,}/g, '\n').trim()
    return text.length > 30 ? text.slice(0, maxChars) : ''
  }

  if (isDocx) {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    return result.value.slice(0, maxChars).trim()
  }

  const text = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\tÀ-ɏ]/g, ' ').replace(/\s{3,}/g, '\n').trim()
  return text.length > 50 ? text.slice(0, maxChars) : ''
}

/**
 * Texte d'un CV pour sa notation (cvTextForScoring : coordonnées masquées, borné), le même pour les candidatures, la base
 * candidats et les viviers ; '' s'il n'a pas de texte (PDF scanné) — jamais noté sans son texte. Lève si le fichier ne
 * peut pas être lu : l'appelant ne doit pas le noter sur un autre texte (profil du vivier).
 */
export async function readCvForScoring(cvFileId: string, bucketId: string = BUCKETS.CVS): Promise<string> {
  // Lu au-delà de la borne : les coordonnées masquées raccourcissent ou allongent le texte avant qu'il soit coupé.
  const text = await cvFileText(cvFileId, CV_CHARS_FOR_SCORING * 2, bucketId)
  return text.trim().length > 30 ? cvTextForScoring(text) : ''
}

/**
 * Modèle de toute notation d'un candidat pour une offre : ligne « Matching IA » de Config IA, Claude si elle est sur
 * « Modèle par défaut » (ADR 0029 : une seule ligne, « Screening CV » retirée ; repli habituel si le modèle échoue).
 */
export const SCORING_AI = { module: 'matching', moduleDefault: 'claude' } as const


export interface CandidateMatch {
  candidateId: string
  name: string
  email: string
  score: number
  reason: string
}

/** Candidats notés par passage, les plus récents d'abord (« Rafraîchir » du Matching IA passe ensuite aux suivants). */
const MAX_CANDIDATES = 30
/** Appels d'IA simultanés d'un passage, un par candidat : tous à la fois dépasseraient les limites de débit. */
const SCORING_CONCURRENCY = 5
/** Borne du texte d'un CV noté : définie avec les règles de la notation (match-scoring.ts). */
export { CV_CHARS_FOR_SCORING }

/**
 * `considered` : candidats encore à noter que le passage a pris en charge, notés, en échec ou au CV illisible ; une note
 * enregistrée d'un candidat absent de cette liste n'est plus à garder (runPoolMatching, pool-matching.ts).
 */
export type MatchResult = { matches: CandidateMatch[]; scanned: number; considered?: string[]; error?: string }

/**
 * `exclude` : candidats à ne pas noter en plus de ceux qui ont déjà postulé (déjà notés, mode 'new') ; `only` : les
 * seuls candidats à noter (mode 'all' : ceux déjà notés pour l'offre).
 */
export async function matchCandidatesForJob(jobId: string, { exclude: alsoExclude = new Set<string>(), only }: { exclude?: Set<string>; only?: string[] } = {}): Promise<MatchResult> {
  try {
    const { databases } = createAdminClient()
    const [job, applicants] = await Promise.all([
      databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId),
      listAllDocuments(databases, DB_ID, COLLECTIONS.APPLICATIONS, [Query.equal('jobId', jobId), Query.select(['$id', 'candidateId'])]),
    ])
    const exclude = new Set([...applicants.map(a => a.candidateId as string), ...alsoExclude])
    return await matchCandidatesForOffer(
      { title: String(job.title ?? ''), skills: (job.skills as string[]) ?? [], description: String(job.description ?? '') },
      exclude,
      only,
    )
  } catch (e) {
    return { matches: [], scanned: 0, error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

/** Nom affichable des candidats `ids` (candidat supprimé : absent). */
export async function candidateNames(ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (!ids.length) return names
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [Query.equal('$id', ids.slice(0, 100)), Query.limit(100)])
  for (const d of res.documents) names.set(d.$id, `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim())
  return names
}

/** Offre à rapprocher des candidats : une offre publiée (matchCandidatesForJob) ou un appel d'offres pas encore publié (AO Offers). */
export interface OfferForMatching {
  title: string
  skills: string[]
  description: string
  /** Précisions ajoutées à l'offre envoyée à l'IA (« Technologies : … », « Expérience : … ») ; aucune pour une offre publiée. */
  details?: string[]
}

const CANDIDATE_FIELDS = ['$id', 'firstName', 'lastName', 'email', 'cvFileId', 'optedOutOfOutreach']
const isScorable = (d: Models.Document, exclude: Set<string>) => !!d.cvFileId && !d.optedOutOfOutreach && !exclude.has(d.$id)

/** Parmi `ids`, dans leur ordre, les candidats encore à noter : avec CV, hors désinscrits et hors `exclude`. */
async function scorableCandidates(ids: string[], exclude: Set<string>): Promise<Models.Document[]> {
  const { databases } = createAdminClient()
  const docs = await listAllByValues(databases, DB_ID, COLLECTIONS.USERS, '$id', ids, [Query.equal('role', 'candidate'), Query.select(CANDIDATE_FIELDS)])
  const byId = new Map(docs.map(d => [d.$id, d]))
  return ids.flatMap(id => {
    const d = byId.get(id)
    return d && isScorable(d, exclude) ? [d] : []
  })
}

/** Candidats de la base à noter, les plus récents d'abord : avec CV, hors désinscrits et hors `exclude`. */
async function candidatesToScore(exclude: Set<string>, count: number): Promise<Models.Document[]> {
  const { databases } = createAdminClient()
  const found: Models.Document[] = []
  let cursor: string | undefined
  for (;;) {
    const { documents } = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [
      Query.equal('role', 'candidate'), Query.orderDesc('$createdAt'),
      Query.select(CANDIDATE_FIELDS),
      Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : []),
    ])
    for (const d of documents) {
      if (!isScorable(d, exclude)) continue
      found.push(d)
      if (found.length === count) return found
    }
    if (documents.length < 100) return found
    cursor = documents[documents.length - 1].$id
  }
}

/** Note d'un CV pour une offre : jugements de l'IA (`answer` : sa réponse, preuves comprises), score calculé par le code. */
export interface CvScore {
  score: number
  /** Résumé des jugements, puis la phrase de l'IA : raison affichée partout (Matching IA, pipeline, screening). */
  reason: string
  judgements: MatchJudgements
  criteria: OfferCriteria
  notes: ScoringNotes
  /** Modèle qui a répondu (repli compris). */
  provider: string
  answer: unknown
}

/**
 * La notation d'un CV pour une offre (ADR 0029), la même pour une candidature (screening), la base candidats, le vivier
 * de l'offre et `npm run matching:explain` : consignes et listes de l'offre préparées une fois, puis un appel d'IA par
 * CV. `cvText` : readCvForScoring (ou le profil d'un CV du vivier sans fichier). null : réponse sans jugement lisible
 * (journalisé par l'appelant) ; une erreur de l'IA est levée.
 */
export function cvScorer(offer: OfferForMatching): (cvText: string) => Promise<CvScore | null> {
  // Exigences tirées de la description et compétences : les mêmes listes pour tous les CV notés pour cette offre.
  const criteria = offerCriteria(offer.skills, offer.description)
  const system = scoringSystemPrompt(criteriaCounts(criteria))
  return async cvText => {
    // Une preuve par élément jugé : réponse plus longue qu'une note (et la réflexion du modèle compte dans la limite).
    const { content, provider } = await callLLM([{ role: 'user', content: scoringUserMessage(offer, criteria, cvText) }], system, { ...SCORING_AI, maxTokens: 8000 })
    const json = content.match(/\{[\s\S]*\}/)
    let answer: unknown = null
    try { answer = json ? JSON.parse(json[0]) : null } catch { answer = null }
    // Jugements vérifiés dans le texte du CV que l'IA a lu (citations, intitulés), métiers du titre confirmés par la
    // comparaison des intitulés (title-check.ts).
    const parsed = parseJudgements(answer, criteria, cvText)
    if (!parsed) return null
    const [judgements] = await withCheckedTitles([parsed])
    const notes = parseScoringNotes(answer)
    return {
      score: judgedScore(judgements),
      reason: `${judgementSummary(judgements)}${notes.reason ? ` — ${notes.reason}` : ''}`,
      judgements, criteria, notes, provider, answer,
    }
  }
}

/**
 * Candidats de la base (avec CV, hors désinscrits et hors `excludeCandidateIds`), MAX_CANDIDATES au plus, les plus
 * récents d'abord, notés pour une offre ; les mieux notés d'abord. Partagé par le sourcing des offres publiées et celui
 * des AO. Un appel d'IA par candidat (2026-11-04) : notés 30 par appel, ils étaient désignés par leur identifiant, que
 * l'IA recopiait parfois mal (identifiants créés à quelques secondes d'écart, presque identiques) — une note et sa raison
 * passaient à un autre candidat —, et la note d'un candidat dépendait des autres CV du lot. L'IA juge chaque critère,
 * le code calcule le score (match-scoring.ts). Un CV non noté (IA indisponible, réponse illisible) est compté dans `error`.
 */
export async function matchCandidatesForOffer(
  offer: OfferForMatching, excludeCandidateIds: Set<string> = new Set(), only?: string[],
): Promise<MatchResult> {
  try {
    const scoreCv = cvScorer(offer)
    const scoreOne = async (d: Models.Document): Promise<CandidateMatch | 'failed' | 'unreadable'> => {
      const cvText = await readCvForScoring(d.cvFileId as string).catch(e => {
        console.error('[sourcing] lecture du CV impossible', d.$id, e instanceof Error ? e.message : e)
        return ''
      })
      if (!cvText) return 'unreadable'
      try {
        const scored = await scoreCv(cvText)
        if (!scored) {
          console.error('[sourcing] réponse de l\'IA sans jugement lisible pour un candidat', d.$id)
          return 'failed'
        }
        return {
          candidateId: d.$id,
          name: `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim(),
          email: String(d.email ?? ''),
          score: scored.score,
          reason: scored.reason,
        }
      } catch (e) {
        console.error('[sourcing] notation d\'un candidat en échec', d.$id, e instanceof Error ? e.message : e)
        return 'failed'
      }
    }

    const matches: CandidateMatch[] = []
    const considered: string[] = []
    let failed = 0
    let scanned = 0
    const scoreBatch = async (batch: Models.Document[]) => {
      const outcomes = await mapLimit(batch, SCORING_CONCURRENCY, scoreOne)
      outcomes.forEach((o, i) => {
        considered.push(batch[i].$id)
        if (o === 'unreadable') return
        scanned++
        if (o === 'failed') failed++
        else matches.push(o)
      })
    }
    if (only) await scoreBatch(await scorableCandidates(only, excludeCandidateIds))
    else {
      // Un CV illisible (PDF scanné…) ne compte pas : le passage continue avec les candidats suivants, sinon les mêmes
      // CV illisibles bloqueraient la notation des nouveaux candidats à chaque clic. 3 tours au plus.
      const tried = new Set(excludeCandidateIds)
      for (let round = 0; round < 3 && scanned < MAX_CANDIDATES; round++) {
        const batch = await candidatesToScore(tried, MAX_CANDIDATES - scanned)
        if (batch.length === 0) break
        for (const d of batch) tried.add(d.$id)
        await scoreBatch(batch)
      }
    }
    if (considered.length === 0) {
      return { matches, scanned, considered, error: excludeCandidateIds.size > 0 ? 'Aucun nouveau candidat avec CV à noter' : 'Aucun candidat avec CV dans la base pour le moment' }
    }

    matches.sort((a, b) => b.score - a.score)
    if (matches.length === 0) {
      return { matches, scanned, considered, error: failed > 0 ? 'Notation impossible : IA indisponible ou réponses illisibles. Réessayez dans quelques minutes.' : 'Aucun CV lisible parmi les candidats' }
    }
    return { matches, scanned, considered, error: failed > 0 ? `${failed} CV non noté${failed > 1 ? 's' : ''} (IA indisponible ou réponse illisible) : relancez la notation.` : undefined }
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
