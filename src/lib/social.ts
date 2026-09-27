import { createHmac, timingSafeEqual } from 'crypto'
import { ID, Query, type Models } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { getJobById } from '@/lib/appwrite/jobs'
import { callLLM } from '@/lib/ai/llm-router'
import { CALENDLY_URL } from '@/lib/site-links'
import {
  DEFAULT_SOCIAL_CONFIG, NETWORKS, buildContent, fallbackCopy, normalizeCopy, sanitizeSocialConfig,
  type CopyDraft, type JobLite, type Network, type SocialConfig, type SocialContent,
} from '@/lib/social-content'
import type { Job } from '@/types'

// Publication multi-réseaux (Modules 9 et 15) — orchestration côté plateforme.
// Flux : offre créée → contenu préparé (lib/social-content) → webhook Make (kie.ai génère l'image, Buffer publie
// sur LinkedIn / Instagram / Facebook / X, une seule image) → Make rappelle /api/social/callback avec les liens.

export type SocialStatus = 'queued' | 'sent' | 'images_ready' | 'published' | 'partial' | 'failed'

export interface NetworkResult { network: Network; status: 'published' | 'scheduled' | 'failed' | 'skipped'; url?: string; error?: string }

export interface SocialPost {
  /** Envoyée à Make mais aucune confirmation reçue depuis plus de 10 minutes (Make n'a pas rappelé la plateforme). */
  stale: boolean
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
  const now = Date.now()
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
    id: d.$id, jobId: s('jobId'), jobTitle: s('jobTitle'), tenantId: s('tenantId'), status,
    trigger: r.trigger === 'manual' ? 'manual' : 'auto', requestedBy: s('requestedBy'), caption: s('caption'),
    images: parse<string[]>(r.imagesJson, []), results, error: s('error'),
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

export async function getPost(id: string): Promise<SocialPost | null> {
  try { const { databases } = createAdminClient(); return docToPost(await databases.getDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, id)) } catch { return null }
}

// ── Rédaction ────────────────────────────────────────────────────────────────────────────────

const plain = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

