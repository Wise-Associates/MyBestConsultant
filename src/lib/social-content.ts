// Publication multi-réseaux (Modules 9 et 15) — construction du CONTENU : textes par réseau, textes de l'affiche
// unique, lien Calendly de My Best Consultant. Pur (aucun accès base/réseau) : testable seul.
//
// Répartition des rôles (ADR 0015) : la plateforme prépare tout le contenu et dessine l'affiche (lib/social-poster,
// photo de la scène par un modèle d'image d'OpenAI) ; Make la publie via Buffer depuis son adresse et rappelle la
// plateforme avec le résultat. Voir /admin/social pour le guide de configuration.

import { kindOf, stripInline, type SectionKind } from './description-sections'
import { payText } from './job-pay'

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
  contractType?: string; remote?: string; salary?: number; skills: string[]
  /** Description publiée, retours à la ligne gardés (titres « ### », puces « - ») : reprise telle quelle sur LinkedIn. */
  description: string
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
  // Unité fixée par le contrat, comme sur la page de l'offre (job-pay.ts) : un CDI s'écrivait « €/mois ».
  const rate = job.salary ? payText(job.salary, job.contractType) : ''
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
    missionBullets: (sentences.slice(0, 3).length ? sentences.slice(0, 3) : [`Rejoignez ${job.company || 'une équipe ambitieuse'} sur cette mission.`]).map(s => s.replace(/[.!?]+$/, '')),
    profileBullets: job.skills.slice(0, 5).length ? job.skills.slice(0, 5) : ['Profil senior', 'Autonomie', 'Esprit d’équipe'],
  }
}

/** Nettoie/borne un brouillon reçu de l'IA ; complète avec le repli pour les champs manquants. */
export function normalizeCopy(raw: unknown, job: JobLite): CopyDraft {
  const fb = fallbackCopy(job)
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  // Puces gardées entières (une puce coupée en plein mot se lisait sur les publications) ; chaque légende reste bornée par buildContent.
  const list = (v: unknown, max: number) => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean).slice(0, max) : []
  const mission = list(r.missionBullets, 3)
  const profile = list(r.profileBullets, 5)
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

// Limite de LinkedIn : 3 000 caractères par publication ; marge gardée, la façon dont Buffer et LinkedIn comptent n'étant pas documentée.
const LINKEDIN_MAX_CHARS = 2900

const HEADING_EMOJI: Record<SectionKind, string> = { context: '🏢', tasks: '🎯', profile: '🧩', terms: '📋', other: '📌' }

/** Ajoutée quand la description a été raccourcie : la suite est sur la page de l'offre, dont le lien suit. */
const MORE_LINE = '➕ Suite de l’offre sur le lien ci-dessous'

/** Section de la description : titre (vide pour l'introduction) puis lignes, lignes vides comprises. */
interface LinkedInSection { title: string; lines: string[] }

/**
 * Description de l'offre (format de la page publique : titres « ### », puces « - ») en texte LinkedIn, qui n'affiche pas
 * le markdown : titres précédés d'un emoji, puces « • », gras et italique retirés. Rangée par section pour pouvoir être
 * raccourcie section par section.
 */
function linkedinSections(description: string): LinkedInSection[] {
  const sections: LinkedInSection[] = [{ title: '', lines: [] }]
  for (const raw of description.split('\n')) {
    const line = raw.replace(/[ \t]+/g, ' ').trim()
    const heading = /^#{1,6}\s+(.+)$/.exec(line)
    if (heading) {
      const title = stripInline(heading[1]).replace(/\s*:\s*$/, '')
      // « Au programme » : titre des missions posé par « Préparer la publication » (descriptionFromCopy).
      sections.push({ title: `${HEADING_EMOJI[/^au programme$/i.test(title) ? 'tasks' : kindOf(title)]} ${title}`, lines: [] })
      continue
    }
    const item = /^[-*•]\s+(.+)$/.exec(line)
    sections[sections.length - 1].lines.push(item ? `• ${stripInline(item[1])}` : stripInline(line))
  }
  return sections
}

