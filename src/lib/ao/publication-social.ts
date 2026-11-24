import { buildContent, fallbackCopy, jobLiteOf, normalizeCopy, type SocialConfig, type SocialEdits } from '@/lib/social-content'
import { publicLabel, rawPublicOffer, rawPublicSocial, toPublicOffer, toPublicSocial } from './anonymize'
import { maskNames } from './publication-copy'
import { parseDraftFields, type PublicationFields } from './publication-input'
import type { PublicationDraft } from './dashboard-types'

// Post LinkedIn d'un AO relu avant sa publication (ADR 0058). Le post est construit dans le navigateur, à chaque
// modification de la version à publier, par le même code que la publication (publicVersion) et la diffusion
// (jobLiteOf, normalizeCopy, buildContent) : ce que la personne relit est ce qui part. Pur, utilisable dans le
// navigateur ; testé dans publication-social.test.ts.

/** Identifiant fixe de l'offre publique d'un AO : une double publication échoue au lieu d'en créer une seconde. */
export const publicJobIdOf = (offerId: string) => `ao${offerId}`

/** Compétences saisies (séparées par des virgules) : 10 au plus, comme l'offre publique. */
export const splitSkills = (text: string) => text.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10)

/** Refus du quota des textes du post (recruteurs) : phrase de « Textes du post préparés sans IA (…) ». */
export const SOCIAL_AI_QUOTA_MESSAGE = {
  organisation: (limit: number) => `limite de ${limit} rédactions de posts par l'IA par jour atteinte pour votre organisation`,
  platform: 'trop de rédactions de posts par l\'IA aujourd\'hui sur la plateforme',
} as const

/** Ce qui sert à fabriquer la version publiée : anonymisée ou non, noms du client à masquer, noms retirés par l'IA. */
export interface VersionMode {
  anonymized: boolean
  /** Noms du client et des expéditeurs (hiddenNamesFor, offer-actions.ts), tels que les règles les cherchent. */
  names: string[][]
  maskTerms: string[]
}

/**
 * Version publiée d'un AO, à partir de la version validée : champs de l'offre publique et textes du post, nettoyés par
 * les règles d'anonymisation (filet de sécurité : la version a pu être modifiée à la relecture), ou seulement sans
 * coordonnées personnelles pour une publication non anonymisée. Seule fonction utilisée par la publication
 * (publishAoOfferOf) et par l'aperçu du post.
 */
export function publicVersion(fields: PublicationFields, mode: VersionMode, social?: SocialEdits): { job: PublicationFields; social?: SocialEdits } {
  const edited = { ...fields, duration: '', startDate: '', experience: '' }
  if (!mode.anonymized) return { job: { ...fields, ...rawPublicOffer(edited) }, social: social && rawPublicSocial(social) }
  const extra = maskNames(mode.maskTerms)
  // Le client reste masqué sur le site, même si son nom (ou celui de l'expéditeur) ou des coordonnées ont été saisis
  // comme libellé.
  const label = publicLabel(fields.companyName, [...mode.names, ...extra])
  return {
    job: { ...fields, ...toPublicOffer(edited, mode.names, label, extra) },
    social: social && toPublicSocial(social, mode.names, label, extra),
  }
}

/** Champs de l'offre publique créée par la publication d'un AO (publishAoOfferOf), lus aussi par l'aperçu du post. */
export function publicJobFields(job: PublicationFields) {
  return {
    title: job.title,
    description: job.description,
    skills: job.skills.slice(0, 10),
    location: job.location || 'Non spécifié',
    contractType: job.contractType,
    remote: job.remote,
    salary: job.salary ?? undefined,
    companyName: job.companyName || undefined,
  }
}

/** Ce que la diffusion connaîtra de l'offre et des réglages, fourni par le serveur avec la version à relire. */
export interface LinkedInPreviewSettings {
  /** Réglages de diffusion (présentation de Wise Associates, hashtags, Calendly). Aucun secret. */
  config: SocialConfig
  /** Adresse du site et Calendly tels que les écrira la diffusion. */
  baseUrl: string
  calendlyUrl: string
  /** Offre publique qui sera créée (publicJobIdOf) : son lien est dans le post. */
  jobId: string
  /** Organisation de l'offre (tenantForSocial, social.ts) ; vide : l'entreprise affichée de la version. */
  tenantName: string
  /** Présentation de l'organisation, tirée de sa marque employeur (offre d'une organisation cliente). */
  publisherAbout: string
  /** Offre publiée au nom de Wise Associates (présentation et phrase de recrutement de la direction). */
  fromPlatform: boolean
}

/**
 * Post LinkedIn montré à la relecture ; `settings` absent : la publication n'en fera partir aucun (raison dans `off`).
 * `notice` : pourquoi « Le projet », le pôle et les hashtags ont été préparés sans IA ; vide sinon.
 */
export interface SocialPreview {
  settings: LinkedInPreviewSettings | null
  off: string
  notice: string
}

/** Offre publiée telle que la lit la diffusion (jobToLite, social.ts), avec l'organisation des réglages. */
export function liteOfPublished(job: PublicationFields, settings: LinkedInPreviewSettings) {
  const fields = publicJobFields(job)
  return jobLiteOf({ ...fields, id: settings.jobId }, settings.tenantName || fields.companyName || '', settings.fromPlatform, settings.publisherAbout)
}

/**
 * Post LinkedIn de la version relue : la version publiée (publicVersion, mêmes règles que la publication), lue comme la
 * diffusion la lira, avec les textes relus. Les autres textes de l'IA (affiche, autres réseaux) n'entrent pas dans le
 * post d'une offre avec description : le repli sans IA en tient lieu. null : version que le serveur refuserait (titre,
 * description trop courte…), sans post à montrer.
 */
export function linkedInPostOf(
  draft: Omit<PublicationDraft, 'skills' | 'reviewed'>, skillsText: string, settings: LinkedInPreviewSettings, hiddenNames: string[][],
): string | null {
  const fields = parseDraftFields({ ...draft, skills: splitSkills(skillsText) })
  if (!fields || !draft.social) return null
  const version = publicVersion(fields, { anonymized: draft.anonymized, names: hiddenNames, maskTerms: draft.maskTerms }, draft.social)
  const lite = liteOfPublished(version.job, settings)
  const copy = normalizeCopy({ ...fallbackCopy(lite), ...version.social }, lite)
  return buildContent(lite, copy, settings.config, { baseUrl: settings.baseUrl, calendlyUrl: settings.calendlyUrl }).captions.linkedin
}
