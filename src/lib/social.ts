import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { AppwriteException, ID, Query, type Models } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { getJobById } from '@/lib/appwrite/jobs'
import { callLLM } from '@/lib/ai/llm-router'
import { CALENDLY_URL } from '@/lib/site-links'
import {
  DEFAULT_SOCIAL_CONFIG, NETWORKS, SAMPLE_JOB, buildContent, fallbackCopy, normalizeCopy, sanitizeSocialConfig,
  type CopyDraft, type JobLite, type Network, type PostImage, type SocialConfig, type SocialContent,
} from '@/lib/social-content'
import { SAMPLE_POSTER_ID, SCENE_DAILY_LIMITS, isQueuedOverdue, parsePosterImage, posterUrl, sceneTimeoutMs } from '@/lib/social-poster/rules'
import type { Job } from '@/types'

// Publication multi-réseaux (Modules 9 et 15) — orchestration côté plateforme.
// Flux (ADR 0015) : offre créée → contenu préparé (lib/social-content, textes par l'IA de Config IA) et publication
// « queued » (prepareSocialPost) → en arrière-plan, photo de la scène par OpenAI puis envoi au webhook Make
// (deliverSocialPost) → Make publie via Buffer l'affiche dessinée par la plateforme (/api/social/poster/<id>.png) sur
// LinkedIn / Instagram / Facebook / X → Make rappelle /api/social/callback avec les liens.

export type SocialStatus = 'queued' | 'sent' | 'images_ready' | 'published' | 'partial' | 'failed'

export interface NetworkResult { network: Network; status: 'published' | 'scheduled' | 'failed' | 'skipped'; url?: string; error?: string }

export interface SocialPost {
  /** Envoyée à Make mais aucune confirmation reçue depuis plus de 10 minutes (Make n'a pas rappelé la plateforme). */
  stale: boolean
  /** Raison pour laquelle l'affiche est partie sans photo (vide : photo présente, ou publication pas encore envoyée). */
  posterNote: string
  id: string
  jobId: string
  jobTitle: string
  tenantId: string
  status: SocialStatus
  trigger: 'auto' | 'manual'
  requestedBy: string
  caption: string
  images: string[]
  results: NetworkResult[]
  error: string
  attempts: number
  createdAt: string
  sentAt: string | null
  completedAt: string | null
}

const CONFIG_ID = 'config'
const origin = () => process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
const secret = () => process.env.SOCIAL_WEBHOOK_SECRET ?? ''
const webhookUrl = () => process.env.MAKE_SOCIAL_WEBHOOK_URL ?? ''

// https obligatoire en production ; en développement, un Make local (http://localhost) est accepté pour les tests.
export const isMakeConfigured = () =>
  (/^https:\/\//.test(webhookUrl()) || (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost[:/]/.test(webhookUrl()))) && secret().length >= 16
/** Outils de configuration visibles uniquement pour les développeurs (local, ou production avec SOCIAL_DEV_TOOLS=1). */
export const isDevToolsEnabled = () => process.env.NODE_ENV !== 'production' || process.env.SOCIAL_DEV_TOOLS === '1'
export const callbackUrl = () => `${origin()}/api/social/callback`

/**
 * Adresse du site SANS redirection. Si NEXT_PUBLIC_APP_URL pointe sur « mybestconsultant.fr » alors que le site répond
 * sur « www.mybestconsultant.fr », l'appel de retour de Make recevait une redirection 308 : les clients HTTP retirent
 * l'en-tête Authorization en changeant de domaine, le rappel était refusé (401) et la publication restait « en cours »
 * à vie. On suit donc la redirection une fois (mémorisée) et on donne à Make l'adresse finale.
 */
let canonical: { at: number; value: string } | null = null
export async function canonicalOrigin(): Promise<string> {
  const base = origin().replace(/\/$/, '')
  if (canonical && Date.now() - canonical.at < 6 * 3600_000) return canonical.value
  let value = base
  try {
    const r = await fetch(base, { method: 'HEAD', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(4000) })
    const loc = r.headers.get('location')
    if (r.status >= 300 && r.status < 400 && loc) {
      const u = new URL(loc, base)
      if (u.protocol === 'https:' || u.hostname === 'localhost') value = u.origin
    }
  } catch { /* on garde l'adresse configurée */ }
  canonical = { at: Date.now(), value }
  return value
}
export const canonicalCallbackUrl = async () => `${await canonicalOrigin()}/api/social/callback`

// ── Configuration (document « config » de la collection) ─────────────────────────────────────

export async function getSocialConfig(): Promise<SocialConfig> {
  try {
    const { databases } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, CONFIG_ID)
    return sanitizeSocialConfig(JSON.parse((doc.payloadJson as string) || '{}'))
  } catch {
    return DEFAULT_SOCIAL_CONFIG
  }
}

