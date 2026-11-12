// Trace de la lecture de l'annonce d'origine d'une offre AO (ADR 0031), enregistrée dans ao_offer_details.pageFill et
// affichée sur la page de l'offre. Sans dépendance serveur : lue aussi par la page (composant client). Testée dans
// rules.test.ts.

import { z } from 'zod'

/** Champs qu'une annonce peut compléter. */
export const PAGE_FIELDS = ['description', 'location', 'skills', 'technologies', 'experience', 'duration', 'startDate', 'deadline', 'salary', 'engagement', 'endClient'] as const
export type PageField = (typeof PAGE_FIELDS)[number]

/** Libellés de la page de l'offre (« Complété depuis l'annonce d'origine : lieu, compétences »). */
export const PAGE_FIELD_LABEL: Record<PageField, string> = {
  description: 'description', location: 'lieu', skills: 'compétences', technologies: 'technologies', experience: 'expérience',
  duration: 'durée', startDate: 'démarrage', deadline: 'date limite', salary: 'montant', engagement: 'assistance / forfait', endClient: 'client final',
}

/**
 * filled : des champs viennent de l'annonce · unchanged : annonce lue, rien à compléter (ou autre poste) ·
 * not_read : annonce non lue (site exclu, robots.txt, quota, délai…), raison dans `reason`.
 */
export type PageFillStatus = 'filled' | 'unchanged' | 'not_read'

export const PageFillSchema = z.object({
  at: z.string().max(40),
  /** Site du lien, suivi de « → site final » quand une redirection a mené ailleurs. */
  host: z.string().max(520),
  status: z.enum(['filled', 'unchanged', 'not_read']),
  fields: z.array(z.enum(PAGE_FIELDS)).max(PAGE_FIELDS.length),
  reason: z.string().max(300),
})
export type PageFill = z.infer<typeof PageFillSchema>

/** Taille de l'attribut `pageFill` (appwrite.config.json). */
export const PAGE_FILL_MAX_CHARS = 1000

/** Site d'une adresse, sans « www. » ; '' si l'adresse est illisible (la raison de la trace le dit alors). */
function hostOf(url: string): string {
  return URL.canParse(url) ? new URL(url).hostname.replace(/^www\./, '').slice(0, 253) : ''
}

/** Trace d'une lecture, raison bornée pour tenir dans l'attribut. `finalUrl` : page lue après redirections. */
export function pageFillOf(input: { at: Date; url: string; finalUrl?: string; status: PageFillStatus; fields?: PageField[]; reason?: string }): PageFill {
  const host = hostOf(input.url)
  const final = input.finalUrl ? hostOf(input.finalUrl) : ''
  return {
    at: input.at.toISOString(),
    host: final && final !== host ? `${host} → ${final}` : host,
    status: input.status,
    fields: input.fields ?? [],
    reason: (input.reason ?? '').slice(0, 300),
  }
}

/**
 * Trace sérialisée pour l'attribut : jamais coupée au milieu du JSON (illisible ensuite). Trop longue (raison venue d'un
 * en-tête du site, caractères échappés), la raison puis le site sont raccourcis ; statut et champs restent entiers.
 */
export function pageFillJson(fill: PageFill): string {
  for (const candidate of [fill, { ...fill, reason: fill.reason.slice(0, 80) }, { ...fill, reason: '', host: fill.host.slice(0, 100) }]) {
    const json = JSON.stringify(candidate)
    if (json.length <= PAGE_FILL_MAX_CHARS) return json
  }
  return JSON.stringify({ ...fill, reason: '', host: '' })
}

/** Trace enregistrée (JSON) ; null si absente ou illisible. */
export function parsePageFill(raw: unknown): PageFill | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const parsed = PageFillSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Phrase de la page de l'offre. */
export function pageFillText(fill: PageFill): string {
  const site = fill.host ? ` (${fill.host})` : ''
  if (fill.status === 'filled') return `Complété depuis l’annonce d’origine${site} : ${fill.fields.map(f => PAGE_FIELD_LABEL[f]).join(', ')}. À vérifier sur l’annonce avant de publier.`
  if (fill.status === 'unchanged') return `Annonce d’origine lue${site} : ${fill.reason || 'rien à compléter'}.`
  return `Annonce d’origine non lue${site} : ${fill.reason || 'raison inconnue'}.`
}
