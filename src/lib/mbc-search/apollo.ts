import 'server-only'

import { callLLM } from '@/lib/ai/llm-router'
import { SCORING_AI } from '@/lib/ai/models'
import { titleCheckPrompt, type TitlePair } from '@/lib/match-scoring'
import {
  parseApolloMatches, parseApolloPeople, retryDelayMs, toApolloQuery, toRevealRequest, type MbcCriteria, type MbcProfile, type MbcRevealed,
  type OutreachChannel,
} from './rules'
import { parsePhoneRequest, type MbcPhoneNumber } from './phone'
import {
  briefCriteriaPrompt, briefQuestionsPrompt, outreachPrompt, refinePrompt, strategiesPrompt, type MbcPrompt,
} from './prompts'

// Appels externes de MBC Search (ADR 0018) : recherche et enrichissement de personnes d'Apollo.io, lecture du brief par l'IA.
// Côté serveur seulement : la clé APOLLO_API_KEY n'est jamais envoyée au navigateur. Les journaux ne contiennent ni
// le brief ni les profils (données personnelles), seulement le statut et le type d'erreur.

const APOLLO_SEARCH_URL = 'https://api.apollo.io/api/v1/mixed_people/api_search'
// Enrichissement : ni e-mails personnels ni téléphones (RGPD) ; le téléphone se demande à part, personne par personne (ADR 0042).
const APOLLO_REVEAL_URL = 'https://api.apollo.io/api/v1/people/bulk_match?reveal_personal_emails=false&reveal_phone_number=false'
// Téléphone, à la demande du recruteur seulement (ADR 0042) : cherché en différé par Apollo et relu par nous (poll_only :
// pas de webhook à exposer), jusqu'à 8 crédits de plus par numéro trouvé.
const APOLLO_PHONE_URL = 'https://api.apollo.io/api/v1/people/match?reveal_personal_emails=false&reveal_phone_number=true&poll_only=true'
const APOLLO_RESULT_URL = 'https://api.apollo.io/api/v1/webhook_result/'
const APOLLO_TIMEOUT_MS = 15_000
const BRIEF_TIMEOUT_MS = 30_000

/**
 * Échec d'Apollo, avec le message à montrer au recruteur. `blocking` : l'échec se répéterait pour toute autre requête
 * (clé absente ou refusée, crédits épuisés, débit dépassé) : une recherche en plusieurs requêtes s'arrête.
 */
export class ApolloSearchError extends Error {
  constructor(message: string, readonly blocking: boolean = false) {
    super(message)
  }
}

export function isApolloConfigured(): boolean {
  return Boolean(process.env.APOLLO_API_KEY)
}

/** Recherches Apollo restantes du jour en dessous desquelles un avertissement est journalisé (pour l'exploitation). */
const LOW_DAILY_SEARCHES = 100

/**
 * Appel à Apollo avec la clé de la plateforme ; erreurs traduites pour le recruteur, statut seul dans les journaux.
 * `retry` : un second essai après un refus passager (`retryDelayMs`) ; seulement pour la recherche, gratuite : un
 * enrichissement est payant.
 */