export async function saveSocialConfig(input: unknown): Promise<SocialConfig> {
  const cfg = sanitizeSocialConfig(input)
  const { databases } = createAdminClient()
  const data = { jobId: CONFIG_ID, status: 'config', payloadJson: JSON.stringify(cfg) }
  try { await databases.updateDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, CONFIG_ID, data) }
  catch { await databases.createDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, CONFIG_ID, data) }
  return cfg
}

// ── Documents ────────────────────────────────────────────────────────────────────────────────

const parse = <T,>(raw: unknown, fallback: T): T => { try { return typeof raw === 'string' && raw ? JSON.parse(raw) as T : fallback } catch { return fallback } }

const STALE_MS = 10 * 60_000   // sans aucun rappel de Make au-delà : on n'affiche plus « en cours »
const IDLE_MS = 3 * 60_000     // résultats reçus mais plus rien de nouveau : les réseaux restants ne sont pas configurés côté Make

function docToPost(d: Models.Document): SocialPost {
  const r = d as unknown as Record<string, unknown>
  const s = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : '')
  const results = parse<NetworkResult[]>(r.resultsJson, [])
  let status = (s('status') || 'queued') as SocialStatus
  let error = s('error')
  const now = Date.now()
  // Photo puis envoi à Make durent 300 s au plus : au-delà, la fonction a été interrompue, rien n'est parti.
  if (status === 'queued' && isQueuedOverdue(d.$createdAt, now)) {
    status = 'failed'
    error ||= 'Préparation interrompue (délai dépassé) : relancez la publication.'
  }
  // Des résultats sont arrivés (ex. LinkedIn) mais pas ceux des autres réseaux activés — et plus rien depuis 3 min : on conclut sur ce qui a été reçu.
  if (status === 'images_ready' && results.length > 0 && now - Date.parse(d.$updatedAt) > IDLE_MS) {
    const counted = results.filter(x => x.status !== 'skipped')
    const ok = counted.filter(x => x.status === 'published' || x.status === 'scheduled').length
    status = ok === 0 ? 'failed' : ok === counted.length ? 'published' : 'partial'
  }
  const inFlight = status === 'queued' || status === 'sent' || status === 'images_ready'
  const lastActivity = Date.parse((r.sentAt as string | null) || d.$createdAt)
  return {
    stale: inFlight && now - Math.max(lastActivity, Date.parse(d.$updatedAt)) > STALE_MS,
    posterNote: (() => { const note = parse<{ posterNote?: unknown } | null>(r.payloadJson, null)?.posterNote; return typeof note === 'string' ? note : '' })(),
    id: d.$id, jobId: s('jobId'), jobTitle: s('jobTitle'), tenantId: s('tenantId'), status,
    trigger: r.trigger === 'manual' ? 'manual' : 'auto', requestedBy: s('requestedBy'), caption: s('caption'),
    images: parse<string[]>(r.imagesJson, []), results, error,
    attempts: typeof r.attempts === 'number' ? r.attempts : 0, createdAt: d.$createdAt,
    sentAt: (r.sentAt as string | null) || null, completedAt: (r.completedAt as string | null) || null,
  }
}

export async function listRecentPosts(limit = 50): Promise<SocialPost[]> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.SOCIAL_POSTS, [Query.notEqual('status', 'config'), Query.orderDesc('$createdAt'), Query.limit(limit)])
  return res.documents.map(docToPost)
}

/** Dernière publication de chaque offre d'un tenant (pastille d'état dans le dashboard recruteur). */
export async function latestPostsByJob(tenantId: string): Promise<Record<string, SocialPost>> {
  try {
    const { databases } = createAdminClient()
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.SOCIAL_POSTS, [Query.equal('tenantId', tenantId), Query.orderDesc('$createdAt'), Query.limit(200)])
    const out: Record<string, SocialPost> = {}
    for (const d of res.documents) { const p = docToPost(d); if (!out[p.jobId]) out[p.jobId] = p }
    return out
  } catch {
    return {}
  }
}

