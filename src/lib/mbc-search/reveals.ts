import { createHash } from 'node:crypto'
import { z } from 'zod'
import { APOLLO_PERSON_ID, PLAIN_EMAIL, type MbcRevealed } from './rules'

// Profils complets déjà révélés par une organisation (collection mbc_reveals, ADR 0018) : règles pures, testées.
// Un profil payé (un crédit Apollo) est gardé MBC_REVEAL_RETENTION_DAYS jours pour toute l'organisation : il s'affiche
// de nouveau sans crédit, puis est supprimé par la purge quotidienne. Serveur seulement (node:crypto).

/** Durée de conservation d'un profil révélé (données personnelles d'un tiers : durée bornée, RGPD). */
export const MBC_REVEAL_RETENTION_DAYS = 90

/** Identifiant du document : organisation + personne Apollo (36 caractères). Deux révélations simultanées visent le même. */
export function revealDocId(tenantId: string, apolloId: string): string {
  return 'r' + createHash('sha256').update(`${tenantId}\n${apolloId}`).digest('hex').slice(0, 35)
}

/** Date avant laquelle un profil révélé est supprimé. */
export function revealCutoff(now: Date): Date {
  return new Date(now.getTime() - MBC_REVEAL_RETENTION_DAYS * 86_400_000)
}

const https = z.string().max(1000).refine(v => v === '' || /^https:\/\/[^\s"'<>]+$/.test(v))
const text = (max: number) => z.string().max(max)

/** Profil relu en base : mêmes garanties qu'à la lecture d'Apollo (liens https, adresse simple). */
const revealedSchema = z.object({
  id: z.string().regex(APOLLO_PERSON_ID),
  name: text(200),
  title: text(300),
  headline: text(500),
  company: text(300),
  companyWebsite: https,
  location: text(300),
  linkedinUrl: https,
  email: z.string().max(320).refine(v => v === '' || PLAIN_EMAIL.test(v)),
  emailStatus: text(40),
  photoUrl: https,
  experiences: z.array(z.object({ title: text(300), company: text(300), start: text(7), end: text(7), current: z.boolean() })).max(8),
})

/** Texte enregistré pour un profil : champs bornés comme à la relecture (l'attribut profileJson fait 20 000 caractères). */
export function revealJson(profile: MbcRevealed): string {
  const cut = (v: string, max: number) => v.slice(0, max)
  const p: MbcRevealed = {
    ...profile,
    name: cut(profile.name, 200), title: cut(profile.title, 300), headline: cut(profile.headline, 500),
    company: cut(profile.company, 300), location: cut(profile.location, 300), emailStatus: cut(profile.emailStatus, 40),
    experiences: profile.experiences.slice(0, 8).map(e => ({ ...e, title: cut(e.title, 300), company: cut(e.company, 300) })),
  }
  return JSON.stringify(p)
}

/** Relit le texte d'un profil enregistré (révélé ou enregistré par un recruteur) ; illisible ou d'une autre personne : null. */
export function parseRevealedJson(json: unknown, apolloId: unknown): MbcRevealed | null {
  let raw: unknown
  try { raw = JSON.parse(typeof json === 'string' ? json : '') } catch { return null }
  const p = revealedSchema.safeParse(raw)
  return p.success && p.data.id === apolloId ? p.data : null
}

/** Relit un document ; périmé ou illisible : null (le profil sera de nouveau à révéler). */
export function parseRevealDoc(doc: Record<string, unknown>, now: Date): MbcRevealed | null {
  const at = typeof doc.revealedAt === 'string' ? Date.parse(doc.revealedAt) : NaN
  if (!Number.isFinite(at) || at < revealCutoff(now).getTime()) return null
  return parseRevealedJson(doc.profileJson, doc.apolloId)
}