async function postApollo(url: string, body: unknown, what: string, retry = false): Promise<unknown> {
  const apiKey = process.env.APOLLO_API_KEY
  if (!apiKey) throw new ApolloSearchError('La recherche Apollo n\'est pas configurée sur la plateforme : contactez le support.', true)
  for (let attempt = 1; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'x-api-key': apiKey },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: AbortSignal.timeout(APOLLO_TIMEOUT_MS),
      })
    } catch (err) {
      console.error(`[mbc-search] Apollo injoignable (${what})`, err instanceof Error ? err.name : 'inconnu')
      throw new ApolloSearchError('Apollo ne répond pas : réessayez dans quelques instants.')
    }
    if (res.ok) {
      const left = Number(res.headers.get('x-24-hour-requests-left') ?? NaN)
      if (Number.isFinite(left) && left < LOW_DAILY_SEARCHES) console.warn(`[mbc-search] Apollo : ${left} demandes restantes aujourd'hui (${what})`)
      return res.json().catch(() => null)
    }
    const wait = retry && attempt === 1 ? retryDelayMs(res.status, res.headers.get('retry-after')) : null
    console.error(`[mbc-search] Apollo a refusé la demande (${what})`, res.status, wait === null ? '' : `nouvel essai dans ${wait} ms`)
    if (wait !== null) {
      await new Promise(resolve => setTimeout(resolve, wait))
      continue
    }
    if (res.status === 429) throw new ApolloSearchError('Trop de demandes envoyées à Apollo : réessayez dans une minute.', true)
    if (res.status === 401 || res.status === 403) throw new ApolloSearchError('La clé Apollo de la plateforme est refusée : contactez le support.', true)
    if (res.status === 402) throw new ApolloSearchError('Crédits Apollo de la plateforme épuisés : contactez le support.', true)
    throw new ApolloSearchError('Apollo n\'a pas pu traiter la demande : modifiez les critères ou réessayez.')
  }
}

export async function searchApolloPeople(criteria: MbcCriteria, page: number, perPage: number): Promise<{ total: number; profiles: MbcProfile[] }> {
  const parsed = parseApolloPeople(await postApollo(APOLLO_SEARCH_URL, toApolloQuery(criteria, page, perPage), 'recherche', true))
  if (!parsed) {
    console.error('[mbc-search] réponse de recherche Apollo d\'une forme inattendue')
    throw new ApolloSearchError('Réponse d\'Apollo illisible : réessayez dans quelques instants.')
  }
  return parsed
}

/** Profils complets (10 au plus, payants : un crédit par personne trouvée). */
export async function revealApolloPeople(ids: string[]): Promise<MbcRevealed[]> {
  const parsed = parseApolloMatches(await postApollo(APOLLO_REVEAL_URL, toRevealRequest(ids), 'enrichissement'))
  if (!parsed) {
    console.error('[mbc-search] réponse d\'enrichissement Apollo d\'une forme inattendue')
    throw new ApolloSearchError('Réponse d\'Apollo illisible : réessayez dans quelques instants.')
  }
  return parsed
}

/** Demande le téléphone d'une personne : numéros déjà donnés et, si Apollo cherche encore, le numéro de la demande. */
export async function requestApolloPhone(id: string): Promise<{ numbers: MbcPhoneNumber[]; requestId: string | null }> {
  const parsed = parsePhoneRequest(await postApollo(APOLLO_PHONE_URL, { id }, 'téléphone'))
  if (!parsed) {
    console.error('[mbc-search] réponse de la demande de téléphone d\'une forme inattendue')
    throw new ApolloSearchError('Réponse d\'Apollo illisible : réessayez dans quelques instants.')
  }
  return parsed
}

/**
 * Relit le résultat d'une demande de téléphone (sans crédit) : `pending` tant qu'Apollo cherche, `gone` si la demande est
 * inconnue ou périmée (30 jours), sinon la réponse à lire avec parsePhoneResult.
 */
export async function pollApolloPhone(requestId: string): Promise<{ state: 'pending' } | { state: 'gone' } | { state: 'done'; json: unknown }> {
  const apiKey = process.env.APOLLO_API_KEY
  if (!apiKey) throw new ApolloSearchError('La recherche Apollo n\'est pas configurée sur la plateforme : contactez le support.', true)
  let res: Response
  try {
    res = await fetch(APOLLO_RESULT_URL + encodeURIComponent(requestId), {
      headers: { 'Cache-Control': 'no-cache', 'x-api-key': apiKey }, cache: 'no-store', signal: AbortSignal.timeout(APOLLO_TIMEOUT_MS),
    })
  } catch (err) {
    console.error('[mbc-search] Apollo injoignable (résultat du téléphone)', err instanceof Error ? err.name : 'inconnu')
    throw new ApolloSearchError('Apollo ne répond pas : réessayez dans quelques instants.')
  }
  const body: unknown = await res.json().catch(() => null)
  if (res.ok) return { state: 'done', json: body }
  const code = (body as { error_code?: unknown } | null)?.error_code
  if (res.status === 404 && code === 'result_pending') return { state: 'pending' }
  if (res.status === 410 || (res.status === 404 && code === 'request_id_unknown')) return { state: 'gone' }
  console.error('[mbc-search] Apollo a refusé la relecture du téléphone', res.status, typeof code === 'string' ? code : '')
  if (res.status === 401 || res.status === 403) throw new ApolloSearchError('La clé Apollo de la plateforme ne permet pas de relire les téléphones : contactez le support.', true)
  if (res.status === 429) throw new ApolloSearchError('Trop de demandes envoyées à Apollo : réessayez dans une minute.', true)
  throw new ApolloSearchError('Apollo n\'a pas pu donner le numéro pour le moment : réessayez dans quelques instants.')
}