/**
 * État de la dernière diffusion de chaque offre `jobIds` (suivi du tableau AO), 25 offres au plus par appel (taille
 * d'une requête Appwrite). Seuls les champs de l'état sont lus : pas le corps envoyé à Make (jusqu'à 20 000 caractères
 * par publication). Les erreurs remontent à l'appelant.
 */
export async function latestSocialStateByJob(jobIds: string[]): Promise<Map<string, Pick<SocialPost, 'status' | 'stale' | 'results'>>> {
  const out = new Map<string, Pick<SocialPost, 'status' | 'stale' | 'results'>>()
  if (!jobIds.length) return out
  const { databases } = createAdminClient()
  const PAGE = 100
  let cursor: string | undefined
  for (;;) {
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.SOCIAL_POSTS, [
      Query.equal('jobId', jobIds),
      // Avec Query.select, Appwrite ne renvoie que les champs nommés, $id et dates comprises (docToPost en a besoin).
      Query.select(['$id', '$createdAt', '$updatedAt', 'jobId', 'status', 'resultsJson', 'sentAt']),
      Query.orderDesc('$createdAt'), Query.limit(PAGE), ...(cursor ? [Query.cursorAfter(cursor)] : []),
    ])
    for (const d of res.documents) {
      const p = docToPost(d)
      if (!out.has(p.jobId)) out.set(p.jobId, { status: p.status, stale: p.stale, results: p.results })
    }
    if (res.documents.length < PAGE) return out
    cursor = res.documents[res.documents.length - 1].$id
  }
}

export async function getPost(id: string): Promise<SocialPost | null> {
  try { const { databases } = createAdminClient(); return docToPost(await databases.getDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, id)) } catch { return null }
}

// ── Rédaction ────────────────────────────────────────────────────────────────────────────────

const plain = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

/** Champs bornés : le corps envoyé à Make (et enregistré dans payloadJson, 20 000 caractères) doit tenir à coup sûr. */
export function jobToLite(job: Job, company: string): JobLite {
  return {
    id: job.$id, title: job.title.slice(0, 200), company: (company || job.companyName || '').slice(0, 120), location: (job.location ?? '').slice(0, 120),
    contractType: job.contractType, remote: job.remote, salary: job.salary,
    skills: (job.skills ?? []).slice(0, 15).map(k => k.slice(0, 40)), description: plain(job.description ?? '').slice(0, 1800),
  }
}

/** L'IA reformule l'offre en accroche + puces ; en cas d'échec, repli automatique (la publication ne dépend jamais de l'IA). */
export async function generateCopy(job: JobLite): Promise<CopyDraft> {
  if (process.env.SOCIAL_COPY_AI === 'off') return fallbackCopy(job) // coupe-circuit (tests / recette)
  try {
    const { content } = await callLLM([{
      role: 'user',
      content: `Offre : ${job.title}\nEntreprise : ${job.company}\nLieu : ${job.location}\nCompétences : ${job.skills.join(', ')}\nDescription : ${job.description}`,
    }], `Tu es community manager d'une plateforme de recrutement IT. À partir d'une offre d'emploi, rédige en français un contenu pour les réseaux sociaux : percutant, sobre, sans emoji, sans promesse inventée, uniquement des informations présentes dans l'offre.
Réponds UNIQUEMENT avec un JSON valide, sans markdown :
{"hook":"accroche de 70 caractères maximum","tagline":"une phrase d'accroche inspirante de 85 caractères maximum, propre à ce poste, sans point d'exclamation","pitch":"2 à 3 phrases de présentation","missionBullets":["3 puces de 80 caractères maximum sur la mission"],"profileBullets":["3 à 5 compétences ou qualités clés, 35 caractères maximum chacune"]}`, { timeoutMs: 30_000 })
    const m = content.match(/\{[\s\S]*\}/)
    return normalizeCopy(m ? JSON.parse(m[0]) : null, job)
  } catch (e) {
    // Repli prévu : la publication ne dépend jamais de l'IA, mais l'admin doit pouvoir savoir pourquoi.
    console.warn('[social] textes par repli, IA indisponible :', e instanceof Error ? e.message.slice(0, 200) : e)
    return fallbackCopy(job)
  }
}

