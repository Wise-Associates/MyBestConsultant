// Core Sourcing IA logic, callable both from the admin-gated server actions
// (src/app/admin/sourcing/actions.ts) and from the automatic trigger fired on
// job creation (src/lib/auto-source-candidates.ts, which has no logged-in user
// to check). This file is NOT 'use server' on purpose — everything exported from
// a 'use server' file becomes a remotely-callable action, and these functions
// skip the admin auth check, so they must never be reachable directly from a client.
import { parseModelJson } from '@/lib/ai/model-json'
import { callLLM, primaryModel } from '@/lib/ai/llm-router'
import { scoreCacheId } from '@/lib/score-cache'
import { readCachedCriteriaScore, readCachedScore, writeCachedScore } from '@/lib/appwrite/score-cache'
import {
  criteriaJudgedScore, criteriaSummary, criteriaSystemPrompt, criteriaUserMessage, parseCriteriaJudgements, type CriteriaJudgements,
} from '@/lib/criteria-scoring'
import { criteriaFingerprint, type OfferCriteriaSet } from '@/lib/offer-criteria'
import { loadOfferCriteria } from '@/lib/offer-criteria-store'
import { PREFILTER_KEEP, offerLocation, prefilterPool } from '@/lib/search/prefilter'
import type { FilterResult } from '@/lib/search/offer-filter'
import { SCORING_AI } from '@/lib/ai/models'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { AppwriteException, Query, type Models } from 'node-appwrite'
import { isDocumentId } from '@/lib/ao/access'
import { creatorReplyTo, escapeHtml, outreachEmailBody } from '@/lib/outreach-email'
import { sendSmtpEmail, type MailAddress } from '@/lib/smtp'
import {
  CV_CHARS_FOR_SCORING, criteriaCounts, cvTextForScoring, judgedScore, judgementSummary, offerCriteria, offerDetails, parseJudgements,
  parseScoringNotes, scoringSystemPrompt, scoringUserMessage, sourceContextForScoring, type ActiveScale, type MatchJudgements, type OfferCriteria, type ScoringNotes,
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
      {
        title: String(job.title ?? ''), skills: (job.skills as string[]) ?? [], description: String(job.description ?? ''), details: offerDetails(job),
        sourceContext: await aoSourceContext(job),
        criteria: await loadOfferCriteria(jobId),
      },
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
  /** Précisions ajoutées à l'offre envoyée à l'IA : lieu, télétravail, rémunération (offerDetails), « Technologies : … » d'un AO. */
  details?: string[]
  /** Offre publiée depuis un appel d'offres : sa description d'origine (aoSourceContext), contexte interne de la notation. */
  sourceContext?: string
  /** Critères de l'offre (ADR 0061) : notation « matching » sur eux (v3) ; absents, sur le barème (v2). */
  criteria?: OfferCriteriaSet | null
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

const isNotFound = (err: unknown) => (err as { code?: unknown } | null)?.code === 404
/** Document ou null s'il n'existe pas (toute autre erreur est remontée). */
async function documentOrNull(collection: string, id: string): Promise<Models.Document | null> {
  return createAdminClient().databases.getDocument(DB_ID, collection, id).catch(err => {
    if (isNotFound(err)) return null
    throw err
  })
}

/**
 * Précisions de l'offre pour le score final (ADR 0036) : lieu, télétravail, rémunération et clients. Offre publiée depuis
 * un appel d'offres (`ao<offre AO>`) : son client et les clients que cite l'e-mail (client final d'un intermédiaire,
 * « AO BNP ») — noms réels, lus par l'IA de la notation, jamais publiés ; sinon l'entreprise de l'offre. Lecture
 * impossible : lève (pas de score final sans le client).
 */
export async function finalOfferDetails(job: Models.Document): Promise<string[]> {
  const clients = [typeof job.companyName === 'string' ? job.companyName : '']
  // Identifiant d'une offre ordinaire : hexadécimal (ID.unique()), il ne commence jamais par « ao ».
  if (job.$id.startsWith('ao')) {
    const aoOffer = await documentOrNull(COLLECTIONS.AO_OFFERS, job.$id.slice(2))
    if (aoOffer) {
      const email = typeof aoOffer.emailId === 'string' && aoOffer.emailId ? await documentOrNull(COLLECTIONS.AO_EMAILS, aoOffer.emailId) : null
      const cited = Array.isArray(email?.citedClients) ? email.citedClients.filter((c): c is string => typeof c === 'string') : []
      clients.unshift(typeof aoOffer.companyName === 'string' ? aoOffer.companyName : '', ...cited)
    }
  }
  return offerDetails(job, clients)
}

/**
 * Offre publiée depuis un appel d'offres (`ao<offre AO>`) : description d'origine de l'AO, lue par l'IA de la notation
 * pour le contexte métier que la version publiée n'a plus (sourceContextForScoring). Autre offre, AO supprimé (purge à
 * 365 jours) ou sans description : ''. Lecture impossible : '' et journalisé, la notation se fait comme avant.
 */
export async function aoSourceContext(job: { $id: string }): Promise<string> {
  if (!job.$id.startsWith('ao')) return ''
  try {
    const aoOffer = await documentOrNull(COLLECTIONS.AO_OFFERS, job.$id.slice(2))
    return typeof aoOffer?.description === 'string' ? sourceContextForScoring(aoOffer.description) : ''
  } catch (err) {
    console.error('[matching] description d’origine de l’appel d’offres illisible, notation sans elle', job.$id, err instanceof Error ? err.message : err)
    return ''
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

/** Score (poids par défaut actuels) et raison d'une notation : résumé des jugements, puis la phrase de l'IA. */
const scoredFrom = (judgements: MatchJudgements, notes: ScoringNotes) => ({
  score: judgedScore(judgements),
  reason: `${judgementSummary(judgements)}${notes.reason ? ` — ${notes.reason}` : ''}`,
})

/**
 * La notation d'un CV pour une offre (ADR 0029), la même pour une candidature (screening), la base candidats, le vivier
 * de l'offre et `npm run matching:explain` ; seul le barème change (ADR 0036) : `matching` pour les CV disponibles,
 * `final` pour une candidature. Consignes et listes de l'offre préparées une fois, puis un appel d'IA par CV. `cvText` :
 * readCvForScoring (ou le profil d'un CV du vivier sans fichier). null : réponse sans jugement lisible (journalisé par
 * l'appelant) ; une erreur de l'IA est levée.
 * ADR 0044 : une notation déjà faite pour exactement les mêmes consignes, offre, CV et modèle est reprise du cache
 * (`useCache` : false pour `matching:explain`, qui montre ce que l'IA répond) ; consignes et offre, début identique de
 * chaque appel, sont mises en cache chez Claude.
 */
export function cvScorer(offer: OfferForMatching, scale: ActiveScale, { useCache = true }: { useCache?: boolean } = {}): (cvText: string) => Promise<CvScore | null> {
  // Exigences tirées de la description et compétences : les mêmes listes pour tous les CV notés pour cette offre.
  const criteria = offerCriteria(offer.skills, offer.description)
  const system = scoringSystemPrompt(scale, criteriaCounts(criteria))
  const offerPrefix = scoringUserMessage(offer, criteria, '')
  return async cvText => {
    const user = scoringUserMessage(offer, criteria, cvText)
    const model = useCache ? await primaryModel(SCORING_AI) : null
    const cacheId = model && scoreCacheId({ model: model.signature, scale, system, user })
    const cached = cacheId ? await readCachedScore(cacheId, scale) : null
    // Score et résumé refaits d'après les jugements gardés : les poids par défaut ont pu changer depuis (ADR 0049).
    if (cached) return { ...cached, ...scoredFrom(cached.judgements, cached.notes), criteria }

    const { answer, provider } = await askScoring(system, user, offerPrefix)
    // Jugements vérifiés dans le texte du CV que l'IA a lu (citations, intitulés), métiers du titre confirmés par la
    // comparaison des intitulés (title-check.ts).
    const parsed = parseJudgements(answer, criteria, cvText, scale)
    if (!parsed) return null
    const [judgements] = await withCheckedTitles([parsed])
    const notes = parseScoringNotes(answer)
    const scored: CvScore = { ...scoredFrom(judgements, notes), judgements, criteria, notes, provider, answer }
    // Gardée seulement si elle vient du modèle choisi : la réponse d'un modèle de repli n'est pas reprise ensuite.
    if (cacheId && model && provider === model.provider) {
      await writeCachedScore(cacheId, { score: scored.score, reason: scored.reason, judgements, notes, provider, answer })
    }
    return scored
  }
}

/** Appel de la notation : objet JSON de la réponse (null si illisible) et modèle qui a répondu. */
async function askScoring(system: string, user: string, offerPrefix: string): Promise<{ answer: unknown; provider: string }> {
  // Une preuve par élément jugé : réponse plus longue qu'une note (et la réflexion du modèle compte dans la limite).
  const { content, provider } = await callLLM([{ role: 'user', content: user }], system, { ...SCORING_AI, maxTokens: 8000, timeoutMs: 120_000, cachePrefix: offerPrefix })
  const json = content.match(/\{[\s\S]*\}/)
  let answer: unknown = null
  try { answer = json ? parseModelJson(json[0]) : null } catch { answer = null }
  return { answer, provider }
}

/** Note d'un CV sur les critères d'une offre (v3, ADR 0061) : jugements par libellé, score calculé par le code. */
export interface CriteriaCvScore {
  score: number
  /** Résumé des jugements (lettres, criteria-scoring.ts), puis la phrase de l'IA. */
  reason: string
  judgements: CriteriaJudgements
  set: OfferCriteriaSet
  notes: ScoringNotes
  provider: string
  answer: unknown
}

/** Score (poids des critères `set`) et raison d'une notation sur critères. */
const scoredOnCriteria = (judgements: CriteriaJudgements, set: OfferCriteriaSet, notes: ScoringNotes) => ({
  score: criteriaJudgedScore(judgements, set),
  reason: `${criteriaSummary(judgements)}${notes.reason ? ` — ${notes.reason}` : ''}`,
})

/**
 * Notation d'un CV sur les critères d'une offre (ADR 0061) : comme cvScorer (même modèle, même texte du CV, même
 * vérification des citations et des intitulés, même cache), mais l'IA juge chaque libellé des critères. Seuls les
 * libellés lui sont envoyés : une notation gardée vaut pour toute pondération des mêmes libellés.
 */
export function criteriaScorer(offer: OfferForMatching, set: OfferCriteriaSet, { useCache = true }: { useCache?: boolean } = {}): (cvText: string) => Promise<CriteriaCvScore | null> {
  const system = criteriaSystemPrompt(set)
  const offerPrefix = criteriaUserMessage(offer, set, '')
  const fingerprint = criteriaFingerprint(set)
  return async cvText => {
    const user = criteriaUserMessage(offer, set, cvText)
    const model = useCache ? await primaryModel(SCORING_AI) : null
    const cacheId = model && scoreCacheId({ model: model.signature, scale: 'matching', system, user })
    const cached = cacheId ? await readCachedCriteriaScore(cacheId, fingerprint) : null
    if (cached) return { ...cached, ...scoredOnCriteria(cached.judgements, set, cached.notes), set }

    const { answer, provider } = await askScoring(system, user, offerPrefix)
    const parsed = parseCriteriaJudgements(answer, set, cvText)
    if (!parsed) return null
    const [judgements] = await withCheckedTitles([parsed])
    const notes = parseScoringNotes(answer)
    const scored: CriteriaCvScore = { ...scoredOnCriteria(judgements, set, notes), judgements, set, notes, provider, answer }
    if (cacheId && model && provider === model.provider) {
      await writeCachedScore(cacheId, { score: scored.score, reason: scored.reason, judgements, notes, provider, answer })
    }
    return scored
  }
}

/** Notation « matching » d'une offre : sur ses critères quand elle en a (v3, ADR 0061), sinon sur le barème (v2). */
export function matchingScorer(offer: OfferForMatching, options: { useCache?: boolean } = {}): (cvText: string) => Promise<CvScore | CriteriaCvScore | null> {
  return offer.criteria ? criteriaScorer(offer, offer.criteria, options) : cvScorer(offer, 'matching', options)
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
    const scoreCv = matchingScorer(offer)
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
    // Résultat du filtre des critères (ADR 0061 phase 2) : null sans préfiltre, ou pour une liste imposée (`only`).
    let filtered: FilterResult | null = null
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
      // ADR 0044 phase 2 : les CV de toute la base les plus proches de l'offre (index de recherche), revérifiés dans
      // Appwrite (CV, désinscription, exclusions) ; null sans préfiltre (non configuré ou en panne) : comme avant.
      // ADR 0061 phase 2 : puis filtrés sur les critères de l'offre (★ requis, assouplis pas à pas, offer-filter.ts).
      filtered = await prefilterPool(
        { title: offer.title, skills: offer.skills, location: offerLocation(offer.details) }, excludeCandidateIds, offer.criteria)
      if (filtered?.ids.length) await scoreBatch(await scorableCandidates(filtered.ids, excludeCandidateIds))
      // Les plus récents ne complètent que sans préfiltre (non configuré, en panne) ou quand l'index ne connaît aucun CV
      // pour l'offre (index vide, CV pas encore classés) : sinon le filtre a choisi les seuls CV qui valent un appel
      // d'IA (« un minimum de candidats à noter », demande du 2026-11-24) — en ajouter d'autres paierait des CV qu'il a
      // écartés ; un CV illisible parmi eux n'est pas remplacé. Pour les plus récents, un CV illisible (PDF scanné…) ne
      // compte pas : le passage continue avec les suivants, sinon les mêmes CV illisibles bloqueraient la notation des
      // nouveaux candidats à chaque clic. 3 tours au plus.
      const target = !filtered ? MAX_CANDIDATES : filtered.indexed ? 0 : PREFILTER_KEEP
      const tried = new Set([...excludeCandidateIds, ...considered])
      for (let round = 0; round < 3 && scanned < target; round++) {
        const batch = await candidatesToScore(tried, target - scanned)
        if (batch.length === 0) break
        for (const d of batch) tried.add(d.$id)
        await scoreBatch(batch)
      }
    }
    if (considered.length === 0) {
      const error = filtered && filtered.ids.length > 0
        ? 'Les CV retenus pour cette offre ne sont plus disponibles (supprimés ou désinscrits) : relancez plus tard.'
        : filtered && filtered.found > 0 && filtered.excluded === filtered.found
          ? 'Aucun candidat de la base n’a les technologies requises (★) de l’offre.'
          : excludeCandidateIds.size > 0 ? 'Aucun nouveau candidat avec CV à noter' : 'Aucun candidat avec CV dans la base pour le moment'
      return { matches, scanned, considered, error }
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
    const parsed = parseModelJson(jsonMatch[0]) as Record<string, unknown>
    const subject = String(parsed.subject ?? '').trim() || `Opportunité — ${job.title}`
    return { subject, message: String(parsed.message ?? '') }
  } catch (e) {
    return { subject: '', message: '', error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

// Envoyé par SMTP direct et non par Appwrite Messaging (ADR 0050) : les réponses du candidat vont au recruteur qui a
// créé l'offre (Reply-To), ce que Messaging ne permet pas message par message.
export async function sendOutreachEmailCore(candidateId: string, jobId: string, subject: string, message: string): Promise<{ ok?: boolean; error?: string }> {
  try {
    if (!isDocumentId(candidateId) || !isDocumentId(jobId)) return { error: 'Candidat ou offre invalide' }
    const title = subject.trim()
    if (!title || !message.trim()) return { error: 'Objet et message requis' }
    const { databases, users } = createAdminClient()
    const [candidate, job] = await Promise.all([
      databases.getDocument(DB_ID, COLLECTIONS.USERS, candidateId),
      databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId),
    ])
    // Même règle que le classement (isScorable), relue à l'envoi : le candidat a pu se désabonner pendant la notation.
    if (candidate.role !== 'candidate' || candidate.optedOutOfOutreach) return { error: 'Candidat désabonné ou introuvable' }
    const authId = candidate.userId as string
    if (!authId) return { error: 'Compte candidat introuvable' }
    // Adresse du compte, celle à laquelle Appwrite Messaging envoyait. Compte désactivé : on ne le démarche pas.
    const account = await users.get(authId)
    if (!account.status) return { error: 'Compte candidat désactivé' }
    const replyTo = await offerCreatorAddress(job.postedBy as string | undefined)
    if (!replyTo) console.warn('[sourcing] auteur de l\'offre introuvable, désactivé ou adresse non vérifiée : réponses à l\'adresse d\'envoi', jobId)

    const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
    const bodyHtml = outreachEmailBody({
      message,
      jobUrl: `${origin}/jobs/${jobId}`,
      unsubscribeUrl: `${origin}/desabonnement?u=${candidateId}`,
      repliesToRecruiter: !!replyTo,
    })
    await sendSmtpEmail({
      to: { name: `${candidate.firstName ?? ''} ${candidate.lastName ?? ''}`.trim(), address: account.email },
      replyTo: replyTo ?? undefined,
      subject: title,
      html: wrapEmailHtml(escapeHtml(title), bodyHtml),
    })
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'envoi' }
  }
}

/**
 * Compte du recruteur qui a créé l'offre (jobs.postedBy, profil : ADR 0023), règle dans creatorReplyTo. Profil ou compte
 * supprimé (membre retiré de l'équipe) : null. Autre erreur d'Appwrite : levée, l'e-mail ne part pas plutôt que de
 * partir sans Reply-To (la réponse du candidat serait perdue).
 */
async function offerCreatorAddress(postedBy: string | undefined): Promise<MailAddress | null> {
  if (!postedBy) return null
  const { databases, users } = createAdminClient()
  try {
    const profile = await databases.getDocument(DB_ID, COLLECTIONS.USERS, postedBy)
    if (!profile.userId) return null
    return creatorReplyTo(profile, await users.get(profile.userId as string))
  } catch (e) {
    if (e instanceof AppwriteException && e.code === 404) return null
    throw e
  }
}
