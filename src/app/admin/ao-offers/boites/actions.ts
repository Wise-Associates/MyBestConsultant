'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/appwrite/auth'
import { parseMailboxInput } from '@/lib/ao/mailbox-input'
import { deleteMailbox, saveMailbox, setMailboxEnabled, testMailbox, type MailboxTest, type MailboxView } from '@/lib/ao/mailboxes'
import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'

// Boîtes de réception de la plateforme (ao@wise-associates.fr et toute autre adresse) : réservées à l'admin. Les
// boîtes des organisations se gèrent dans leur espace (/recruiter/parametres/boites-ao), pas ici.

const PATH = '/admin/ao-offers/boites'
const DocumentId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/)
const idOrNull = (id: unknown) => (id === null ? null : DocumentId.safeParse(id).success ? (id as string) : undefined)

function failure(err: unknown, action: string): string {
  console.error(`AO: ${action} impossible`, err instanceof Error ? err.message : String(err))
  return `${action} impossible : ${err instanceof Error ? err.message : String(err)}`
}

export async function testPlatformMailboxAction(raw: unknown, id: unknown): Promise<MailboxTest> {
  await requireAdmin()
  try {
    const input = parseMailboxInput(raw)
    const mailboxId = idOrNull(id)
    if (!input.success) return { ok: false, error: input.error }
    if (mailboxId === undefined) return { ok: false, error: 'Boîte introuvable : rechargez la page.' }
    return await testMailbox(PLATFORM_TENANT_ID, input.data, mailboxId)
  } catch (err) {
    return { ok: false, error: failure(err, 'Test de connexion') }
  }
}

export async function savePlatformMailboxAction(raw: unknown, id: unknown): Promise<{ mailbox?: MailboxView; error?: string }> {
  await requireAdmin()
  try {
    const input = parseMailboxInput(raw)
    const mailboxId = idOrNull(id)
    if (!input.success) return { error: input.error }
    if (mailboxId === undefined) return { error: 'Boîte introuvable : rechargez la page.' }
    const res = await saveMailbox(PLATFORM_TENANT_ID, input.data, mailboxId)
    if (res.mailbox) revalidatePath(PATH)
    return res
  } catch (err) {
    return { error: failure(err, 'Enregistrement') }
  }
}

export async function setPlatformMailboxEnabledAction(id: unknown, enabled: unknown): Promise<{ mailbox?: MailboxView; error?: string }> {
  await requireAdmin()
  try {
    const parsed = z.object({ id: DocumentId, enabled: z.boolean() }).safeParse({ id, enabled })
    if (!parsed.success) return { error: 'Boîte introuvable : rechargez la page.' }
    const res = await setMailboxEnabled(PLATFORM_TENANT_ID, parsed.data.id, parsed.data.enabled)
    if (res.mailbox) revalidatePath(PATH)
    return res
  } catch (err) {
    return { error: failure(err, 'Modification') }
  }
}

export async function deletePlatformMailboxAction(id: unknown): Promise<{ error?: string }> {
  await requireAdmin()
  try {
    const parsed = DocumentId.safeParse(id)
    if (!parsed.success) return { error: 'Boîte introuvable : rechargez la page.' }
    const res = await deleteMailbox(PLATFORM_TENANT_ID, parsed.data)
    if (!res.error) revalidatePath(PATH)
    return res
  } catch (err) {
    return { error: failure(err, 'Suppression') }
  }
}