/** Toujours le Calendly de My Best Consultant (réglage admin, sinon lien par défaut du site) — jamais celui d'un recruteur. */
export const resolveCalendly = (cfg: SocialConfig): string => cfg.calendlyUrl || CALENDLY_URL

// ── Envoi vers Make ──────────────────────────────────────────────────────────────────────────

export function signBody(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('hex')
}

/**
 * Make insère les valeurs telles quelles dans un corps JSON : un texte contenant guillemets ou retours à la ligne
 * casserait la requête. On joint donc, à l'envoi seulement (rien n'est stocké), la version déjà protégée de chaque texte.
 */
function withEscaped(payload: Record<string, unknown>): Record<string, unknown> {
  const c = payload.content as SocialContent | undefined
  if (!c?.captions) return payload
  const esc = (t: string) => JSON.stringify(t).slice(1, -1)
  return { ...payload, content: { ...c, escaped: { linkedin: esc(c.captions.linkedin), instagram: esc(c.captions.instagram), facebook: esc(c.captions.facebook), x: esc(c.captions.x) } } }
}

export async function postToMake(payload: Record<string, unknown>): Promise<{ ok: boolean; status: number; error?: string }> {
  if (!isMakeConfigured()) return { ok: false, status: 0, error: 'La diffusion n’est pas encore configurée.' }
  const body = JSON.stringify(withEscaped(payload))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(webhookUrl(), {
      method: 'POST', signal: controller.signal, cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-MBC-Secret': secret(), 'X-MBC-Signature': `sha256=${signBody(body)}` },
      body,
    })
    if (!res.ok) { console.error(`[social] Make a répondu HTTP ${res.status}`); return { ok: false, status: res.status, error: `Le service de diffusion a répondu par une erreur (${res.status}).` } }
    return { ok: true, status: res.status }
  } catch (e) {
    const timeout = e instanceof Error && e.name === 'AbortError'
    console.error(`[social] ${timeout ? 'Make ne répond pas (délai dépassé)' : 'Make injoignable'}`)
    return { ok: false, status: 0, error: timeout ? 'Le service de diffusion ne répond pas (délai dépassé).' : 'Le service de diffusion est injoignable.' }
  } finally {
    clearTimeout(timer)
  }
}

/** Corps envoyé à Make. `content.image.url` : l'affiche à publier, dessinée par la plateforme à cette adresse. */
function buildPayload(publicationId: string, job: JobLite, content: SocialContent, cfg: SocialConfig, site: string, posterId = publicationId) {
  return {
    event: 'job.published',
    publicationId,
    callbackUrl: `${site}/api/social/callback`,
    job: { id: job.id, title: job.title, company: job.company, location: job.location, contract: job.contractType ?? null, remote: job.remote ?? null, salary: job.salary ?? null, skills: job.skills, url: content.jobUrl },
    networks: cfg.networks,
    content: { ...content, image: { ...content.image, url: posterUrl(site, posterId) } },
    brand: { name: 'My Best Consultant', website: 'https://mybestconsultant.fr', colors: { dark: '#2C2C2E', accent: '#E8A33D' } },
  }
}

/**
 * Test de connexion : envoie un exemple COMPLET (offre fictive) pour que Make apprenne toute la structure des données.
 * L'évènement vaut « test » (et non « job.published ») : le filtre du scénario l'arrête, rien n'est publié.
 * L'affiche jointe est l'affiche d'exemple (sans photo) : aucun appel à OpenAI.
 */
export async function sendTestToMake(): Promise<{ ok: boolean; status: number; error?: string }> {
  const cfg = await getSocialConfig()
  const site = await canonicalOrigin()
  const content = buildContent(SAMPLE_JOB, fallbackCopy(SAMPLE_JOB), cfg, { baseUrl: site, calendlyUrl: resolveCalendly(cfg) })
  return postToMake({ ...buildPayload('test', SAMPLE_JOB, content, cfg, site, SAMPLE_POSTER_ID), event: 'test', sentAt: new Date().toISOString() })
}

/**
 * Pilote Zernio : publie pour de vrai sur Instagram, via Zernio au lieu de Make + Buffer, l'affiche d'exemple (sans
 * photo). Zernio télécharge l'affiche à son adresse publique : ne fonctionne que sur un site déployé.
 */
