// Publication multi-réseaux (Modules 9 et 15) — construction du CONTENU : textes par réseau, textes de l'affiche
// unique, lien Calendly de My Best Consultant. Pur (aucun accès base/réseau) : testable seul.
//
// Répartition des rôles (ADR 0015) : la plateforme prépare tout le contenu et dessine l'affiche (lib/social-poster,
// photo de la scène par un modèle d'image d'OpenAI) ; Make la publie via Buffer depuis son adresse et rappelle la
// plateforme avec le résultat. Voir /admin/social pour le guide de configuration.

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

/** Offre fictive des tests (connexion à Make, pilote Zernio) et de l'affiche d'exemple : rien de réel n'est publié avec. */
export const SAMPLE_JOB: JobLite = {
  id: 'exemple', title: 'Architecte Cloud AWS', company: 'Entreprise exemple', location: 'Paris', contractType: 'freelance', remote: 'hybrid', salary: 650,
  skills: ['AWS', 'Terraform', 'Kubernetes', 'CI/CD'], description: 'Conception et mise en œuvre d’une plateforme cloud. Pilotage technique de l’équipe DevOps. Migration des applications existantes.',
}

/** Texte rédigé (par l'IA, ou repli automatique) dont sont tirés tous les supports. */
export interface CopyDraft {
  hook: string             // accroche courte (≤ 70 car.)
  tagline: string          // phrase d'accroche de l'affiche (≤ 90 car.), propre à ce poste
  pitch: string            // 2-3 phrases
  missionBullets: string[] // 3 puces
  profileBullets: string[] // 3-5 puces
}

/** Textes de l'affiche unique publiée partout (dessinée par lib/social-poster, au format 4:5). */
export interface PostImage {
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
  const image: PostImage = {
    title: clip(job.title, 80), company: job.company, location: job.location, facts, skills: copy.profileBullets.slice(0, 4), tagline: copy.tagline,
  }

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