export function jobToLite(job: Job, company: string): JobLite {
  return {
    id: job.$id, title: job.title, company: company || job.companyName || '', location: job.location, contractType: job.contractType,
    remote: job.remote, salary: job.salary, skills: job.skills ?? [], description: plain(job.description ?? '').slice(0, 1800),
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
{"hook":"accroche de 70 caractères maximum","tagline":"une phrase d'accroche inspirante de 85 caractères maximum, propre à ce poste, sans point d'exclamation","pitch":"2 à 3 phrases de présentation","missionBullets":["3 puces de 80 caractères maximum sur la mission"],"profileBullets":["3 à 5 compétences ou qualités clés, 35 caractères maximum chacune"]}`)
    const m = content.match(/\{[\s\S]*\}/)
    return normalizeCopy(m ? JSON.parse(m[0]) : null, job)
  } catch {
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
  if (!c?.captions || !c.image) return payload
  const esc = (t: string) => JSON.stringify(t).slice(1, -1)
  return { ...payload, content: { ...c, escaped: { imagePrompt: esc(c.image.prompt), linkedin: esc(c.captions.linkedin), instagram: esc(c.captions.instagram), facebook: esc(c.captions.facebook), x: esc(c.captions.x) } } }
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

function buildPayload(publicationId: string, job: JobLite, content: SocialContent, cfg: SocialConfig, callback: string) {
  return {
    event: 'job.published',
    publicationId,
    callbackUrl: callback,
    job: { id: job.id, title: job.title, company: job.company, location: job.location, contract: job.contractType ?? null, remote: job.remote ?? null, salary: job.salary ?? null, skills: job.skills, url: content.jobUrl },
    networks: cfg.networks,
    content,
    brand: { name: 'My Best Consultant', website: 'https://mybestconsultant.fr', colors: { dark: '#2C2C2E', accent: '#E8A33D' } },
  }
}

/**
 * Test de connexion : envoie un exemple COMPLET (offre fictive) pour que Make apprenne toute la structure des données.
 * L'évènement vaut « test » (et non « job.published ») : le filtre du scénario l'arrête, rien n'est publié.
 */
export async function sendTestToMake(): Promise<{ ok: boolean; status: number; error?: string }> {
  const cfg = await getSocialConfig()
  const lite: JobLite = {
    id: 'exemple', title: 'Architecte Cloud AWS', company: 'Entreprise exemple', location: 'Paris', contractType: 'freelance', remote: 'hybrid', salary: 650,
    skills: ['AWS', 'Terraform', 'Kubernetes', 'CI/CD'], description: 'Conception et mise en œuvre d’une plateforme cloud. Pilotage technique de l’équipe DevOps. Migration des applications existantes.',
  }
  const site = await canonicalOrigin()
  const content = buildContent(lite, fallbackCopy(lite), cfg, { baseUrl: site, calendlyUrl: resolveCalendly(cfg) })
  return postToMake({ ...buildPayload('test', lite, content, cfg, `${site}/api/social/callback`), event: 'test', sentAt: new Date().toISOString() })
}

/**
 * Pilote Zernio : même exemple que sendTestToMake, mais l'image est générée directement (kie.ai) et publiée
 * pour de vrai sur Instagram via Zernio, au lieu de passer par Make + Buffer. LinkedIn reste sur Make + Buffer
 * (voir sendTestToMake / publishJobSocially) — ceci ne fait que comparer les deux flux sur Instagram.
 */
export async function testZernioInstagram(): Promise<{ ok: boolean; status?: string; permalink?: string; error?: string }> {
  const cfg = await getSocialConfig()
  const lite: JobLite = {
    id: 'exemple', title: 'Architecte Cloud AWS', company: 'Entreprise exemple', location: 'Paris', contractType: 'freelance', remote: 'hybrid', salary: 650,
    skills: ['AWS', 'Terraform', 'Kubernetes', 'CI/CD'], description: 'Conception et mise en œuvre d’une plateforme cloud. Pilotage technique de l’équipe DevOps. Migration des applications existantes.',
  }
  const site = await canonicalOrigin()
  const content = buildContent(lite, fallbackCopy(lite), cfg, { baseUrl: site, calendlyUrl: resolveCalendly(cfg) })

  const { generatePosterImage } = await import('@/lib/kie-image')
  const image = await generatePosterImage(content.image)
  if ('error' in image) return { ok: false, error: `Génération de l’image (kie.ai) : ${image.error}` }

  const { postImageToInstagramViaZernio } = await import('@/lib/zernio')
  const result = await postImageToInstagramViaZernio({ caption: content.captions.instagram, imageUrl: image.url })
  return result.ok ? { ok: true, status: result.status, permalink: result.permalink } : { ok: false, error: result.error }
}

// ── Publication d'une offre ──────────────────────────────────────────────────────────────────

const IN_FLIGHT: SocialStatus[] = ['queued', 'sent', 'images_ready', 'published', 'partial']

export async function publishJobSocially(jobId: string, opts: { trigger: 'auto' | 'manual'; requestedBy: string; force?: boolean }): Promise<{ id?: string; status?: SocialStatus; skipped?: boolean; error?: string }> {
  const cfg = await getSocialConfig()
  if (!isMakeConfigured()) return { error: 'La publication sur les réseaux n’est pas encore configurée.' }
  if (!NETWORKS.some(n => cfg.networks[n])) return { error: 'Aucun réseau n’est activé.' }
  const job = await getJobById(jobId)
  if (!job || !job.isActive) return { error: 'Offre introuvable ou inactive.' }

  const { databases } = createAdminClient()
  if (!opts.force) {
    const prev = await databases.listDocuments(DB_ID, COLLECTIONS.SOCIAL_POSTS, [Query.equal('jobId', jobId), Query.orderDesc('$createdAt'), Query.limit(5)])
    const active = prev.documents.map(docToPost).find(p => IN_FLIGHT.includes(p.status))
    if (active) return { id: active.id, status: active.status, skipped: true }
  }

  let company = job.companyName ?? ''
  if (job.tenantId) { try { company = ((await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, job.tenantId)).name as string) || company } catch { /* nom facultatif */ } }
  const lite = jobToLite(job, company)
  const copy = await generateCopy(lite)
  const site = await canonicalOrigin()
  const content = buildContent(lite, copy, cfg, { baseUrl: site, calendlyUrl: resolveCalendly(cfg) })

  const doc = await databases.createDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, ID.unique(), {
    jobId, tenantId: job.tenantId ?? '', jobTitle: job.title.slice(0, 200), status: 'queued', trigger: opts.trigger,
    requestedBy: opts.requestedBy.slice(0, 100), caption: content.captions.linkedin.slice(0, 3000), attempts: 0,
  })
  const payload = buildPayload(doc.$id, lite, content, cfg, `${site}/api/social/callback`)
  const json = JSON.stringify(payload)
  const sent = await postToMake(payload)
  await databases.updateDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, doc.$id, {
    status: sent.ok ? 'sent' : 'failed', attempts: 1, sentAt: new Date().toISOString(), error: sent.ok ? null : (sent.error ?? 'Échec').slice(0, 500),
    payloadJson: json.length <= 19_500 ? json : JSON.stringify({ ...payload, content: { ...content, image: { ...content.image, prompt: '' } } }).slice(0, 19_500),
  })
  return { id: doc.$id, status: sent.ok ? 'sent' : 'failed', error: sent.ok ? undefined : sent.error }
}

/** Renvoie à Make le contenu déjà préparé (même texte, mêmes consignes d'image) — bouton « Réessayer ». */
export async function retryPost(id: string): Promise<{ status?: SocialStatus; error?: string }> {
  const { databases } = createAdminClient()
  const doc = await databases.getDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, id).catch(() => null)
  if (!doc || doc.status === 'config') return { error: 'Publication introuvable.' }
  const post = docToPost(doc)
  let payload = parse<Record<string, unknown> | null>(doc.payloadJson, null)
  const hasPrompts = !!(payload && (payload.content as SocialContent | undefined)?.image?.prompt)
  if (!payload || !hasPrompts) {
    // Contenu absent ou allégé : on repart d'une préparation complète.
    const r = await publishJobSocially(post.jobId, { trigger: 'manual', requestedBy: 'Relance', force: true })
    return { status: r.status, error: r.error }
  }
  payload = { ...payload, publicationId: id, callbackUrl: await canonicalCallbackUrl() }
  const sent = await postToMake(payload)
  await databases.updateDocument(DB_ID, COLLECTIONS.SOCIAL_POSTS, id, {
    status: sent.ok ? 'sent' : 'failed', attempts: post.attempts + 1, sentAt: new Date().toISOString(), completedAt: null,
    resultsJson: '[]', imagesJson: '[]',
    error: sent.ok ? null : (sent.error ?? 'Échec').slice(0, 500),
  })
  return { status: sent.ok ? 'sent' : 'failed', error: sent.ok ? undefined : sent.error }
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
export async function tryAutoPublishJob(job: Job & { $id: string }): Promise<void> {
  let linkedInHandled = false
  try {
    const cfg = await getSocialConfig()
    if (cfg.autoPublish && isMakeConfigured()) {
      const r = await publishJobSocially(job.$id, { trigger: 'auto', requestedBy: 'Automatique' })
      linkedInHandled = cfg.networks.linkedin && r.status !== 'failed' && !!r.id
    }
  } catch (e) {
    console.error('[social] publication automatique échouée :', e instanceof Error ? e.message : e)
  }
  if (!linkedInHandled) {
    try {
      const { tryAutoPostJobToLinkedIn } = await import('@/lib/linkedin-publish')
      await tryAutoPostJobToLinkedIn(job)
    } catch { /* silencieux : la création d'offre ne dépend jamais des réseaux */ }
  }
}