export async function testZernioInstagram(): Promise<{ ok: boolean; status?: string; permalink?: string; error?: string }> {
  const cfg = await getSocialConfig()
  const site = await canonicalOrigin()
  const content = buildContent(SAMPLE_JOB, fallbackCopy(SAMPLE_JOB), cfg, { baseUrl: site, calendlyUrl: resolveCalendly(cfg) })
  const { postImageToInstagramViaZernio } = await import('@/lib/zernio')
  const result = await postImageToInstagramViaZernio({ caption: content.captions.instagram, imageUrl: posterUrl(site, SAMPLE_POSTER_ID) })
  return result.ok ? { ok: true, status: result.status, permalink: result.permalink } : { ok: false, error: result.error }
}

// ── Publication d'une offre ──────────────────────────────────────────────────────────────────

/** En cours (photo, envoi, ou Make n'a pas encore tout confirmé) et pas abandonnée : jamais de seconde publication. */
const inProgress = (p: SocialPost) => (p.status === 'queued' || p.status === 'sent' || p.status === 'images_ready') && !p.stale
/** Déjà publiée : une nouvelle publication n'est faite que sur demande explicite (« Republier »). */
const alreadyPublished = (p: SocialPost) => p.status === 'published' || p.status === 'partial'

// Verrou par offre pendant la préparation (contrôle puis création du document) : la publication automatique et un clic
// sur « Publier », ou deux onglets, ne créent pas deux publications. Document de ao_sync_state (36 caractères au plus).
const prepareLockId = (jobId: string) => `social_${createHash('sha1').update(jobId).digest('hex').slice(0, 16)}`

/** Échéance de l'envoi en arrière-plan : début de la requête + maxDuration (300 s) moins une marge. */
export const deliveryDeadline = (requestStart: number) => requestStart + 270_000

/**
 * Prépare la publication d'une offre : contrôles, textes (IA de Config IA, quelques secondes) et document « queued »
 * qui contient déjà tout ce qui partira chez Make. L'envoi suit avec deliverSocialPost, en arrière-plan (after()) :
 * la photo de l'affiche prend jusqu'à 2 min et ne doit pas faire attendre le recruteur.
 */
export async function prepareSocialPost(jobId: string, opts: { trigger: 'auto' | 'manual'; requestedBy: string; force?: boolean }): Promise<{ id?: string; status?: SocialStatus; skipped?: boolean; error?: string }> {
  const cfg = await getSocialConfig()
  if (!isMakeConfigured()) return { error: 'La publication sur les réseaux n’est pas encore configurée.' }
  if (!NETWORKS.some(n => cfg.networks[n])) return { error: 'Aucun réseau n’est activé.' }
  const job = await getJobById(jobId)
  if (!job || !job.isActive) return { error: 'Offre introuvable ou inactive.' }

  const { acquireSyncLock, releaseSyncLock } = await import('@/lib/ao/state')
  const lock = await acquireSyncLock(prepareLockId(jobId), `social:${opts.trigger}`, new Date())
  if (!lock) return { error: 'La diffusion de cette offre est déjà en cours de préparation.' }
  try {
    return await prepareLocked(job, opts, cfg)
  } finally {
    await releaseSyncLock(lock)
  }
}

async function prepareLocked(job: Job, opts: { trigger: 'auto' | 'manual'; requestedBy: string; force?: boolean }, cfg: SocialConfig): Promise<{ id?: string; status?: SocialStatus; skipped?: boolean; error?: string }> {
  const jobId = job.$id
  const { databases } = createAdminClient()
  const prev = (await databases.listDocuments(DB_ID, COLLECTIONS.SOCIAL_POSTS, [Query.equal('jobId', jobId), Query.orderDesc('$createdAt'), Query.limit(5)])).documents.map(docToPost)
  const active = prev.find(p => inProgress(p) || (!opts.force && alreadyPublished(p)))
  if (active) return { id: active.id, status: active.status, skipped: true }

  let company = job.companyName ?? ''
  if (job.tenantId) { try { company = ((await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, job.tenantId)).name as string) || company } catch { /* nom facultatif */ } }
  const lite = jobToLite(job, company)
  const copy = await generateCopy(lite)
  const site = await canonicalOrigin()
  const content = buildContent(lite, copy, cfg, { baseUrl: site, calendlyUrl: resolveCalendly(cfg) })

  // Identifiant choisi avant l'écriture : l'adresse de l'affiche en dépend et part dans le même document.
  const id = ID.unique()
  // Corps d'environ 10 Ko (légendes bornées par buildContent, champs par jobToLite) ; vérifié contre l'attribut (20 000).
  const payloadJson = JSON.stringify(buildPayload(id, lite, content, cfg, site))
  if (payloadJson.length > 19_500) return { error: 'Contenu de la publication trop long : raccourcissez l’intitulé ou les compétences de l’offre.' }
  await databases.createDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, id, {
    jobId, tenantId: job.tenantId ?? '', jobTitle: job.title.slice(0, 200), status: 'queued', trigger: opts.trigger,
    requestedBy: opts.requestedBy.slice(0, 100), caption: content.captions.linkedin.slice(0, 3000), attempts: 0,
    payloadJson,
  })
  return { id, status: 'queued' }
}

