import { BRAND_LOGO_URL } from '@/lib/site-links'

// Publication multi-réseaux (Modules 9 et 15) — construction du CONTENU : textes par réseau, consigne de génération
// de l'image unique, lien Calendly de My Best Consultant. Pur (aucun accès base/réseau) : testable seul.
//
// Répartition des rôles : la plateforme prépare tout le contenu (cohérent avec la charte et identique sur tous les
// réseaux) puis l'envoie à Make ; Make génère les visuels (kie.ai / GPT image), les publie via Buffer et rappelle
// la plateforme avec le résultat. Voir /admin/social pour le guide de configuration.

// YouTube Shorts viendra en phase 2 (il exige une vidéo, pas une image).
export const NETWORKS = ['linkedin', 'instagram', 'facebook', 'x'] as const
export type Network = (typeof NETWORKS)[number]

export const NETWORK_LABEL: Record<Network, string> = {
  linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', x: 'X',
}

export interface SocialConfig {
  /** Publication automatique à chaque nouvelle offre de recruteur. Désactivée tant que l'admin ne l'a pas activée. */
  autoPublish: boolean
  networks: Record<Network, boolean>
  includeCalendly: boolean
  /** Lien Calendly de My Best Consultant (vide = lien par défaut du site). Jamais celui du recruteur. */
  calendlyUrl: string
  hashtags: string[]
}

export const DEFAULT_SOCIAL_CONFIG: SocialConfig = {
  autoPublish: false,
  // Seul LinkedIn par défaut : un réseau activé sans module correspondant dans Make ne confirmera jamais sa publication.
  networks: { linkedin: true, instagram: false, facebook: false, x: false },
  includeCalendly: true,
  calendlyUrl: '',
  hashtags: ['recrutement', 'emploi', 'IT', 'consulting'],
}

export function sanitizeSocialConfig(raw: unknown): SocialConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const nets = (r.networks && typeof r.networks === 'object' ? r.networks : {}) as Record<string, unknown>
  const url = typeof r.calendlyUrl === 'string' ? r.calendlyUrl.trim() : ''
  return {
    autoPublish: r.autoPublish === true,
    networks: Object.fromEntries(NETWORKS.map(n => [n, nets[n] === undefined ? DEFAULT_SOCIAL_CONFIG.networks[n] : nets[n] === true])) as Record<Network, boolean>,
    includeCalendly: r.includeCalendly !== false,
    calendlyUrl: /^https:\/\/[^\s]+$/.test(url) ? url.slice(0, 300) : '',
    hashtags: Array.isArray(r.hashtags)
      ? [...new Set((r.hashtags as unknown[]).map(h => String(h).replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 30)).filter(Boolean))].slice(0, 10)
      : DEFAULT_SOCIAL_CONFIG.hashtags,
  }
}

export interface JobLite {
  id: string; title: string; company: string; location: string
  contractType?: string; remote?: string; salary?: number; skills: string[]; description: string
}

/** Texte rédigé (par l'IA, ou repli automatique) dont sont tirés tous les supports. */
export interface CopyDraft {
  hook: string             // accroche courte (≤ 70 car.)
  tagline: string          // phrase d'accroche de l'affiche (≤ 90 car.), propre à ce poste
  pitch: string            // 2-3 phrases
  missionBullets: string[] // 3 puces
  profileBullets: string[] // 3-5 puces
}

/** L'affiche unique publiée partout. 4:5 = le plus haut format accepté par le fil Instagram (le 9:16 y est refusé), et bien reçu par LinkedIn, Facebook et X. */
export interface PostImage {
  prompt: string; aspectRatio: '4:5'; size: '1080x1350'; logoUrl: string
  title: string; company: string; location: string; facts: string[]; skills: string[]; tagline: string
}

export interface SocialContent {
  jobUrl: string
  calendlyUrl: string
  hashtags: string[]
  captions: { linkedin: string; instagram: string; facebook: string; x: string }
  image: PostImage
}

const CONTRACT: Record<string, string> = { cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission' }
const REMOTE: Record<string, string> = { onsite: 'Présentiel', hybrid: 'Hybride', remote: 'Full remote' }
const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…')
const plain = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

export function conditionLines(job: JobLite): string[] {
  const rate = job.salary ? (job.contractType === 'freelance' || job.contractType === 'mission' ? `TJM ${job.salary} €/jour` : `${job.salary} €/mois`) : ''
  return [
    job.contractType ? CONTRACT[job.contractType] ?? job.contractType : '',
    job.remote ? REMOTE[job.remote] ?? job.remote : '',
    job.location ? `📍 ${job.location}` : '',
    rate,
  ].filter(Boolean)
}

/** Repli déterministe quand l'IA n'est pas disponible : la publication ne doit jamais dépendre d'elle. */
export function fallbackCopy(job: JobLite): CopyDraft {
  const sentences = plain(job.description).split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 20)
  return {
    hook: clip(job.title, 70),
    tagline: clip(job.company ? `Rejoignez ${job.company} et donnez un nouvel élan à votre carrière` : 'Une mission à la hauteur de votre expertise', 90),
    pitch: clip(sentences.slice(0, 2).join(' ') || `${job.company || 'Une entreprise'} recrute : ${job.title}.`, 320),
    missionBullets: (sentences.slice(0, 3).length ? sentences.slice(0, 3) : [`Rejoignez ${job.company || 'une équipe ambitieuse'} sur cette mission.`]).map(s => clip(s.replace(/[.!?]+$/, ''), 90)),
    profileBullets: job.skills.slice(0, 5).length ? job.skills.slice(0, 5) : ['Profil senior', 'Autonomie', 'Esprit d’équipe'],
  }
}

