import { z } from 'zod'

// Formulaire d'une boîte de réception AO (organisation ou plateforme) : validé côté serveur, n'importe quelle adresse
// (recrutement@…, jobs@…, ao@…). Le nom du serveur est vérifié à la connexion (imap-host.ts).

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const MAX_OWN_DOMAINS = 10

const Schema = z.object({
  label: z.string().trim().max(200).optional(),
  host: z.string().trim().toLowerCase().min(3, 'Indiquez le serveur IMAP (par exemple imap.ionos.fr).').max(253, 'Nom de serveur trop long.'),
  username: z.string().trim().min(3, 'Indiquez l\'identifiant de la boîte (souvent son adresse e-mail).').max(320, 'Identifiant trop long.'),
  password: z.string().max(500, 'Mot de passe trop long.').default(''),
  mailbox: z.string().trim().max(200, 'Nom de dossier trop long.').transform(v => v || 'INBOX'),
  // Saisis séparés par des virgules ; vide : le domaine de l'adresse de la boîte.
  ownDomains: z.string().max(2000).default(''),
})

export interface MailboxInput {
  label: string
  host: string
  username: string
  /** '' : inchangé (modification sans changer de serveur ni d'identifiant). */
  password: string
  mailbox: string
  ownDomains: string[]
}

/** Saisie du formulaire → valeurs normalisées, ou le premier message d'erreur à afficher. */
export function parseMailboxInput(raw: unknown): { success: true; data: MailboxInput } | { success: false; error: string } {
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Saisie invalide.' }
  const { label, host, username, password, mailbox, ownDomains } = parsed.data
  const domains = [...new Set(ownDomains.split(/[,\s;]+/).map(d => d.trim().toLowerCase()).filter(Boolean))]
  const fallback = username.includes('@') ? [username.split('@').pop()!.toLowerCase()] : []
  const list = domains.length ? domains : fallback
  const invalid = list.find(d => !DOMAIN.test(d))
  if (invalid) return { success: false, error: `Domaine invalide : « ${invalid} » (attendu : acme.fr).` }
  if (list.length > MAX_OWN_DOMAINS) return { success: false, error: `${MAX_OWN_DOMAINS} domaines au plus.` }
  return { success: true, data: { label: label || username, host, username, password, mailbox, ownDomains: list } }
}

/**
 * Le mot de passe est obligatoire à la création, et dès que le serveur ou l'identifiant changent : le mot de passe
 * enregistré ne peut pas être envoyé à un autre serveur sans être ressaisi (il est lié à son serveur et son identifiant).
 * null : rien à redire.
 */
export function passwordProblem(
  existing: { host: string; username: string } | null,
  input: { host: string; username: string; password: string },
): string | null {
  if (input.password) return null
  if (!existing) return 'Indiquez le mot de passe de la boîte.'
  if (existing.host !== input.host || existing.username !== input.username) return 'Serveur ou identifiant modifié : ressaisissez le mot de passe.'
  return null
}