/** Photo de la scène si possible ; renvoie la raison d'une affiche sans photo (vide si la photo est là). */
async function ensureScene(id: string, tenantId: string, image: PostImage, deadline: number): Promise<string> {
  const { isSceneStorageConfigured, hasScene, storeScene } = await import('@/lib/social-poster/store')
  if (!isSceneStorageConfigured()) return 'stockage des photos non configuré (APPWRITE_STORAGE_SOCIAL_SCENES)'
  try {
    if (await hasScene(id)) return ''
    const timeoutMs = sceneTimeoutMs(deadline, Date.now())
    if (timeoutMs === null) return 'plus assez de temps pour la photo (la préparation a été longue)'
    // Quota de l'organisation d'abord : celle qui a épuisé le sien ne prend plus de place sur celui de la plateforme.
    const { takeDailySlot } = await import('@/lib/ao/state')
    const { PLATFORM_TENANT_ID } = await import('@/lib/ao/tenancy')
    const now = new Date()
    if (!(await takeDailySlot('socialScenes', tenantId || PLATFORM_TENANT_ID, now, SCENE_DAILY_LIMITS.perTenant))) {
      return `quota du jour atteint (${SCENE_DAILY_LIMITS.perTenant} photos par organisation)`
    }
    if (!(await takeDailySlot('socialScenesAll', PLATFORM_TENANT_ID, now, SCENE_DAILY_LIMITS.platform))) {
      console.warn('[social] quota de photos de la plateforme atteint', SCENE_DAILY_LIMITS.platform)
      return `quota du jour de la plateforme atteint (${SCENE_DAILY_LIMITS.platform} photos)`
    }
    const { generateScene } = await import('@/lib/social-poster/scene')
    const scene = await generateScene(image, timeoutMs)
    if (!scene.ok) {
      console.warn('[social] affiche sans photo', id, scene.reason)
      return scene.reason
    }
    await storeScene(id, scene)
    return ''
  } catch (e) {
    // Compteur de quota ou bucket injoignable : l'affiche part sans photo plutôt que de bloquer la publication.
    const detail = e instanceof AppwriteException ? `${e.type} ${e.code}` : e instanceof Error ? e.name : String(e)
    console.error('[social] photo de l’affiche impossible', id, detail)
    return `photo impossible (base ou stockage indisponible : ${detail})`
  }
}

/**
 * Envoie à Make une publication préparée : photo de la scène d'abord (sans elle, l'affiche part quand même), puis le
 * contenu enregistré. « sent » est écrit avant l'appel à Make : un rappel de Make arrivé dans la foulée n'est jamais
 * écrasé, et une erreur après l'envoi ne fait pas croire à un échec (qui pousserait à republier). Conclut toujours le
 * document, sauf si la fonction est interrompue (docToPost la tient alors pour échouée après QUEUED_MAX_MS).
 */
