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
  /** Présentation de Wise Associates en tête des publications LinkedIn des offres de la plateforme (vide = aucune). */
  publisherIntro: string
}

/** Texte de la direction (2026-11-17), modifiable dans /admin/social. */
export const DEFAULT_PUBLISHER_INTRO = 'Wise Associates est un cabinet de conseil en management destiné aux institutions financières et aux compagnies d’assurance. Le cabinet a développé des expertises en stratégie, gestion des risques, finance et conformité, Data et intelligence artificielle, ainsi qu’en transformation digitale des organisations.'
/** Présentation par défaut précédente : un réglage enregistré sans la modifier reçoit la nouvelle. */
const PREVIOUS_PUBLISHER_INTRO = 'Wise Associates est un cabinet de conseil qui accompagne entreprises, organismes publics et investisseurs dans leurs transformations commerciales et numériques : stratégie, risques, data & IA.'
const PUBLISHER_INTRO_MAX = 400

/** Pôles d'expertise de Wise Associates, nommés dans les publications de ses offres ; l'IA en choisit un, ou aucun. */
export const WISE_POLES = ['Stratégie', 'Gestion des risques', 'Finance et conformité', 'Data et intelligence artificielle', 'Transformation digitale'] as const

export const DEFAULT_SOCIAL_CONFIG: SocialConfig = {
  autoPublish: false,
  // Seul LinkedIn par défaut : un réseau activé sans module correspondant dans Make ne confirmera jamais sa publication.
  networks: { linkedin: true, instagram: false, facebook: false, x: false },
  includeCalendly: true,
  calendlyUrl: '',
  hashtags: ['recrutement', 'emploi', 'IT', 'consulting'],
  publisherIntro: DEFAULT_PUBLISHER_INTRO,
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
    // Absente (réglage enregistré avant elle) ou restée l'ancienne par défaut : celle par défaut ; vidée par l'admin : aucune.
    publisherIntro: typeof r.publisherIntro === 'string' && r.publisherIntro.trim() !== PREVIOUS_PUBLISHER_INTRO
      ? r.publisherIntro.replace(/\s+/g, ' ').trim().slice(0, PUBLISHER_INTRO_MAX)
      : DEFAULT_PUBLISHER_INTRO,
  }
}

export interface JobLite {
  id: string; title: string; company: string; location: string
  contractType?: string; remote?: string; salary?: number; skills: string[]
  /** Description publiée, retours à la ligne gardés (titres « ### », puces « - ») : reprise telle quelle sur LinkedIn. */
  description: string
  /** Offre de la plateforme (appels d'offres, offres de l'admin) : publiée au nom de Wise Associates. Sinon, offre d'une organisation cliente. */
  fromPlatform?: boolean
  /**
   * Offre d'une organisation cliente : sa présentation, tirée de sa marque employeur (brandPresentation), en tête du
   * contexte LinkedIn comme celle de Wise Associates pour les offres de la plateforme ; vide : pas de présentation.
   */
  publisherAbout?: string
}

/** Texte brut d'une description, retours à la ligne gardés (titres « ### », puces « - ») : reprise telle quelle sur LinkedIn. */
const plainLines = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim()

/** Longueur de la présentation d'une organisation dans le contexte LinkedIn. */
const PRESENTATION_MAX = 300

/**
 * Présentation d'une organisation cliente pour ses posts LinkedIn (ADR 0058), écrite par elle dans sa marque employeur :
 * les premières phrases entières de son « À propos » qui tiennent en 300 caractères ; sinon son accroche ; sinon rien
 * (aucune présentation n'est inventée).
 */
export function brandPresentation(about: string, tagline: string): string {
  const sentences = plain(about).split(/(?<=[.!?…])\s+/).filter(Boolean)
  let text = ''
  for (const sentence of sentences) {
    const next = text ? `${text} ${sentence}` : sentence
    if (next.length > PRESENTATION_MAX) break
    text = next
  }
  return text || clip(plain(tagline), PRESENTATION_MAX)
}

/** Champs d'une offre lus pour la publication : offre enregistrée, ou version relue avant sa publication. */
export interface JobForSocial {
  id: string; title: string; location?: string; contractType?: string; remote?: string; salary?: number; skills?: string[]; description?: string
}

/**
 * Offre telle que la lisent les textes des réseaux, champs bornés (le corps envoyé à Make et enregistré dans
 * payloadJson, 20 000 caractères, doit tenir à coup sûr). `company` : l'organisation qui recrute (son nom, sinon
 * l'entreprise affichée de l'offre) ; `fromPlatform` : offre publiée au nom de Wise Associates ; `publisherAbout` :
 * présentation de l'organisation (brandPresentation). Partagée par la diffusion (jobToLite, social.ts) et l'aperçu du
 * post avant publication (ao/publication-social.ts) : ils ne peuvent pas diverger.
 */
