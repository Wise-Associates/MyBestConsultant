'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { parseMailboxInput } from '@/lib/ao/mailbox-input'
import { deleteMailbox, saveMailbox, setMailboxEnabled, testMailbox, type MailboxTest, type MailboxView } from '@/lib/ao/mailboxes'

// Boîtes de réception AO d'une organisation : tous ses recruteurs les gèrent (décision du 2026-10-27 ; avant : son
// propriétaire seul), sur LEUR organisation (celle de la session, jamais un identifiant reçu du navigateur). Les
// membres d'une organisation n'y entrent que sur invitation (team.ts). Le mot de passe d'une boîte n'est jamais
// renvoyé, et changer son serveur ou son identifiant oblige à le ressaisir : un membre ne peut pas le récupérer.

const PATH = '/recruiter/parametres/boites-ao/boites'
const DocumentId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/)

class Refused extends Error {}

/** Organisation du recruteur ; `verified` : adresse e-mail vérifiée exigée (test et enregistrement d'une boîte). */
async function requireRecruiter({ verified = false } = {}): Promise<string> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) throw new Refused('Non autorisé.')
  // Un compte jetable (inscription libre) ne doit pas pouvoir se servir du test de connexion contre des boîtes de tiers.
  if (verified && !user.emailVerification) throw new Refused('Vérifiez d’abord votre adresse e-mail (lien reçu à l’inscription) pour configurer une boîte.')
  return user.tenantId
}

/** Message pour l'utilisateur ; une erreur inattendue (base, réseau) est journalisée et décrite sans détail interne. */
function failure(err: unknown, action: string): string {
  if (err instanceof Refused) return err.message
  console.error(`AO: ${action} impossible`, err instanceof Error ? err.message : String(err))
  return `${action} impossible pour le moment : réessayez dans un instant.`
}

const idOrNull = (id: unknown) => (id === null ? null : DocumentId.safeParse(id).success ? (id as string) : undefined)

export async function testMailboxAction(raw: unknown, id: unknown): Promise<MailboxTest> {
  try {
    const tenantId = await requireRecruiter({ verified: true })
    const input = parseMailboxInput(raw)
    const mailboxId = idOrNull(id)
    if (!input.success) return { ok: false, error: input.error }
    if (mailboxId === undefined) return { ok: false, error: 'Boîte introuvable : rechargez la page.' }
    return await testMailbox(tenantId, input.data, mailboxId)
  } catch (err) {
    return { ok: false, error: failure(err, 'Test de connexion') }
  }
}

export async function saveMailboxAction(raw: unknown, id: unknown): Promise<{ mailbox?: MailboxView; error?: string }> {
  try {
    const tenantId = await requireRecruiter({ verified: true })
    const input = parseMailboxInput(raw)
    const mailboxId = idOrNull(id)
    if (!input.success) return { error: input.error }
    if (mailboxId === undefined) return { error: 'Boîte introuvable : rechargez la page.' }
    const res = await saveMailbox(tenantId, input.data, mailboxId)
    if (res.mailbox) revalidatePath(PATH)
    return res
  } catch (err) {
    return { error: failure(err, 'Enregistrement') }
  }
}

export async function setMailboxEnabledAction(id: unknown, enabled: unknown): Promise<{ mailbox?: MailboxView; error?: string }> {
  try {
    const tenantId = await requireRecruiter()
    const parsed = z.object({ id: DocumentId, enabled: z.boolean() }).safeParse({ id, enabled })
    if (!parsed.success) return { error: 'Boîte introuvable : rechargez la page.' }
    const res = await setMailboxEnabled(tenantId, parsed.data.id, parsed.data.enabled)
    if (res.mailbox) revalidatePath(PATH)
    return res
  } catch (err) {
    return { error: failure(err, 'Modification') }
  }
}

export async function deleteMailboxAction(id: unknown): Promise<{ error?: string }> {
  try {
    const tenantId = await requireRecruiter()
    const parsed = DocumentId.safeParse(id)
    if (!parsed.success) return { error: 'Boîte introuvable : rechargez la page.' }
    const res = await deleteMailbox(tenantId, parsed.data)
    if (!res.error) revalidatePath(PATH)
    return res
  } catch (err) {
    return { error: failure(err, 'Suppression') }
  }
}