/** Nettoie/borne un brouillon reçu de l'IA ; complète avec le repli pour les champs manquants. */
export function normalizeCopy(raw: unknown, job: JobLite): CopyDraft {
  const fb = fallbackCopy(job)
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const list = (v: unknown, max: number, len: number) => Array.isArray(v) ? v.map(x => clip(String(x).trim(), len)).filter(Boolean).slice(0, max) : []
  const mission = list(r.missionBullets, 3, 90)
  const profile = list(r.profileBullets, 5, 40)
  return {
    hook: typeof r.hook === 'string' && r.hook.trim() ? clip(r.hook.trim(), 70) : fb.hook,
    tagline: typeof r.tagline === 'string' && r.tagline.trim() ? clip(r.tagline.trim(), 90) : fb.tagline,
    pitch: typeof r.pitch === 'string' && r.pitch.trim() ? clip(r.pitch.trim(), 320) : fb.pitch,
    missionBullets: mission.length ? mission : fb.missionBullets,
    profileBullets: profile.length ? profile : fb.profileBullets,
  }
}

const PALETTE = 'Strict brand palette: deep anthracite #2C2C2E (dominant background and overlays), warm orange-gold #E8A33D (accents, separator, pills, highlights), pure white #FFFFFF (text). No other dominant colours.'

/**
 * Consigne de génération de l'affiche (modèle image-vers-image : le logo est fourni en image de référence).
 * Tous les textes sont donnés mot pour mot : le modèle doit les écrire tels quels, sans rien ajouter.
 */
function imagePrompt(i: Omit<PostImage, 'prompt'>): string {
  const where = [i.company, i.location].filter(Boolean).join(' — ')
  return [
    `Ultra-premium professional job-recruitment poster for the consulting brand "My Best Consultant", portrait ${i.aspectRatio} format (${i.size}), luxury editorial magazine look, 4K ultra sharp, every text perfectly legible.`,
    PALETTE,
    '',
    'LOGO — The attached reference image is the official My Best Consultant round logo badge (white "MBC" monogram inside an orange-gold ring). Place it exactly as provided, centered at the top, about 16% of the poster width, with a soft warm orange glow behind it. Do NOT redraw, restyle, translate or alter the logo or its lettering in any way.',
    '',
    `SCENE — It must PERFECTLY match this specific job: "${i.title}"${i.skills.length ? `, key skills: ${i.skills.join(', ')}` : ''}. Generate a photorealistic, cinematic workplace scene made for this exact role: the real environment, tools and activity of a "${i.title}" (examples: a data engineer at dual monitors with pipelines and dashboards; a cybersecurity consultant in a security operations room; a project manager leading a workshop at a whiteboard; a cloud architect reviewing architecture diagrams; a business analyst facilitating a meeting; a developer coding in an IDE). One or two diverse, natural, smiling professionals in smart business attire actively doing that work, candid confident expression, high-end editorial photography, shallow depth of field, cinematic bokeh, warm orange accent light, modern premium office. The scene occupies about 42% of the poster height and fades smoothly into anthracite #2C2C2E toward the text area.`,
    '',
    'LAYOUT, top to bottom:',
    '(1) The logo, top center.',
    '(2) A thin orange-gold separator line.',
    '(3) The workplace scene (about 42% of the height), blended into the anthracite background.',
    `(4) GIANT bold white sans-serif title with a short orange underline, the most prominent text: "${i.title}"`,
    where ? `(5) Semi-bold white line: "${where}"` : null,
    i.facts.length ? `(6) A row of orange-gold rounded pills with dark anthracite text, one per item: ${i.facts.map(f => `"${f}"`).join(', ')}` : null,
    i.skills.length ? `(7) A row of small outlined rounded tags (white text, thin orange outline): ${i.skills.map(k => `"${k}"`).join(', ')}` : null,
    `(8) One inspiring sentence in white italic: "${i.tagline}"`,
    '(9) A prominent orange-gold rounded button with dark anthracite text: "Postulez sur mybestconsultant.fr"',
    '(10) A slim dark anthracite footer with the small white wordmark "My Best Consultant" and "mybestconsultant.fr".',
    '',
    'TEXT RULES — Write the quoted texts EXACTLY as given, in French, with correct spelling and all accents. Add NO other text, numbers, placeholders, lorem ipsum, phone numbers or watermarks. Keep generous margins and strong contrast so nothing is cropped or hard to read.',
  ].filter((l): l is string => l !== null).join('\n')
}

