import { z } from 'zod'
import { SOCIAL_CONTEXT_MAX, type SocialEdits } from '@/lib/social-content'

// Version à publier envoyée par le navigateur (formulaire de relecture du panneau d'une offre AO) : donnée non fiable,
// validée avant toute écriture par publishAoOfferOf (offer-actions.ts). Règles pures, testées dans ao.test.ts et
// publication-social.test.ts ; lues aussi dans le navigateur par l'aperçu du post LinkedIn (parseDraftFields).

/** Champs de l'offre publique ; la publication y ajoute la validation de la relecture (PublishSchema). */
const DraftFieldsSchema = z.object({
  title: z.string().trim().min(2).max(200),
  companyName: z.string().trim().min(2).max(200),
  description: z.string().trim().min(20).max(20_000),
  location: z.string().trim().max(200),
  contractType: z.enum(['cdi', 'cdd', 'freelance', 'mission']),
  remote: z.enum(['onsite', 'hybrid', 'remote']),
  salary: z.number().int().positive().max(999_999).nullable(),
  skills: z.array(z.string().trim().min(1).max(60)).max(10),
})

/**
 * Textes du post LinkedIn relus avec la version (ADR 0058) : « Le projet », pôle et hashtags, seuls textes rédigés dont
 * dépend le post LinkedIn d'une offre avec description. Bornés de nouveau par normalizeCopy à la diffusion, qui ne
 * garde qu'un pôle de la liste de Wise Associates.
 */
const SocialEditsSchema = z.object({
  context: z.string().trim().max(SOCIAL_CONTEXT_MAX),
  pole: z.string().max(80),
  hashtags: z.array(z.string().max(60)).max(10),
})

/**
 * `reviewed` : la personne qui publie a relu et validé la version (case « J'ai relu », ADR 0013).
 * `maskTerms` : noms que l'IA dit avoir retirés ; envoyés par le navigateur, ils ne peuvent que masquer davantage.
 * `anonymized` : false seulement pour « Publier sans anonymiser » ; absent, la publication est anonymisée.
 * `social` : textes du post LinkedIn relus ; absents, la diffusion les fait rédiger par l'IA.
 */
const PublishSchema = DraftFieldsSchema.extend({
  reviewed: z.literal(true),
  maskTerms: z.array(z.string().trim().max(80)).max(30),
  anonymized: z.boolean().default(true),
  social: SocialEditsSchema.optional(),
})

export type PublicationFields = z.infer<typeof DraftFieldsSchema>

export type PublishInput =
  | { fields: PublicationFields; maskTerms: string[]; anonymized: boolean; social?: SocialEdits; error?: undefined }
  | { error: string }

/** Version validée (champs de l'offre publique à part), ou le message à afficher. */
export function parsePublishInput(input: unknown): PublishInput {
  const parsed = PublishSchema.safeParse(input)
  if (!parsed.success) {
    if (parsed.error.issues.some(issue => issue.path[0] === 'reviewed')) return { error: 'Relisez la version publiée, puis cochez « J\'ai relu » pour la valider.' }
    if (parsed.error.issues.some(issue => issue.path[0] === 'social')) return { error: `Post LinkedIn invalide : « Le projet » fait ${SOCIAL_CONTEXT_MAX} caractères au plus.` }
    return { error: 'Champs invalides : vérifiez le titre, l\'entreprise affichée, la description (20 caractères minimum) et le montant.' }
  }
  // Sans `reviewed`, `maskTerms`, `anonymized` ni `social`, qui ne font pas partie de l'offre publique.
  return { fields: DraftFieldsSchema.parse(parsed.data), maskTerms: parsed.data.maskTerms, anonymized: parsed.data.anonymized, social: parsed.data.social }
}

/** Champs de l'offre publique tels que le serveur les validera (espaces retirés), ou null s'il les refuserait. */
export function parseDraftFields(input: unknown): PublicationFields | null {
  const parsed = DraftFieldsSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