export function jobLiteOf(job: JobForSocial, company: string, fromPlatform: boolean, publisherAbout = ''): JobLite {
  return {
    id: job.id, title: job.title.slice(0, 200), company: company.slice(0, 120), location: (job.location ?? '').slice(0, 120),
    contractType: job.contractType, remote: job.remote, salary: job.salary,
    // Retours à la ligne gardés : la description est publiée telle quelle sur LinkedIn, qui n'en affiche pas plus de 3 000 caractères.
    skills: (job.skills ?? []).slice(0, 15).map(k => k.slice(0, 40)), description: plainLines(job.description ?? '').slice(0, 3000),
    fromPlatform, publisherAbout: publisherAbout.slice(0, PRESENTATION_MAX),
  }
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
  context: string          // 1-2 phrases sur le projet ou la mission (LinkedIn) ; vide = accroche de la description
  pole: string             // pôle de Wise Associates (WISE_POLES) dont relève le poste ; vide = aucun ne convient
  hashtags: string[]       // expertises proposées par l'IA, vérifiées contre l'offre (offerHashtags)
}

/**
 * Textes du post LinkedIn relus avant la publication d'un AO (ADR 0058). Pour une offre avec description (toujours le cas
 * d'un AO), le post LinkedIn ne dépend que d'eux parmi les textes rédigés ; les autres (affiche, autres réseaux) sont
 * rédigés à la diffusion.
 */
export type SocialEdits = Pick<CopyDraft, 'context' | 'pole' | 'hashtags'>

/** Longueur de « Le projet » (contexte du post). */
export const SOCIAL_CONTEXT_MAX = 320

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
    context: '',
    pole: '',
    hashtags: [],
  }
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()

