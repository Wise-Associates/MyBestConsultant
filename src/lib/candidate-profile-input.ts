import { z } from 'zod'
import { normalizeWhatsApp } from './whatsapp'

// Limites = tailles des attributs de la collection `users` (appwrite.config.json). Un dépassement était refusé par
// Appwrite avec un message anglais affiché sous le champ WhatsApp : le candidat croyait que son numéro était refusé
// (retour d'un utilisateur du 2026-11-14 : « le champ WhatsApp ne se valide jamais »).
export const PROFILE_LIMITS = {
  phone: 30,
  city: 100,
  desiredSector: 100,
  desiredRoles: 500,
  photoUrl: 500,
  linkedinUrl: 300,
  cvProfileJson: 20000,
  mobilityRadiusKm: 10000,
} as const

export type ProfileField =
  | 'whatsapp' | 'phone' | 'city' | 'mobilityRadiusKm' | 'desiredSector' | 'desiredRoles'
  | 'photoUrl' | 'linkedinUrl' | 'skills' | 'experienceSummary' | 'openToWork'

const text = (max: number, message: string) => z.string().trim().max(max, message)
const joinedList = (max: number, message: string) =>
  z.array(z.string().trim().min(1)).refine(list => list.join(', ').length <= max, message)

const ProfileInputSchema = z.object({
  phone: text(PROFILE_LIMITS.phone, `Le téléphone ne doit pas dépasser ${PROFILE_LIMITS.phone} caractères.`),
  whatsapp: z.string().optional(),
  city: text(PROFILE_LIMITS.city, `La ville ne doit pas dépasser ${PROFILE_LIMITS.city} caractères.`),
  mobilityRadiusKm: z.number().int().min(0).max(PROFILE_LIMITS.mobilityRadiusKm,
    `Le rayon de mobilité ne doit pas dépasser ${PROFILE_LIMITS.mobilityRadiusKm} km.`).nullable(),
  skills: z.array(z.string()),
  experienceSummary: z.string(),
  openToWork: z.boolean(),
  desiredSector: joinedList(PROFILE_LIMITS.desiredSector,
    'Trop de secteurs sélectionnés : retirez-en quelques-uns (100 caractères au plus en tout).'),
  desiredRoles: joinedList(PROFILE_LIMITS.desiredRoles,
    'Trop de types de missions : retirez-en quelques-uns (500 caractères au plus en tout).'),
  photoUrl: text(PROFILE_LIMITS.photoUrl, 'L’adresse de la photo est trop longue : choisissez une autre photo.'),
  linkedinUrl: text(PROFILE_LIMITS.linkedinUrl, `L’URL LinkedIn ne doit pas dépasser ${PROFILE_LIMITS.linkedinUrl} caractères.`),
})

export type ProfileInput = z.input<typeof ProfileInputSchema>
export type ProfileValues = Omit<z.output<typeof ProfileInputSchema>, 'whatsapp'> & { whatsapp: string }
export type ProfileInputResult =
  | { ok: true; values: ProfileValues }
  | { ok: false; field?: ProfileField; error: string }

/** Valide le profil envoyé par le navigateur ; WhatsApp normalisé au format international (vide = pas de WhatsApp). */
export function parseCandidateProfileInput(input: unknown): ProfileInputResult {
  const parsed = ProfileInputSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue?.path[0]
    return {
      ok: false,
      field: typeof field === 'string' ? (field as ProfileField) : undefined,
      error: issue?.code === 'custom' || issue?.code === 'too_big' ? issue.message : 'Profil invalide : rechargez la page puis réessayez.',
    }
  }
  const wa = normalizeWhatsApp(parsed.data.whatsapp ?? '')
  if (wa.error) return { ok: false, field: 'whatsapp', error: wa.error }
  return { ok: true, values: { ...parsed.data, whatsapp: wa.e164 ?? '' } }
}

/** Compétences et résumé sont rangés dans `cvProfileJson`, avec ce que l'analyse du CV y a déjà mis. */
export function cvProfileJsonError(json: string): string | null {
  return json.length > PROFILE_LIMITS.cvProfileJson
    ? 'Votre profil est trop long pour être enregistré : raccourcissez le résumé de votre expérience ou retirez des compétences.'
    : null
}