export function shortUrl(url: string): string { return url.replace(/^https?:\/\//, '').replace(/\/$/, '') }

export function jobUrl(baseUrl: string, jobId: string, network?: Network): string {
  const u = `${baseUrl.replace(/\/$/, '')}/jobs/${jobId}`
  return network ? `${u}?utm_source=${network}` : u
}

/** Longueur d'un tweet telle que X la compte : chaque URL vaut 23 caractères. */
export function xLength(text: string): number {
  return text.replace(/https?:\/\/\S+/g, 'x'.repeat(23)).length
}

export function buildContent(job: JobLite, copy: CopyDraft, cfg: SocialConfig, opts: { baseUrl: string; calendlyUrl: string }): SocialContent {
  const calendly = cfg.includeCalendly ? opts.calendlyUrl : ''
  const conditions = conditionLines(job)
  const tags = cfg.hashtags.map(h => `#${h}`)
  const urls = Object.fromEntries(NETWORKS.map(n => [n, jobUrl(opts.baseUrl, job.id, n)])) as Record<Network, string>

  // ── Affiche unique ──
  const facts = conditions.filter(l => !l.startsWith('📍'))
  const base = {
    aspectRatio: '4:5' as const, size: '1080x1350' as const, logoUrl: BRAND_LOGO_URL,
    title: clip(job.title, 80), company: job.company, location: job.location, facts, skills: copy.profileBullets.slice(0, 4), tagline: copy.tagline,
  }
  const image: PostImage = { ...base, prompt: imagePrompt(base) }

  // ── Textes par réseau ──
  // Même trame partout (accroche, lieu et conditions, missions, profil, liens), adaptée à la longueur et aux usages de chaque réseau.
  const rate = conditions.find(l => l.startsWith('TJM') || l.includes('€/mois')) ?? ''
  const meta = [job.location && `📍 ${job.location}`, job.contractType ? CONTRACT[job.contractType] ?? job.contractType : '', job.remote ? REMOTE[job.remote] ?? job.remote : '', rate].filter(Boolean).join(' · ')
  const head = `🚀 ${job.title}${job.company ? ` — ${job.company}` : ''}`
  const bullets = copy.missionBullets.map(b => `• ${b}`).join('\n')
  const skills = copy.profileBullets.slice(0, 5).join(' · ')
  const program = bullets ? `🎯 Au programme\n${bullets}` : ''
  const profile = skills ? `🧩 Profil recherché : ${skills}` : ''
  const cta = (url: string) => `👉 Voir l’offre et postuler : ${url}`
  const rdv = calendly ? `📅 Envie d’en discuter ? Réservez un échange : ${calendly}` : ''
  const join = (...parts: string[]) => parts.filter(Boolean).join('\n\n')

  const linkedin = clip(join(head, copy.tagline, meta, program, profile, [cta(urls.linkedin), rdv].filter(Boolean).join('\n'), tags.join(' ')), 2900)
  const facebook = clip(join(head, copy.tagline, meta, program, [cta(urls.facebook), rdv].filter(Boolean).join('\n'), tags.slice(0, 3).join(' ')), 2900)
  // Instagram : les liens des légendes ne sont pas cliquables → on renvoie vers le lien de la bio.
  const instagram = clip(join(head, copy.tagline, meta, program, profile, ['👉 Postuler : lien dans la bio 🔗 mybestconsultant.fr', rdv].filter(Boolean).join('\n'), tags.join(' ')), 2100)

  // X : on retire progressivement les éléments optionnels jusqu'à tenir dans 280 caractères.
  const xLink = `👉 ${urls.x}`
  const xCal = calendly ? `\n📅 ${calendly}` : ''
  const xVariants = [
    `🚀 ${copy.hook}\n${meta}\n\n${xLink}${xCal}\n${tags.slice(0, 3).join(' ')}`,
    `🚀 ${copy.hook}\n${meta}\n\n${xLink}${xCal}`,
    `🚀 ${copy.hook}\n\n${xLink}${xCal}`,
    `🚀 ${copy.hook}\n\n${xLink}`,
    `🚀 ${clip(copy.hook, 200)}\n${xLink}`,
  ]
  const x = xVariants.find(v => xLength(v) <= 280) ?? xVariants[xVariants.length - 1]

  return { jobUrl: urls.linkedin.split('?')[0], calendlyUrl: calendly, hashtags: cfg.hashtags, captions: { linkedin, instagram, facebook, x }, image }
}