/**
 * Un appel à l'IA de MBC Search (ligne « Matching IA » de Config IA, Claude par défaut, SCORING_AI ; repli sur les autres
 * modèles configurés) : consignes et message construits par prompts.ts, réponse brute à lire par l'appelant.
 * `tenantId` : organisation du recruteur, pour le journal de consommation de l'IA (ADR 0064, fonction « mbc-search-… »).
 */
async function askAi(step: string, tenantId: string, { system, user }: MbcPrompt, maxTokens: number, timeoutMs: number = BRIEF_TIMEOUT_MS): Promise<string> {
  const { content } = await callLLM([{ role: 'user', content: user }], system, { ...SCORING_AI, maxTokens, timeoutMs, usage: { feature: `mbc-search-${step}`, tenantId } })
  return content
}

/** Critères tirés d'un brief (briefCriteriaPrompt), à lire avec parseBriefCriteria. */
export async function briefToCriteriaText(brief: string, tenantId: string): Promise<string> {
  return askAi('criteria', tenantId, briefCriteriaPrompt(brief), 600)
}

/** Autres requêtes pour le même besoin (strategiesPrompt), à lire avec parseStrategies. */
export async function strategiesText(input: { brief: string; criteria: MbcCriteria }, tenantId: string): Promise<string> {
  return askAi('strategies', tenantId, strategiesPrompt(input), 800)
}

/**
 * Comparaison des intitulés d'une page de profils au métier demandé (même consigne que la notation des candidats,
 * title-check.ts), à lire avec parseTitleRelations. Une seule question pour toute la page.
 */
export async function titleFitsText(pairs: TitlePair[], tenantId: string): Promise<string> {
  return askAi('title-fit', tenantId, titleCheckPrompt(pairs), 2000)
}

/** Questions avant la recherche (briefQuestionsPrompt), à lire avec parseQuestionsAnswer. */
export async function briefQuestionsText(brief: string, tenantId: string): Promise<string> {
  return askAi('questions', tenantId, briefQuestionsPrompt(brief), 700)
}

/** Critères ajustés après un message du recruteur (refinePrompt), à lire avec parseRefinement. */
export async function refineCriteriaText(input: { brief: string; criteria: string; message: string }, tenantId: string): Promise<string> {
  return askAi('refine', tenantId, refinePrompt(input), 800)
}

/** Brouillon du message d'approche (outreachPrompt), nettoyé par cleanOutreachDraft, relu et envoyé par le recruteur. */
export async function outreachDraftText(input: { need: string; recruiter: string; person: string; channel: OutreachChannel }, tenantId: string): Promise<string> {
  return askAi('outreach', tenantId, outreachPrompt(input), 700)
}

/**
 * Évaluation d'un profil révélé pour le besoin (evaluationPrompt) : même consigne que la notation des CV (barème du
 * matching), plus ce qu'est un profil Apollo ; réponse brute, lue par l'action comme celle de cvScorer. Réponse longue
 * (jugements, preuves, notes) : 8 000 jetons et 120 s.
 */
export async function evaluationText(prompt: MbcPrompt, tenantId: string): Promise<string> {
  return askAi('evaluation', tenantId, prompt, 8000, 120_000)
}