export async function deliverSocialPost(id: string, deadline = deliveryDeadline(Date.now())): Promise<{ status: SocialStatus; error?: string }> {
  let attempts = 0
  let sentToMake = false
  try {
    const { databases } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, id)
    attempts = typeof doc.attempts === 'number' ? doc.attempts : 0
    const stored = parse<Record<string, unknown> | null>(doc.payloadJson, null)
    const rawImage = (stored?.content as { image?: { url?: unknown } } | undefined)?.image
    if (!stored || typeof rawImage?.url !== 'string') throw new Error('contenu de la publication illisible')
    const image = parsePosterImage(rawImage)
    if (!image) throw new Error('intitulé de l’offre vide : l’affiche ne peut pas être dessinée')
    const payload = { ...stored }
    delete payload.posterNote // note pour l'admin, pas envoyée à Make
    const posterNote = await ensureScene(id, typeof doc.tenantId === 'string' ? doc.tenantId : '', image, deadline)
    await databases.updateDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, id, {
      status: 'sent', attempts: attempts + 1, sentAt: new Date().toISOString(), completedAt: null, error: null,
      resultsJson: '[]', imagesJson: JSON.stringify([rawImage.url]), payloadJson: JSON.stringify({ ...payload, posterNote }),
    })
    sentToMake = true
    const sent = await postToMake(payload)
    if (sent.ok) return { status: 'sent' }
    const error = (sent.error ?? 'Échec').slice(0, 500)
    await databases.updateDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, id, { status: 'failed', error })
    return { status: 'failed', error }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'erreur inattendue'
    console.error('[social] envoi impossible', id, sentToMake ? '(après l’appel à Make)' : '', message)
    // Make a peut-être reçu la publication : on ne la déclare pas en échec (une relance la publierait deux fois).
    if (sentToMake) return { status: 'sent', error: `Envoyée, mais état non enregistré : ${message}` }
    const failure = { status: 'failed' as const, attempts: attempts + 1, error: `Envoi impossible : ${message}`.slice(0, 500) }
    const { databases } = createAdminClient()
    // Un second essai d'écriture : sinon la publication resterait « en file » jusqu'à QUEUED_MAX_MS.
    await databases.updateDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, id, failure)
      .catch(() => databases.updateDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, id, failure))
      .catch(err => console.error('[social] publication restée « en file »', id, err instanceof Error ? err.message : err))
    return { status: 'failed', error: failure.error }
  }
}

/** Prépare puis envoie (création automatique d'une offre, déjà lancée en arrière-plan par l'appelant). */
export async function publishJobSocially(jobId: string, opts: { trigger: 'auto' | 'manual'; requestedBy: string; force?: boolean }, deadline?: number): Promise<{ id?: string; status?: SocialStatus; skipped?: boolean; error?: string }> {
  const prepared = await prepareSocialPost(jobId, opts)
  if (!prepared.id || prepared.skipped || prepared.error) return prepared
  return { id: prepared.id, ...(await deliverSocialPost(prepared.id, deadline)) }
}

/**
 * « Relancer la publication » : remet en file le contenu déjà préparé (même texte, même affiche, photo gardée) ; l'envoi
 * suit avec deliverSocialPost, en arrière-plan. Refusé tant que la publication est en cours. Une publication d'avant
 * l'affiche dessinée par la plateforme (sans adresse d'affiche) est remplacée par une nouvelle.
 */
export async function retryPost(id: string): Promise<{ id?: string; status?: SocialStatus; error?: string }> {
  const { databases } = createAdminClient()
  const doc = await databases.getDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, id).catch(() => null)
  if (!doc || doc.status === 'config') return { error: 'Publication introuvable.' }
  const post = docToPost(doc)
  if (inProgress(post)) return { error: 'Publication en cours : attendez son résultat avant de la relancer.' }
  const payload = parse<Record<string, unknown> | null>(doc.payloadJson, null)
  const content = payload?.content as { captions?: unknown; image?: { url?: unknown } } | undefined
  if (!payload || !content?.captions || typeof content.image?.url !== 'string') {
    const r = await prepareSocialPost(post.jobId, { trigger: 'manual', requestedBy: 'Relance', force: true })
    if (r.error || !r.id) return { error: r.error ?? 'Publication déjà en cours pour cette offre.' }
    await databases.updateDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, id, { status: 'failed', error: 'Remplacée par une nouvelle publication.' })
    return { id: r.id, status: r.status }
  }
  await databases.updateDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, id, {
    status: 'queued', error: null, completedAt: null, resultsJson: '[]',
    payloadJson: JSON.stringify({ ...payload, publicationId: id, callbackUrl: await canonicalCallbackUrl() }),
  })
  return { id, status: 'queued' }
}

// ── Retour de Make ───────────────────────────────────────────────────────────────────────────

