'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/appwrite/auth'
import {
  addInternalNote, createTicket, supportReply, updateTicketMeta, uploadSupportFile, userReply, userResolve, type Actor,
} from '@/lib/support'
import type { Attachment, Ticket, TicketMessage } from '@/lib/support-shared'

type Result = { ticket?: Ticket; messages?: TicketMessage[]; error?: string }

// Côté utilisateur : recruteurs et candidats (chacun ne voit que ses propres tickets — vérifié dans lib/support).
async function userActor(): Promise<Actor> {
  const u = await getCurrentUser()
  if (!u || (u.role !== 'recruiter' && u.role !== 'candidate' && u.role !== 'hunter')) throw new Error('Non autorisé')
  return { userId: u.userId, name: `${u.firstName} ${u.lastName}`.trim() || u.email, email: u.email, role: u.role, tenantId: u.tenantId }
}

// Côté support : administrateurs uniquement.
async function adminActor(): Promise<Actor> {
  const u = await getCurrentUser()
  if (!u || u.role !== 'admin') throw new Error('Non autorisé')
  return { userId: u.userId, name: `${u.firstName} ${u.lastName}`.trim() || u.email, email: u.email, role: 'admin' }
}

// Envoi de pièce jointe : utilisateurs (recruteur/candidat) comme support ; le fichier est rattaché à son auteur.
async function anyActor(): Promise<Actor> {
  const u = await getCurrentUser()
  if (!u || !['recruiter', 'candidate', 'hunter', 'admin'].includes(u.role)) throw new Error('Non autorisé')
  return { userId: u.userId, name: `${u.firstName} ${u.lastName}`.trim() || u.email, email: u.email, role: u.role, tenantId: u.tenantId }
}

export async function uploadSupportFileAction(formData: FormData): Promise<{ attachment?: Attachment; error?: string }> {
  try {
    const file = formData.get('file')
    if (!(file instanceof File)) return { error: 'Aucun fichier reçu.' }
    return await uploadSupportFile(await anyActor(), file)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

const guard = async (fn: () => Promise<Result>): Promise<Result> => {
  try { return await fn() } catch (e) { return { error: e instanceof Error ? e.message : 'Erreur' } }
}

export async function createTicketAction(input: { subject: string; category: string; priority: string; body: string; pageUrl?: string; attachmentIds?: string[] }): Promise<Result> {
  return guard(async () => {
    const res = await createTicket(await userActor(), input)
    if (res.ticket) { revalidatePath('/recruiter/support'); revalidatePath('/candidate/support'); revalidatePath('/admin/support') }
    return res
  })
}

export async function replyTicketAction(ticketId: string, body: string, attachmentIds?: string[]): Promise<Result> {
  return guard(async () => userReply(ticketId, await userActor(), body, attachmentIds))
}

export async function resolveTicketAction(ticketId: string): Promise<Result> {
  return guard(async () => userResolve(ticketId, await userActor()))
}

export async function supportReplyAction(ticketId: string, body: string, setStatus?: string, attachmentIds?: string[]): Promise<Result> {
  return guard(async () => { const r = await supportReply(ticketId, await adminActor(), body, setStatus, attachmentIds); revalidatePath('/admin/support'); return r })
}

export async function supportNoteAction(ticketId: string, body: string, attachmentIds?: string[]): Promise<Result> {
  return guard(async () => addInternalNote(ticketId, await adminActor(), body, attachmentIds))
}

export async function supportUpdateAction(ticketId: string, patch: { status?: string; priority?: string; category?: string; assignee?: string }): Promise<Result> {
  return guard(async () => { const r = await updateTicketMeta(ticketId, await adminActor(), patch); revalidatePath('/admin/support'); return r })
}
