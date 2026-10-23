import type { PostImage } from '../social-content'

// Affiche des publications sur les réseaux (ADR 0015) : règles pures, testées dans rules.test.ts. La plateforme dessine
// l'affiche elle-même (poster.tsx) ; seule la scène photo est demandée à un modèle d'image d'OpenAI (scene.ts).

/** Format unique publié partout : 4:5, le plus haut accepté par le fil Instagram, bien reçu par LinkedIn, Facebook et X. */
export const POSTER_WIDTH = 1080
export const POSTER_HEIGHT = 1350

/**
 * Photos payées par la clé OpenAI de Config IA (la même sert à la lecture des scans des appels d'offres) : bornées par
 * jour (UTC), par organisation et pour toute la plateforme. Au-delà, l'affiche part sans photo.
 */
export const SCENE_DAILY_LIMITS = { perTenant: 10, platform: 100 } as const

/**
 * Une publication « queued » (photo puis envoi à Make, en arrière-plan) se termine en 300 s au plus (maxDuration) :
 * au-delà, la fonction a été interrompue et la publication est tenue pour échouée (elle peut être relancée).
 */
export const QUEUED_MAX_MS = 6 * 60_000

export function isQueuedOverdue(createdAt: string, now: number): boolean {
  return now - Date.parse(createdAt) > QUEUED_MAX_MS
}

// Temps gardé pour l'envoi à Make (15 s) et les écritures en base après la photo.
const AFTER_SCENE_MS = 25_000
const MAX_SCENE_MS = 150_000
const MIN_SCENE_MS = 30_000

/**
 * Délai accordé à OpenAI pour la photo, d'après l'échéance de la fonction (début de la requête + maxDuration, moins une
 * marge) : null s'il ne reste pas assez de temps, l'affiche part alors sans photo.
 */
export function sceneTimeoutMs(deadline: number, now: number): number | null {
  const left = deadline - now - AFTER_SCENE_MS
  return left < MIN_SCENE_MS ? null : Math.min(MAX_SCENE_MS, left)
}

/**
 * Cache de l'affiche publique. Longue durée seulement pour une publication envoyée qui a sa photo : son image ne
 * changera plus. Sans photo, une relance peut en ajouter une à la même adresse : cache court. En cours ou en échec :
 * aucun cache.
 */
export function posterCacheControl(status: string, hasScene: boolean): string {
  if (status === 'queued' || status === 'failed') return 'no-store'
  return hasScene ? 'public, max-age=3600, s-maxage=86400' : 'public, max-age=60, s-maxage=60'
}

/** Identifiant réservé à l'affiche d'exemple (test de connexion à Make, pilote Zernio, aperçu dans /admin/social). */
export const SAMPLE_POSTER_ID = 'exemple'

const DOCUMENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/

// L'extension .png est dans l'adresse : certains services de publication jugent le type d'un média à son URL.
export const posterUrl = (baseUrl: string, publicationId: string) => `${baseUrl.replace(/\/$/, '')}/api/social/poster/${publicationId}.png`

/** Segment « <id>.png » de la route publique → l'affiche d'exemple ou celle d'une publication ; null sinon. */
export function posterTarget(file: string): { kind: 'sample' } | { kind: 'post'; id: string } | null {
  const id = file.endsWith('.png') ? file.slice(0, -4) : ''
  if (id === SAMPLE_POSTER_ID) return { kind: 'sample' }
  return DOCUMENT_ID.test(id) ? { kind: 'post', id } : null
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const texts = (v: unknown, maxItems: number, max: number) =>
  (Array.isArray(v) ? v : []).map(x => text(x, max)).filter(Boolean).slice(0, maxItems)

/**
 * Champs de l'affiche relus dans la publication enregistrée (donnée de la base, éventuellement d'avant ce format : les
 * anciennes clés kie.ai sont ignorées). null si l'intitulé manque : rien à dessiner.
 */
export function parsePosterImage(raw: unknown): PostImage | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const title = text(r.title, 120)
  if (!title) return null
  return {
    title, company: text(r.company, 120), location: text(r.location, 120),
    facts: texts(r.facts, 4, 40), skills: texts(r.skills, 4, 40), tagline: text(r.tagline, 120),
  }
}

/** Taille du titre selon sa longueur : il doit tenir sur trois lignes au plus dans la largeur de l'affiche. */
export function titleFontSize(title: string): number {
  if (title.length <= 22) return 104
  if (title.length <= 36) return 88
  if (title.length <= 52) return 72
  return 60
}

/**
 * Consigne de la scène photo. Elle ne contient aucun texte à écrire : la plateforme écrit tous les textes par-dessus,
 * parce que les modèles d'image écorchent les accents et les mots français.
 */
export function scenePrompt(image: PostImage): string {
  // Intitulé et compétences viennent du recruteur : sans guillemets ni caractères de contrôle, ils ne peuvent pas
  // fermer la citation pour ajouter leurs propres consignes.
  const clean = (s: string, max: number) => s.replace(/["“”«»\p{Cc}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
  const title = clean(image.title, 120)
  const skills = image.skills.length ? `, key skills: ${image.skills.map(k => clean(k, 40)).join(', ')}` : ''
  return [
    `Photorealistic, cinematic editorial photograph for a job advertisement, matching this exact role: "${title}"${skills}.`,
    'Show the real environment, tools and activity of this job (examples: a data engineer at dual monitors with pipelines and dashboards; a cybersecurity consultant in a security operations room; a project manager leading a workshop at a whiteboard; a cloud architect reviewing architecture diagrams; a developer coding).',
    'One or two diverse, natural, smiling professionals in smart business attire actively doing that work, candid confident expression, high-end editorial photography, shallow depth of field, modern premium office, warm orange-gold accent light (#E8A33D) and deep anthracite tones (#2C2C2E).',
    'Landscape composition with the people in the upper and middle part; the bottom third darker and calm.',
    'Absolutely no text, letters, numbers, logos, watermarks, signs or readable screens anywhere in the image.',
  ].join(' ')
}

/** Échec de l'API d'images d'OpenAI traduit pour l'admin (« Affiche sans photo : … »), sans jamais recopier la clé. */
export function sceneFailureReason(status: number, body: string, apiKey: string): string {
  let code = ''
  let message = ''
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; message?: unknown } }
    code = typeof parsed.error?.code === 'string' ? parsed.error.code : ''
    message = typeof parsed.error?.message === 'string' ? parsed.error.message : ''
  } catch {
    // Corps non JSON (passerelle, page d'erreur) : seul le statut HTTP est exploitable.
  }
  if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') return 'crédits OpenAI épuisés'
  if (status === 401) return 'clé OpenAI refusée (Config IA)'
  if (code === 'moderation_blocked' || code === 'content_policy_violation') return 'image refusée par la modération d’OpenAI'
  if (code === 'model_not_found' || status === 404) return 'modèle d’image introuvable ou non autorisé (OPENAI_IMAGE_MODEL)'
  if (status === 429) return 'trop de demandes à OpenAI, réessayez plus tard'
  if (status >= 500 || !message) return `OpenAI indisponible (${status})`
  return `OpenAI : ${(apiKey ? message.replaceAll(apiKey, '[clé]') : message).slice(0, 200)}`
}
