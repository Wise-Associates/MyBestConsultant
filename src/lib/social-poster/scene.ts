import 'server-only'
import type { PostImage } from '../social-content'
import type { PosterScene } from './poster'
import { sceneFailureReason, scenePrompt } from './rules'

// Scène photo de l'affiche (ADR 0015), demandée à l'API d'images d'OpenAI avec la clé OpenAI de Config IA (ou
// OPENAI_API_KEY). Facultative : un échec (crédits, délai, modération) donne une affiche sans photo, jamais une
// publication bloquée. Claude ne génère pas d'images : il rédige les textes (lib/social.ts, generateCopy).

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations'
/** Le modèle qu'utilisait kie.ai ; OPENAI_IMAGE_MODEL permet d'en changer sans toucher au code. */
const DEFAULT_IMAGE_MODEL = 'gpt-image-2'
// 1536x1024 est accepté par tous les modèles « gpt-image » ; l'affiche en garde le haut (recadrage « cover »).
const SCENE_SIZE = '1536x1024'
// Une génération prend 30 à 90 s ; au-delà, la publication part sans photo. Réduit au temps restant (sceneTimeoutMs).
const SCENE_TIMEOUT_MS = 150_000
const MAX_SCENE_BYTES = 8 * 1024 * 1024

export type SceneResult = ({ ok: true } & PosterScene) | { ok: false; reason: string }

/** Type d'image d'après ses premiers octets (la réponse d'un service externe n'est pas fiable). */
export function sceneMime(bytes: Uint8Array): PosterScene['mime'] | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  return null
}

export async function generateScene(image: PostImage, timeoutMs = SCENE_TIMEOUT_MS): Promise<SceneResult> {
  const { getLLMConfig } = await import('@/lib/ai/llm-config-store')
  const apiKey = (await getLLMConfig()).openaiApiKey || process.env.OPENAI_API_KEY || ''
  if (!apiKey) return { ok: false, reason: 'aucune clé OpenAI (Config IA ou OPENAI_API_KEY)' }

  let res: Response
  let body: string
  try {
    res = await fetch(OPENAI_IMAGES_URL, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
        prompt: scenePrompt(image), size: SCENE_SIZE, quality: 'medium', n: 1, output_format: 'jpeg',
      }),
    })
    // Lu dans le même délai : une réponse qui s'interrompt en cours de route est un délai dépassé, pas une erreur interne.
    body = await res.text()
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    return { ok: false, reason: timedOut ? 'OpenAI n’a pas répondu à temps' : 'OpenAI injoignable' }
  }
  if (!res.ok) return { ok: false, reason: sceneFailureReason(res.status, body, apiKey) }

  let b64 = ''
  try {
    const first = (JSON.parse(body) as { data?: { b64_json?: unknown }[] }).data?.[0]?.b64_json
    b64 = typeof first === 'string' ? first : ''
  } catch {
    // Réponse 200 mais pas du JSON : traitée comme une image absente ci-dessous.
  }
  const bytes = new Uint8Array(Buffer.from(b64, 'base64'))
  const mime = sceneMime(bytes)
  if (!mime || bytes.length > MAX_SCENE_BYTES) return { ok: false, reason: 'réponse d’OpenAI sans image exploitable' }
  return { ok: true, bytes, mime }
}
