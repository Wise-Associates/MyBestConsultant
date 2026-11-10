import { z } from 'zod'

// Rapport d'un passage du scanner veille-marches-emplois, source par source (ADR 0030) : reçu par POST
// /api/veille/runs, gardé dans veille_runs, affiché dans /admin/candidats/statistiques. Même format que
// src/run/source-report.ts du scanner (`schemaVersion`) : toute évolution dans les deux projets. Seulement des nombres,
// des libellés de sources et des messages d'erreur ou d'alerte (au plus l'intitulé public d'une offre que le serveur
// d'envoi a refusée), jamais le texte d'une annonce ni un contact. Règles pures, testées dans monitoring.test.ts.

export const RUN_REPORT_VERSION = 1

/**
 * Identifiant d'une source de la veille : clé des réglages (`boamp`, `csp-dgfip`…) ou recherche chez tous les acheteurs
 * (`boamp-tous-acheteurs`). Même règle que l'en-tête X-Wise-Veille-Source écrit par le scanner.
 */
export const VEILLE_SOURCE_ID = /^[a-z0-9-]{1,50}$/

/**
 * Source d'une offre de la veille, lue dans l'en-tête X-Wise-Veille-Source ; '' si l'en-tête manque ou n'a pas la forme
 * d'un identifiant (n'importe qui peut écrire un en-tête : il n'est lu que pour un e-mail reconnu par fromVeille).
 */
export function veilleSourceOf(header: unknown): string {
  const value = typeof header === 'string' ? header.trim() : ''
  return VEILLE_SOURCE_ID.test(value) ? value : ''
}

/** Taille maximale d'un rapport reçu (octets) : une vingtaine de sources en font quelques kilo-octets. */
export const MAX_RUN_REPORT_BYTES = 100_000

const Count = z.number().int().min(0).max(1_000_000)
const Message = z.string().max(300)

const SourceRun = z.object({
  id: z.string().regex(VEILLE_SOURCE_ID),
  label: z.string().min(1).max(300),
  kind: z.enum(['tender', 'job']),
  ok: z.boolean(),
  error: Message.nullable(),
  listed: Count,
  outOfScope: Count,
  new: Count,
  sent: Count,
  outdated: Count,
  pending: Count,
  warnings: z.array(Message).max(20),
})

export const RunReportSchema = z.object({
  schemaVersion: z.literal(RUN_REPORT_VERSION),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  settings: z.object({ origin: z.enum(['remote', 'snapshot', 'defaults']), version: z.number().int().positive().nullable() }),
  deliveryError: Message.nullable(),
  sources: z.array(SourceRun).max(300),
  otherWarnings: z.array(z.object({ label: Message, message: Message })).max(50),
})

export type RunReport = z.infer<typeof RunReportSchema>
export type SourceRunReport = RunReport['sources'][number]

/**
 * Un rapport reçu décrit un passage qui vient de finir : commencé dans les 2 derniers jours, fini après son début et pas
 * dans le futur (10 minutes de décalage d'horloge tolérées). Sans cette borne, un rapport daté de 2099 passerait pour le
 * dernier passage pour toujours, et 120 d'entre eux feraient supprimer chaque vrai rapport dès son enregistrement.
 */
export const MAX_RUN_AGE_MS = 2 * 86_400_000
export const MAX_CLOCK_SKEW_MS = 10 * 60_000

/**
 * Valide un rapport ; erreur courte (chemin et règle, jamais la valeur reçue). `now` : rapport reçu par la route, dont
 * les dates sont aussi bornées ; sans lui (rapport déjà enregistré, relu), seul le format est vérifié.
 */
export function parseRunReport(input: unknown, now?: Date): { success: true; report: RunReport } | { success: false; error: string } {
  const parsed = RunReportSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { success: false, error: `${issue?.path.join('.') || '(racine)'} : ${issue?.message ?? 'format inattendu'}` }
  }
  if (now) {
    const started = Date.parse(parsed.data.startedAt)
    const finished = Date.parse(parsed.data.finishedAt)
    const latest = now.getTime() + MAX_CLOCK_SKEW_MS
    if (started < now.getTime() - MAX_RUN_AGE_MS || started > latest) return { success: false, error: 'startedAt : passage hors des 2 derniers jours' }
    if (finished < started || finished > latest) return { success: false, error: 'finishedAt : avant le début du passage ou dans le futur' }
  }
  return { success: true, report: parsed.data }
}

/**
 * Identifiant du document d'un passage, tiré de l'instant de son début (« 2026-11-10T09:00:00.000Z » →
 * « run_20261110090000000 ») : un rapport renvoyé (nouvelle tentative du scanner) retombe sur le même document, quelle
 * que soit l'écriture de la date (« …09:00:00Z » ou « …09:00:00.000Z »).
 */
export function runDocumentId(startedAt: string): string {
  return `run_${new Date(startedAt).toISOString().replace(/\D/g, '')}`
}
