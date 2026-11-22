// Publication par l'API de Buffer (GraphQL, https://developers.buffer.com), appelée directement par la plateforme
// (ADR 0056, 2026-11-22) : le scénario Make (webhook → Buffer → rappel) n'est plus nécessaire pour LinkedIn.
// Clé API : Buffer → Settings → API (https://publish.buffer.com/settings/api), valable pour tout le compte.

const BUFFER_API = 'https://api.buffer.com'
const TIMEOUT_MS = 15_000

// Même requête que le module « HTTP › Buffer » du scénario Make, éprouvée en production.
const CREATE_POST = 'mutation Publier($input: CreatePostInput!) { createPost(input: $input) { ... on PostActionSuccess { post { id } } ... on MutationError { message } } }'
const GET_CHANNEL = 'query Canal($input: ChannelInput!) { channel(input: $input) { id name service } }'

export type BufferResult<T> = { ok: true; value: T } | { ok: false; error: string }

interface GraphQLResponse {
  data?: Record<string, unknown> | null
  errors?: { message?: unknown; extensions?: { code?: unknown } }[]
}

/**
 * Buffer télécharge l'image depuis ses serveurs : l'adresse doit être publique (doc. Buffer, « Hosting media »). En
 * local (http://localhost…), il refusait le post entier (« Failed to fetch image dimensions ») sans le créer.
 */
export function imageUrlProblem(imageUrl: string): string | null {
  let url: URL
  try { url = new URL(imageUrl) } catch { return 'Adresse de l’affiche invalide.' }
  if (url.protocol !== 'https:' || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || /^(127\.|10\.|192\.168\.|0\.0\.0\.0$|\[::1\]$)/.test(url.hostname)) {
    return `Buffer ne peut pas télécharger l’affiche depuis ${url.origin} : publiez depuis un site déployé, ou en local par un tunnel https (NEXT_PUBLIC_APP_URL = adresse du tunnel).`
  }
  return null
}

/** Publication immédiate (`shareNow`) d'une image avec son texte ; Buffer télécharge l'image à son adresse publique. */
export function createPostRequest(channelId: string, text: string, imageUrl: string) {
  return { query: CREATE_POST, variables: { input: { channelId, text, schedulingType: 'automatic', mode: 'shareNow', assets: [{ image: { url: imageUrl } }] } } }
}

export function channelRequest(channelId: string) {
  return { query: GET_CHANNEL, variables: { input: { id: channelId } } }
}

/**
 * Erreur d'une réponse de Buffer, ou null. Buffer répond 200 même en erreur (erreurs dans `errors`), sauf clé refusée
 * (401) et quota dépassé (429) d'après sa documentation : le code HTTP et le corps sont lus tous les deux.
 */
const asResponse = (body: unknown): GraphQLResponse => (body && typeof body === 'object' ? body : {}) as GraphQLResponse

export function responseError(httpStatus: number, body: unknown): string | null {
  const b = asResponse(body)
  const first = Array.isArray(b.errors) ? b.errors[0] : undefined
  const code = typeof first?.extensions?.code === 'string' ? first.extensions.code : ''
  if (httpStatus === 401 || code === 'UNAUTHORIZED') return 'Buffer a refusé la clé API (BUFFER_API_KEY) : vérifiez-la dans Buffer → Settings → API.'
  if (httpStatus === 429 || code === 'RATE_LIMIT_EXCEEDED') return 'Limite de requêtes de Buffer atteinte : relancez dans 15 minutes.'
  if (first) return `Buffer : ${typeof first.message === 'string' && first.message ? first.message.slice(0, 160) : code || 'erreur sans message'}`
  if (httpStatus < 200 || httpStatus >= 300) return `Buffer a répondu par une erreur (HTTP ${httpStatus}).`
  return null
}

/** Identifiant du post créé, ou la raison du refus (erreur typée de la mutation, ex. image introuvable). */
export function readCreatePost(httpStatus: number, body: unknown): BufferResult<string> {
  const error = responseError(httpStatus, body)
  if (error) return { ok: false, error }
  const result = (asResponse(body).data?.createPost ?? null) as { post?: { id?: unknown }; message?: unknown } | null
  if (typeof result?.post?.id === 'string' && result.post.id) return { ok: true, value: result.post.id }
  if (typeof result?.message === 'string' && result.message) return { ok: false, error: `Buffer : ${result.message.slice(0, 160)}` }
  return { ok: false, error: 'Réponse de Buffer illisible (aucun post créé).' }
}

/** Le canal doit exister dans le compte de la clé et être un canal LinkedIn. */
export function readLinkedInChannel(httpStatus: number, body: unknown): BufferResult<string> {
  const error = responseError(httpStatus, body)
  if (error) return { ok: false, error }
  const channel = (asResponse(body).data?.channel ?? null) as { name?: unknown; service?: unknown } | null
  if (!channel) return { ok: false, error: 'Canal Buffer introuvable (BUFFER_LINKEDIN_CHANNEL_ID).' }
  if (channel.service !== 'linkedin') return { ok: false, error: `Le canal Buffer configuré n’est pas un canal LinkedIn (${String(channel.service)}).` }
  return { ok: true, value: typeof channel.name === 'string' ? channel.name : '' }
}

async function call<T>(apiKey: string, request: object, read: (status: number, body: unknown) => BufferResult<T>, timeoutMessage: string): Promise<BufferResult<T>> {
  try {
    const res = await fetch(BUFFER_API, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(request),
    })
    const body: unknown = await res.json().catch(() => null)
    return read(res.status, body)
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    return { ok: false, error: timeout ? timeoutMessage : 'Buffer est injoignable.' }
  }
}

/** Publie sur le canal ; renvoie l'identifiant du post chez Buffer (il le publie ensuite sur LinkedIn, en quelques secondes). */
export function createBufferPost(apiKey: string, channelId: string, text: string, imageUrl: string): Promise<BufferResult<string>> {
  // Délai dépassé : Buffer a pu créer le post, une relance aveugle le publierait deux fois.
  return call(apiKey, createPostRequest(channelId, text, imageUrl), readCreatePost, 'Buffer ne répond pas (délai dépassé) : vérifiez sur Buffer si le post existe avant de relancer.')
}

/** Vérifie la clé et le canal sans rien publier ; renvoie le nom du canal. */
export function checkBufferLinkedInChannel(apiKey: string, channelId: string): Promise<BufferResult<string>> {
  return call(apiKey, channelRequest(channelId), readLinkedInChannel, 'Buffer ne répond pas (délai dépassé).')
}