export function verifyCallbackAuth(authorization: string | null, headerSecret: string | null): boolean {
  const expected = secret()
  if (expected.length < 16) return false
  const given = (authorization?.replace(/^Bearer\s+/i, '') || headerSecret || '').trim()
  const a = Buffer.from(given), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

const httpsUrl = (v: unknown) => { try { const u = new URL(String(v)); return u.protocol === 'https:' ? u.toString().slice(0, 500) : undefined } catch { return undefined } }

export async function handleCallback(body: unknown): Promise<{ ok: boolean; error?: string; status?: SocialStatus }> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const id = typeof b.publicationId === 'string' ? b.publicationId : ''
  if (!id) return { ok: false, error: 'publicationId manquant' }
  const { databases } = createAdminClient()
  const doc = await databases.getDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, id).catch(() => null)
  if (!doc || doc.status === 'config') return { ok: false, error: 'publication inconnue' }

  const images = Array.isArray(b.images) ? b.images.map(httpsUrl).filter((u): u is string => !!u).slice(0, 10) : []
  const results: NetworkResult[] = Array.isArray(b.results) ? b.results.slice(0, 10).map((r): NetworkResult | null => {
    const x = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    if (!(NETWORKS as readonly string[]).includes(String(x.network))) return null
    const st = ['published', 'scheduled', 'failed', 'skipped'].includes(String(x.status)) ? String(x.status) as NetworkResult['status'] : 'failed'
    return { network: x.network as Network, status: st, url: httpsUrl(x.url), error: typeof x.error === 'string' ? x.error.slice(0, 200) : undefined }
  }).filter((r): r is NetworkResult => !!r) : []

  // Make peut rappeler une fois par réseau : on fusionne les résultats (le dernier reçu pour un réseau l'emporte).
  const prev = docToPost(doc)
  const merged = [...prev.results.filter(r => !results.some(n => n.network === r.network)), ...results]
  const payload = parse<{ networks?: Partial<Record<Network, boolean>> } | null>(doc.payloadJson, null)
  const expected = NETWORKS.filter(n => payload?.networks ? payload.networks[n] === true : merged.some(r => r.network === n))

  const declared = String(b.status ?? '')
  let status: SocialStatus
  if (merged.length === 0) status = declared === 'failed' ? 'failed' : declared === 'images_ready' ? 'images_ready' : 'sent'
  else if (expected.some(n => !merged.some(r => r.network === n))) status = 'images_ready' // il reste des réseaux à confirmer
  else {
    const counted = merged.filter(r => r.status !== 'skipped')
    const ok = counted.filter(r => r.status === 'published' || r.status === 'scheduled').length
    status = ok === 0 ? 'failed' : ok === counted.length ? 'published' : 'partial'
  }

  const final = status === 'published' || status === 'partial' || status === 'failed'
  await databases.updateDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, id, {
    status,
    imagesJson: JSON.stringify(images.length ? images : prev.images).slice(0, 3000),
    resultsJson: JSON.stringify(merged).slice(0, 4000),
    error: status === 'failed' ? (typeof b.error === 'string' && b.error ? b.error.slice(0, 500) : merged.find(r => r.error)?.error ?? 'Échec de la publication') : null,
    completedAt: final ? new Date().toISOString() : null,
  })
  return { ok: true, status }
}

// ── Point d'entrée à la création d'une offre de recruteur ────────────────────────────────────

/**
 * Publie la nouvelle offre sur les réseaux (si l'admin a activé la publication automatique et que Make est configuré).
 * Quand LinkedIn est pris en charge par ce circuit, l'ancienne publication LinkedIn directe est sautée (pas de doublon) ;
 * si l'envoi à Make échoue, elle sert de secours.
 */
export async function tryAutoPublishJob(job: Job & { $id: string }, deadline?: number): Promise<void> {
  let linkedInHandled = false
  try {
    const cfg = await getSocialConfig()
    if (cfg.autoPublish && isMakeConfigured()) {
      const r = await publishJobSocially(job.$id, { trigger: 'auto', requestedBy: 'Automatique' }, deadline)
      // Une publication existe (même en échec : elle se relance depuis /admin/social) : pas de publication LinkedIn
      // directe en plus, Make a pu la recevoir et cela ferait un doublon sur la page.
      linkedInHandled = cfg.networks.linkedin && !!r.id
    }
  } catch (e) {
    console.error('[social] publication automatique échouée :', e instanceof Error ? e.message : e)
  }
  if (!linkedInHandled) {
    try {
      const { tryAutoPostJobToLinkedIn } = await import('@/lib/linkedin-publish')
      await tryAutoPostJobToLinkedIn(job)
    } catch (e) {
      // La création d'offre ne dépend jamais des réseaux : journalisé seulement.
      console.error('[social] publication LinkedIn directe échouée :', e instanceof Error ? e.message : e)
    }
  }
}