/** Pôle proposé par l'IA, gardé seulement s'il est l'un de WISE_POLES (écrit comme dans la liste) ; sinon aucun. */
function knownPole(value: unknown): string {
  return typeof value === 'string' ? WISE_POLES.find(p => fold(p) === fold(value)) ?? '' : ''
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
    context: typeof r.context === 'string' ? clip(plain(r.context), SOCIAL_CONTEXT_MAX) : '',
    pole: knownPole(r.pole),
    hashtags: list(r.hashtags, 10).map(h => h.slice(0, 60)),
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

// ── Contexte en tête de la publication LinkedIn ──

/** Accroche de la description (paragraphe court avant le premier titre « ### ») : elle sert de « Le projet » quand l'IA n'en a pas rédigé. */
const LEAD_MAX = 320

function splitLead(description: string): { lead: string; rest: string } {
  const lines = description.split('\n')
  const firstHeading = lines.findIndex(l => /^\s*#{1,6}\s+\S/.test(l))
  if (firstHeading <= 0) return { lead: '', rest: description }
  const before = lines.slice(0, firstHeading).join('\n').trim()
  // Un seul paragraphe court, sans puce : une accroche. Un texte plus long reste dans le corps, rien n'en est retiré.
  if (!before || /\n\s*\n/.test(before) || /^\s*[-*•]\s/m.test(before) || before.length > LEAD_MAX) return { lead: '', rest: description }
  return { lead: stripInline(before.replace(/\s+/g, ' ')), rest: lines.slice(firstHeading).join('\n') }
}

/** Intitulé dans la phrase de recrutement : sans « H/F », parenthèses ni « Consultant » en tête (« Consultant SAP FI (H/F) » → « SAP FI »). */
function recruitTitle(title: string): string {
  return title.replace(/\([^)]*\)/g, ' ').replace(/\b[HF]\s*\/\s*[HF]\b/gi, ' ')
    // Intitulé d'un lot d'appel d'offres (« Lot 2. Expert en… ») : le numéro du lot n'a pas de sens dans la phrase.
    .replace(/^\s*lot\s*(?:n°|no\.?)?\s*\d+\s*[.:\-–—]?\s*/i, '')
    .replace(/^\s*consultant(e|\(e\))?\s+/i, '').replace(/\s+/g, ' ').trim()
}

/** Offre de la plateforme : phrase de la direction (texte de David, 2026-11-17) ; sans pôle, « ses équipes ». */
function recruitLine(job: JobLite, pole: string): string {
  const team = pole ? `son pôle d’expertise ${pole}` : 'ses équipes'
  return `Dans le cadre de son développement, Wise Associates recherche un consultant ${recruitTitle(job.title)} pour rejoindre ${team} et intervenir auprès de ses clients du secteur financier et de l’assurance.`
}

/**
 * Offre d'une organisation cliente : même phrase que celle de la direction pour Wise Associates (ADR 0058), sans ce qui
 * n'est vrai que de Wise (pôles, clients du secteur financier et de l'assurance), selon le contrat.
 */
function orgRecruitLine(job: JobLite): string {
  const contract = job.contractType === 'cdi' || job.contractType === 'cdd' ? CONTRACT[job.contractType] : ''
  const purpose = contract ? `rejoindre ses équipes en ${contract}` : 'intervenir sur une mission'
  return `Dans le cadre de son développement, ${job.company || 'l’entreprise'} recherche un consultant ${recruitTitle(job.title)} pour ${purpose}.`
}

/** Offre d'une organisation cliente : la plateforme diffuse pour son compte. */
const ORG_DIFFUSION_LINE = '📣 Offre diffusée via MyBestConsultant, la plateforme de recrutement de Wise Associates.'

// ── Hashtags d'expertise ──

const HASHTAG_MAX_CHARS = 30
const OFFER_HASHTAGS_MAX = 6
const SMALL_WORDS = new Set(['a', 'au', 'aux', 'd', 'de', 'des', 'du', 'en', 'et', 'l', 'la', 'le', 'les', 'pour', 'and', 'of', 'the'])

/** Mots d'un texte, sans accents. Les graphies dont la ponctuation porte le sens sont écrites en toutes lettres (C# → CSharp). */
function words(text: string): string[] {
  return text.normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/c\+\+/gi, ' Cpp ')
    .replace(/(^|[^\p{L}\p{N}])([cf])#/giu, (_, before: string, letter: string) => `${before} ${letter.toUpperCase()}Sharp `)
    .replace(/(^|\s)\.net\b/gi, '$1 DotNet ')
    .replace(/\.(net|js)\b/gi, (_, ext: string) => ext.toUpperCase())
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/** Hashtag (sans « # ») d'un terme : mots collés, chacun avec une majuscule, sigles gardés. Vide s'il est trop long ou sans lettre. */
export function toHashtag(term: string): string {
  const tag = words(term.replace(/\([^)]*\)/g, ' '))
    .map(w => (/[A-Z]/.test(w.slice(1)) || /\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join('')
  if (tag.length < 2 || tag.length > HASHTAG_MAX_CHARS || !/\p{L}/u.test(tag) || SMALL_WORDS.has(tag.toLowerCase())) return ''
  return tag
}

/** Toutes les suites de 1 à 4 mots de l'intitulé, des compétences et de la description, collées et en minuscules. */
function offerTerms(job: JobLite): Set<string> {
  const terms = new Set<string>()
  for (const text of [job.title, ...job.skills, job.description]) {
    const w = words(text).map(x => x.toLowerCase())
    for (let i = 0; i < w.length; i++) for (let n = 1; n <= 4 && i + n <= w.length; n++) terms.add(w.slice(i, i + n).join(''))
  }
  return terms
}

/**
 * Hashtags des expertises de l'offre. Ceux proposés par l'IA ne sont gardés que s'ils figurent dans l'offre (intitulé,
 * compétences, sigle entre parenthèses, description) : aucun hashtag hors sujet. Sans proposition retenue : les compétences
 * de l'offre, dans leur ordre.
 */
export function offerHashtags(job: JobLite, proposed: string[]): string[] {
  const known = offerTerms(job)
  const checked = proposed.map(toHashtag).filter(t => t && known.has(t.toLowerCase()))
  const tags = checked.length ? checked : job.skills.map(toHashtag).filter(Boolean)
  return uniqueTags(tags).slice(0, OFFER_HASHTAGS_MAX)
}

/** Sans doublon, la casse et les accents ignorés : la première graphie l'emporte. */
function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>()
  return tags.filter(t => { const k = words(t).join('').toLowerCase(); return k && !seen.has(k) && seen.add(k) })
}

/** Hashtag du type de contrat : une mission se cherche sous « Freelance ». */
const CONTRACT_HASHTAG: Record<string, string> = { cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Freelance' }

/**
 * Hashtags de chaque réseau (règle validée par la direction le 2026-11-17) : peu de hashtags, ciblés sur l'offre.
 * LinkedIn et Instagram : le poste, 3 expertises et le contrat, 5 en tout (le poste a remplacé « #Recrutement ») ;
 * Facebook, où ils servent peu : 2 expertises et le contrat ; X, où la place manque : 2 expertises.
 */
const NETWORK_HASHTAGS: Record<Network, { total: number; role: boolean; expertise: number }> = {
  linkedin: { total: 5, role: true, expertise: 3 }, instagram: { total: 5, role: true, expertise: 3 },
  facebook: { total: 3, role: false, expertise: 2 }, x: { total: 2, role: false, expertise: 2 },
}

/**
 * Hashtag du poste : l'intitulé avant « / », « - », « | » ou la première virgule, sans « H/F » ni parenthèses
 * (« Ingénieur DevOps / Cloud AWS » → IngenieurDevOps). Vide si le poste ne tient pas en un hashtag (30 caractères).
 */
export function roleHashtag(title: string): string {
  const role = title.replace(/\([^)]*\)/g, ' ').replace(/\b[HF]\s*\/\s*[HF]\b/gi, ' ').split(/\s[/|–—-]\s|,/)[0]
  return toHashtag(role)
}

/**
 * Hashtags (avec « # ») de chaque réseau. Avec le poste, une expertise qui n'en est que le début est écartée
 * (#ChefDeProjet à côté de #ChefDeProjetData). Il en manque (poste trop long, peu d'expertises, pas de contrat) : les
 * expertises suivantes, puis les hashtags du réglage complètent.
 */
export function networkHashtags(job: JobLite, proposed: string[], cfg: SocialConfig): Record<Network, string[]> {
  const expertise = offerHashtags(job, proposed)
  const role = roleHashtag(job.title)
  const contract = CONTRACT_HASHTAG[job.contractType ?? ''] ?? ''
  return Object.fromEntries(NETWORKS.map(n => {
    const { total, role: withRole, expertise: first } = NETWORK_HASHTAGS[n]
    const own = withRole && role ? expertise.filter(e => !role.toLowerCase().startsWith(e.toLowerCase())) : expertise
    const ordered = [withRole ? role : '', ...own.slice(0, first), contract, ...own.slice(first), ...cfg.hashtags.map(toHashtag)]
    return [n, uniqueTags(ordered.filter(Boolean)).slice(0, total).map(t => `#${t}`)]
  })) as Record<Network, string[]>
}

/**
 * Texte en gras pour les réseaux, qui n'affichent pas le markdown : lettres et chiffres en caractères gras Unicode
 * (Mathematical Sans-Serif Bold). Une lettre accentuée devient la lettre grasse suivie de son accent combinant ; le
 * reste (ponctuation, « œ »…) est gardé tel quel.
 */
export function boldText(text: string): string {
  return Array.from(text.normalize('NFD'), ch => {
    const c = ch.codePointAt(0) ?? 0
    if (c >= 0x41 && c <= 0x5a) return String.fromCodePoint(0x1d5d4 + c - 0x41)
    if (c >= 0x61 && c <= 0x7a) return String.fromCodePoint(0x1d5ee + c - 0x61)
    if (c >= 0x30 && c <= 0x39) return String.fromCodePoint(0x1d7ec + c - 0x30)
    return ch
  }).join('')
}

/** Longueur d'un tweet telle que X la compte : chaque URL vaut 23 caractères. */
export function xLength(text: string): number {
  return text.replace(/https?:\/\/\S+/g, 'x'.repeat(23)).length
}

export function buildContent(job: JobLite, copy: CopyDraft, cfg: SocialConfig, opts: { baseUrl: string; calendlyUrl: string }): SocialContent {
  const calendly = cfg.includeCalendly ? opts.calendlyUrl : ''
  const conditions = conditionLines(job)
  const tags = networkHashtags(job, copy.hashtags, cfg)
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
  // Intitulé en gras (demande de la direction du 2026-11-17) ; X reprend l'accroche, pas cette ligne.
  const head = `🚀 ${boldText(job.title)}${job.company ? ` — ${job.company}` : ''}`
  const bullets = copy.missionBullets.map(b => `• ${b}`).join('\n')
  const skills = copy.profileBullets.slice(0, 5).join(' · ')
  const program = bullets ? `🎯 Au programme\n${bullets}` : ''
  const profile = skills ? `🧩 Profil recherché : ${skills}` : ''
  const cta = (url: string) => `👉 Voir l’offre et postuler : ${url}`
  const rdv = calendly ? `📅 Envie d’en discuter ? Réservez un échange : ${calendly}` : ''
  const join = (...parts: string[]) => parts.filter(Boolean).join('\n\n')

  // LinkedIn : qui recrute et pourquoi (texte de la direction), le projet, puis le texte complet de l'offre publiée (son accroche
  // remplace celle de l'IA), sans autre limite que celle de LinkedIn ; une offre trop longue est raccourcie section par
  // section (fitDescription), jamais le contexte, les liens ni les hashtags.
  const hasDescription = job.description.trim() !== ''
  // Projet rédigé par l'IA, sinon l'accroche de la description, reprise sans le libellé « Le projet » (elle s'adresse au
  // candidat : « Pilotez… ») ; dans les deux cas l'accroche n'est pas répétée dans le corps.
  const { lead, rest } = splitLead(job.description)
  const project = copy.context ? `🧭 Le projet : ${copy.context}` : lead && `🧭 ${lead}`
  // Texte de la direction (David, 2026-11-17), chacun son paragraphe : offre de la plateforme, présentation de Wise
  // (réglage de /admin/social) et sa phrase de recrutement ; organisation cliente, sur le même modèle (ADR 0058), sa
  // présentation (marque employeur), sa phrase de recrutement et la ligne de diffusion. Puis le projet.
  const context = job.fromPlatform
    ? join(cfg.publisherIntro, recruitLine(job, copy.pole), project)
    : join(job.publisherAbout ?? '', orgRecruitLine(job), ORG_DIFFUSION_LINE, project)
  const liEnd = join([cta(urls.linkedin), rdv].filter(Boolean).join('\n'), tags.linkedin.join(' '))
  const liTop = hasDescription ? join(head, meta, context) : join(head, copy.tagline, meta, context)
  const liBody = hasDescription ? fitDescription(lead ? rest : job.description, LINKEDIN_MAX_CHARS - liTop.length - liEnd.length - 4) : join(program, profile)
  const linkedin = clip(join(liTop, liBody, liEnd), LINKEDIN_MAX_CHARS)
  const facebook = clip(join(head, copy.tagline, meta, program, [cta(urls.facebook), rdv].filter(Boolean).join('\n'), tags.facebook.join(' ')), 2900)
  // Instagram : les liens des légendes ne sont pas cliquables → on renvoie vers le lien de la bio.
  const instagram = clip(join(head, copy.tagline, meta, program, profile, ['👉 Postuler : lien dans la bio 🔗 mybestconsultant.fr', rdv].filter(Boolean).join('\n'), tags.instagram.join(' ')), 2100)

  // X : on retire progressivement les éléments optionnels jusqu'à tenir dans 280 caractères.
  const xLink = `👉 ${urls.x}`
  const xCal = calendly ? `\n📅 ${calendly}` : ''
  const xVariants = [
    `🚀 ${copy.hook}\n${meta}\n\n${xLink}${xCal}\n${tags.x.join(' ')}`,
    `🚀 ${copy.hook}\n${meta}\n\n${xLink}${xCal}`,
    `🚀 ${copy.hook}\n\n${xLink}${xCal}`,
    `🚀 ${copy.hook}\n\n${xLink}`,
    `🚀 ${clip(copy.hook, 200)}\n${xLink}`,
  ]
  const x = xVariants.find(v => xLength(v) <= 280) ?? xVariants[xVariants.length - 1]

  return { jobUrl: urls.linkedin.split('?')[0], calendlyUrl: calendly, hashtags: cfg.hashtags, captions: { linkedin, instagram, facebook, x }, image }
}

/**
 * État de la dernière diffusion d'une offre, en une phrase (aperçu de « Mes offres », détail de l'offre) ; le bouton qui
 * la lance ou la relance est dans la ligne de l'offre. `shared` : offre de la plateforme.
 */
export function diffusionText(
  info: { status: string; results: { network: Network; status: string }[]; stale?: boolean; sentOn?: string } | undefined,
  shared: boolean, state: 'online' | 'expired' | 'archived',
): string {
  if (shared) return 'Gérée par la plateforme'
  if (state !== 'online') return 'Hors ligne'
  if (!info) return 'Pas encore diffusée'
  const networks = info.results
    .filter(r => r.status === 'published' || r.status === 'scheduled')
    .map(r => NETWORK_LABEL[r.network])
    .join(', ')
  switch (info.status) {
    case 'published': return `${networks || 'Réseaux sociaux'} : publiée le ${info.sentOn}`
    case 'partial': return `En partie publiée le ${info.sentOn}${networks ? ` (${networks})` : ''}`
    case 'failed': return 'Échec de la dernière diffusion : relancez-la depuis la ligne de l’offre'
    default: return info.stale ? 'Envoyée, sans confirmation' : 'Publication en cours…'
  }
}