const renderSections = (sections: LinkedInSection[]) =>
  sections.flatMap(s => (s.title ? [s.title, ...s.lines] : s.lines)).join('\n').replace(/\n{3,}/g, '\n\n').trim()

const sectionLength = (s: LinkedInSection) => s.lines.reduce((n, line) => n + line.length, 0)

/**
 * Description qui tient en `max` caractères. Trop longue, chaque section perd ses dernières lignes, la plus longue
 * d'abord, en gardant au moins la première : toutes les sections restent visibles avec leurs premières puces (couper par
 * la fin faisait disparaître le profil derrière une longue liste de missions), et une ligne dit où lire la suite.
 */
function fitDescription(description: string, max: number): string {
  const sections = linkedinSections(description)
  const full = renderSections(sections)
  if (full.length <= max) return full
  const room = max - MORE_LINE.length - 2
  while (renderSections(sections).length > room) {
    const trimmable = sections.filter(s => s.lines.filter(Boolean).length > 1)
    if (trimmable.length === 0) break
    const longest = trimmable.reduce((a, b) => (sectionLength(b) > sectionLength(a) ? b : a))
    longest.lines.splice(longest.lines.findLastIndex(Boolean), 1)
  }
  // Une section réduite à une ligne encore trop longue (paragraphe unique) : coupée au dernier mot entier.
  return `${fitText(renderSections(sections), room)}\n\n${MORE_LINE}`
}

/** Texte trop long coupé à la dernière ligne entière qui tient (sinon au dernier mot entier), suivi de « … ». */
function fitText(text: string, max: number): string {
  if (text.length <= max) return text
  if (max < 2) return ''
  const cut = text.slice(0, max - 2)
  const line = cut.lastIndexOf('\n')
  if (line > max / 2) return `${cut.slice(0, line).trimEnd()}\n…`
  const word = cut.lastIndexOf(' ')
  return `${(word > 0 ? cut.slice(0, word) : cut).trimEnd()}…`
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
    // Pastilles de l'affiche : 40 caractères, la place qu'elles ont à l'image (bornes relues par social-poster/rules.ts).
    title: clip(job.title, 80), company: job.company, location: job.location, facts, skills: copy.profileBullets.slice(0, 4).map(s => clip(s, 40)), tagline: copy.tagline,
  }

  // ── Textes par réseau ──
  // Même trame partout (accroche, lieu et conditions, missions, profil, liens), adaptée à la longueur et aux usages de chaque réseau.
  const rate = job.salary ? payText(job.salary, job.contractType) : ''
  const meta = [job.location && `📍 ${job.location}`, job.contractType ? CONTRACT[job.contractType] ?? job.contractType : '', job.remote ? REMOTE[job.remote] ?? job.remote : '', rate].filter(Boolean).join(' · ')
  const head = `🚀 ${job.title}${job.company ? ` — ${job.company}` : ''}`
  const bullets = copy.missionBullets.map(b => `• ${b}`).join('\n')
  const skills = copy.profileBullets.slice(0, 5).join(' · ')
  const program = bullets ? `🎯 Au programme\n${bullets}` : ''
  const profile = skills ? `🧩 Profil recherché : ${skills}` : ''
  const cta = (url: string) => `👉 Voir l’offre et postuler : ${url}`
  const rdv = calendly ? `📅 Envie d’en discuter ? Réservez un échange : ${calendly}` : ''
  const join = (...parts: string[]) => parts.filter(Boolean).join('\n\n')

  // LinkedIn : le texte complet de l'offre publiée (son accroche remplace celle de l'IA), sans autre limite que celle de
  // LinkedIn ; une offre trop longue est raccourcie section par section (fitDescription), jamais les liens ni les hashtags.
  const hasDescription = job.description.trim() !== ''
  const liEnd = join([cta(urls.linkedin), rdv].filter(Boolean).join('\n'), tags.join(' '))
  const liTop = hasDescription ? join(head, meta) : join(head, copy.tagline, meta)
  const liBody = hasDescription ? fitDescription(job.description, LINKEDIN_MAX_CHARS - liTop.length - liEnd.length - 4) : join(program, profile)
  const linkedin = clip(join(liTop, liBody, liEnd), LINKEDIN_MAX_CHARS)
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
