// Profil « marque employeur » d'une entreprise (page publique /entreprises/[slug]).
// Stocké en JSON dans tenants.brandJson — pur (sans accès base) pour servir à la fois
// l'éditeur recruteur, la page publique et les actions serveur.

export const BRAND_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'] as const

export interface BrandValue { title: string; text: string }
export interface BrandBenefit { icon: string; title: string; text: string }

export interface BrandProfile {
  tagline: string
  about: string
  sector: string
  size: string
  headquarters: string
  foundedYear: string
  website: string
  linkedin: string
  coverUrl: string
  videoUrl: string
  values: BrandValue[]
  benefits: BrandBenefit[]
  gallery: string[]
}

export const EMPTY_BRAND: BrandProfile = {
  tagline: '', about: '', sector: '', size: '', headquarters: '', foundedYear: '', website: '', linkedin: '',
  coverUrl: '', videoUrl: '', values: [], benefits: [], gallery: [],
}

export const LIMITS = {
  tagline: 140, about: 2500, sector: 80, headquarters: 100,
  valueTitle: 60, valueText: 300, maxValues: 6,
  benefitTitle: 60, benefitText: 160, maxBenefits: 12,
  maxGallery: 8, name: 120,
} as const

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export function cleanUrl(v: unknown): string {
  const s = clip(v, 500)
  if (!s) return ''
  try {
    const u = new URL(s)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : ''
  } catch {
    return ''
  }
}

/** Normalise n'importe quelle entrée (JSON stocké ou saisie utilisateur) en profil valide et borné. */
export function sanitizeBrand(raw: unknown): BrandProfile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const arr = (x: unknown) => (Array.isArray(x) ? x : [])
  const year = clip(r.foundedYear, 4)
  return {
    tagline: clip(r.tagline, LIMITS.tagline),
    about: clip(r.about, LIMITS.about),
    sector: clip(r.sector, LIMITS.sector),
    size: (BRAND_SIZES as readonly string[]).includes(clip(r.size, 10)) ? clip(r.size, 10) : '',
    headquarters: clip(r.headquarters, LIMITS.headquarters),
    foundedYear: /^\d{4}$/.test(year) ? year : '',
    website: cleanUrl(r.website),
    linkedin: cleanUrl(r.linkedin),
    coverUrl: cleanUrl(r.coverUrl),
    videoUrl: videoEmbedUrl(clip(r.videoUrl, 300)) ? clip(r.videoUrl, 300) : '',
    values: arr(r.values).slice(0, LIMITS.maxValues).map(v => ({
      title: clip((v as BrandValue)?.title, LIMITS.valueTitle),
      text: clip((v as BrandValue)?.text, LIMITS.valueText),
    })).filter(v => v.title),
    benefits: arr(r.benefits).slice(0, LIMITS.maxBenefits).map(b => ({
      icon: clip((b as BrandBenefit)?.icon, 20) || 'gift',
      title: clip((b as BrandBenefit)?.title, LIMITS.benefitTitle),
      text: clip((b as BrandBenefit)?.text, LIMITS.benefitText),
    })).filter(b => b.title),
    gallery: arr(r.gallery).map(cleanUrl).filter(Boolean).slice(0, LIMITS.maxGallery),
  }
}

export function parseBrand(json: string | null | undefined): BrandProfile {
  if (!json) return { ...EMPTY_BRAND }
  try { return sanitizeBrand(JSON.parse(json)) } catch { return { ...EMPTY_BRAND } }
}

/** URL d'intégration YouTube / Vimeo (seuls hébergeurs acceptés), ou null si l'URL n'est pas reconnue. */
export function videoEmbedUrl(url: string): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1)
      return /^[\w-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id = u.searchParams.get('v') ?? (u.pathname.startsWith('/embed/') ? u.pathname.slice(7) : '')
      return /^[\w-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null
    }
    if (host === 'vimeo.com') {
      const id = u.pathname.split('/').filter(Boolean)[0]
      return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null
    }
  } catch { /* URL invalide */ }
  return null
}

/** Taux de complétion (%) et éléments manquants — pousse à publier une page complète, pas un squelette. */
export function brandCompleteness(b: BrandProfile, extra: { logoUrl?: string }): { pct: number; missing: string[] } {
  const checks: [boolean, string][] = [
    [!!extra.logoUrl, 'un logo'],
    [!!b.coverUrl, 'une image de couverture'],
    [b.tagline.length >= 10, 'une accroche'],
    [b.about.length >= 150, 'une présentation détaillée'],
    [!!b.sector && !!b.size && !!b.headquarters, 'les informations clés (secteur, taille, siège)'],
    [b.values.length >= 3, 'au moins 3 valeurs'],
    [b.benefits.length >= 4, 'au moins 4 avantages'],
    [b.gallery.length >= 2 || !!b.videoUrl, 'des photos ou une vidéo'],
  ]
  const done = checks.filter(([ok]) => ok).length
  return { pct: Math.round((done / checks.length) * 100), missing: checks.filter(([ok]) => !ok).map(([, l]) => l) }
}

/** Minimum de caractères de la présentation pour rendre la page publique. */
export const PUBLISH_MIN_ABOUT = 30

/** Message expliquant ce qui empêche la publication, ou null si la page peut être publiée. */
export function canPublish(b: BrandProfile): string | null {
  const missing = PUBLISH_MIN_ABOUT - b.about.length
  if (missing > 0) return `Pour publier, complétez la présentation (« À propos ») : il manque ${missing} caractère${missing > 1 ? 's' : ''} sur ${PUBLISH_MIN_ABOUT} minimum.`
  return null
}

export const SIZE_LABEL: Record<string, string> = {
  '1-10': '1 à 10 collaborateurs', '11-50': '11 à 50 collaborateurs', '51-200': '51 à 200 collaborateurs',
  '201-500': '201 à 500 collaborateurs', '501-1000': '501 à 1 000 collaborateurs', '1000+': 'Plus de 1 000 collaborateurs',
}
