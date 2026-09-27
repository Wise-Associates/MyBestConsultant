import { randomBytes } from 'crypto'
import { ID, Query, type Models } from 'node-appwrite'
import { InputFile } from 'node-appwrite/file'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { wrapEmailHtml } from '@/lib/email-template'
import {
  ATTACHMENT_EXTENSIONS, CATEGORY_META, PRIORITY_META, STATUS_META, SUPPORT_LIMITS, formatSize, isCategory, isOpenStatus, isPriority, isStatus,
  type Attachment, type Ticket, type TicketCategory, type TicketMessage, type TicketPriority, type TicketStatus,
} from '@/lib/support-shared'

// Help Desk (Module 11) — logique serveur. Chaque fonction reçoit l'acteur explicitement ; les
// contrôles d'accès (qui a le droit d'appeler quoi) sont dans lib/support-actions.ts.

export interface Actor { userId: string; name: string; email: string; role: string; tenantId?: string }

const origin = () => process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Adresse qui reçoit les notifications de l'équipe support (création de ticket, réponses des clients). */
export const supportEmail = () => (process.env.SUPPORT_EMAIL || 'contact@tdidigital.io').trim().toLowerCase()

function parseAttachments(raw: unknown): Attachment[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr)
      ? arr.filter(a => a && typeof a.id === 'string' && typeof a.name === 'string')
          .map(a => ({ id: a.id as string, name: a.name as string, size: Number(a.size) || 0, type: typeof a.type === 'string' ? a.type : '' }))
      : []
  } catch {
    return []
  }
}

function docToTicket(d: Models.Document): Ticket {
  const r = d as unknown as Record<string, unknown>
  const s = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : '')
  return {
    id: d.$id, reference: s('reference'), userId: s('userId'), userName: s('userName'), userEmail: s('userEmail'),
    role: s('role'), tenantId: s('tenantId'), subject: s('subject'),
    category: isCategory(r.category) ? r.category : 'other',
    priority: isPriority(r.priority) ? r.priority : 'normal',
    status: isStatus(r.status) ? r.status : 'open',
    assignee: s('assignee'), lastMessageAt: s('lastMessageAt') || d.$createdAt,
    lastMessageBy: r.lastMessageBy === 'support' ? 'support' : 'user',
    unreadUser: r.unreadUser === true, unreadSupport: r.unreadSupport !== false,
    pageUrl: s('pageUrl'), createdAt: d.$createdAt,
  }
}

function docToMessage(d: Models.Document): TicketMessage {
  const r = d as unknown as Record<string, string | null>
  return {
    id: d.$id, ticketId: r.ticketId ?? '', authorId: r.authorId ?? '', authorName: r.authorName ?? '',
    authorRole: r.authorRole === 'support' ? 'support' : 'user',
    kind: r.kind === 'note' || r.kind === 'event' ? r.kind : 'message',
    body: r.body ?? '', attachments: parseAttachments(r.attachments), createdAt: d.$createdAt,
  }
}

const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function makeReference(): string {
  const d = new Date()
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
  const rnd = Array.from({ length: 4 }, () => REF_CHARS[Math.floor(Math.random() * REF_CHARS.length)]).join('')
  return `T-${ymd}-${rnd}`
}

async function addMessage(ticketId: string, actor: Actor, authorRole: 'user' | 'support', kind: TicketMessage['kind'], body: string, attachments: Attachment[] = []): Promise<TicketMessage> {
  const { databases } = createAdminClient()
  const doc = await databases.createDocument(DB_ID, COLLECTIONS.SUPPORT_MESSAGES, ID.unique(), {
    ticketId, authorId: actor.userId, authorName: actor.name.slice(0, 120), authorRole, kind, body: body.slice(0, SUPPORT_LIMITS.body),
    attachments: attachments.length ? JSON.stringify(attachments) : null,
  })
  return docToMessage(doc)
}

async function getTicketDoc(ticketId: string): Promise<Ticket | null> {
  try {
    const { databases } = createAdminClient()
    return docToTicket(await databases.getDocument(DB_ID, COLLECTIONS.SUPPORT_TICKETS, ticketId))
  } catch {
    return null
  }
}

async function patchTicket(ticketId: string, data: Record<string, unknown>): Promise<Ticket> {
  const { databases } = createAdminClient()
  return docToTicket(await databases.updateDocument(DB_ID, COLLECTIONS.SUPPORT_TICKETS, ticketId, data))
}

// ── Pièces jointes ────────────────────────────────────────────────────────────────────────────
// Bucket PRIVÉ : rien n'est accessible directement. Le fichier est nommé `<userId>__<horodatage>__<nom>` à
// l'envoi (le serveur décide du nom), ce qui prouve à la création du message que l'expéditeur en est bien
// l'auteur. La lecture passe par /api/support/files, après contrôle d'accès au ticket.

// On garde lettres (accents inclus), chiffres, espaces, points et tirets ; « __ » est réservé au séparateur du nom stocké.
const safeName = (n: string) => n.replace(/[^\p{L}\p{N}.\-_ ]+/gu, '_').replace(/_{2,}/g, '_').slice(-80) || 'fichier'
const extOf = (n: string) => (n.split('.').pop() ?? '').toLowerCase()

export async function uploadSupportFile(actor: Actor, file: File): Promise<{ attachment?: Attachment; error?: string }> {
  if (!(file instanceof File) || file.size === 0) return { error: 'Fichier vide ou illisible.' }
  if (file.size > SUPPORT_LIMITS.maxFileBytes) return { error: `« ${file.name} » dépasse ${formatSize(SUPPORT_LIMITS.maxFileBytes)}.` }
  if (!(ATTACHMENT_EXTENSIONS as readonly string[]).includes(extOf(file.name))) return { error: `Format non accepté (${ATTACHMENT_EXTENSIONS.join(', ')}).` }
  try {
    const { storage } = createAdminClient()
    const stored = await storage.createFile(BUCKETS.SUPPORT, ID.unique(), InputFile.fromBuffer(Buffer.from(await file.arrayBuffer()), `${actor.userId}__${Date.now()}__${safeName(file.name)}`))
    return { attachment: { id: stored.$id, name: file.name.slice(0, 120), size: file.size, type: file.type || stored.mimeType } }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Échec de l’envoi du fichier.' }
  }
}

/** Ne garde que des fichiers réellement envoyés par cet acteur (vérifié côté serveur, jamais sur la foi du client). */
async function resolveAttachments(actor: Actor, ids: string[] | undefined): Promise<Attachment[]> {
  if (!ids?.length) return []
  const { storage } = createAdminClient()
  const out: Attachment[] = []
  for (const id of [...new Set(ids)].slice(0, SUPPORT_LIMITS.maxAttachments)) {
    try {
      const f = await storage.getFile(BUCKETS.SUPPORT, id)
      if (!f.name.startsWith(`${actor.userId}__`)) continue
      const original = f.name.split('__').slice(2).join('__')
      out.push({ id, name: original || f.name, size: f.sizeOriginal, type: f.mimeType })
    } catch { /* fichier inconnu : ignoré */ }
  }
  return out
}

/** Contenu d'une pièce jointe si `actor` a le droit de la voir (auteur du ticket, ou support), sinon null. */
export async function readAttachment(actor: Actor, ticketId: string, fileId: string): Promise<{ data: ArrayBuffer; attachment: Attachment } | null> {
  const ticket = await getTicketDoc(ticketId)
  if (!ticket) return null
  const isSupport = actor.role === 'admin'
  if (!isSupport && ticket.userId !== actor.userId) return null
  const messages = await listMessages(ticketId, isSupport)
  const attachment = messages.flatMap(m => m.attachments).find(a => a.id === fileId)
  if (!attachment) return null
  const { storage } = createAdminClient()
  return { data: await storage.getFileDownload(BUCKETS.SUPPORT, fileId), attachment }
}

// ── Notifications e-mail ──────────────────────────────────────────────────────────────────────
// Un échec d'envoi ne bloque jamais le ticket, mais il est journalisé (visible dans les logs serveur).

async function sendMail(userIds: string[], subject: string, title: string, bodyHtml: string) {
  // SUPPORT_EMAILS=off : coupe-circuit (tests, environnement de recette) — aucune notification envoyée.
  if (process.env.SUPPORT_EMAILS === 'off' || userIds.length === 0) return
  try {
    const { messaging } = createAdminClient()
    await messaging.createEmail(ID.unique(), subject, wrapEmailHtml(title, bodyHtml), [], userIds, [], [], [], [], false, true)
  } catch (e) {
    console.error('[support] échec de l’envoi de la notification e-mail :', subject, e instanceof Error ? e.message : e)
  }
}

let inboxCache: { id: string; at: number } | null = null

/**
 * Compte Appwrite portant l'adresse support (Messaging n'envoie qu'à des comptes/cibles, pas à une adresse brute).
 * Si aucun compte n'a cette adresse, un compte « boîte support » sans mot de passe utilisable est créé.
 */
async function supportInboxId(): Promise<string | null> {
  if (inboxCache && Date.now() - inboxCache.at < 600_000) return inboxCache.id
  try {
    const { users } = createAdminClient()
    const email = supportEmail()
    const found = await users.list([Query.equal('email', [email]), Query.limit(1)])
    let id = found.users[0]?.$id
    if (!id) {
      const u = await users.create(ID.unique(), email, undefined, randomBytes(24).toString('base64url') + 'aA1!', 'Support Helpdesk')
      await users.updateLabels(u.$id, ['support-inbox'])
      await users.updateEmailVerification(u.$id, true)
      id = u.$id
    }
    inboxCache = { id, at: Date.now() }
    return id
  } catch (e) {
    console.error('[support] boîte support introuvable :', e instanceof Error ? e.message : e)
    return null
  }
}

async function notifySupport(subject: string, title: string, bodyHtml: string) {
  const id = await supportInboxId()
  if (id) await sendMail([id], subject, title, bodyHtml)
}

const para = (t: string) => `<p style="margin:0 0 14px; font-size:14px; line-height:1.7; color:#45454A;">${t}</p>`
const quote = (t: string) => `<blockquote style="margin:0 0 18px; padding:12px 16px; border-left:3px solid #E8A33D; background:#FAFAFA; font-size:13px; line-height:1.65; color:#45454A; white-space:pre-line;">${escapeHtml(t.slice(0, 1500)) || '<em>(pièce jointe uniquement)</em>'}</blockquote>`
const button = (url: string, label: string) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px auto 6px;"><tr><td style="border-radius:10px; background-color:#E8A33D;"><a href="${url}" target="_blank" style="display:inline-block; padding:12px 28px; font-size:14px; font-weight:700; color:#FFFFFF; text-decoration:none; border-radius:10px;">${label}</a></td></tr></table>`
const files = (list: Attachment[]) => list.length
  ? `<p style="margin:0 0 14px; font-size:13px; color:#45454A;"><strong>📎 ${list.length} pièce${list.length > 1 ? 's' : ''} jointe${list.length > 1 ? 's' : ''} :</strong><br>${list.map(a => `${escapeHtml(a.name)} (${formatSize(a.size)})`).join('<br>')}</p>`
  : ''
const meta = (t: Ticket) => `<p style="margin:0 0 14px; font-size:12px; color:#9B9B9E;">${escapeHtml(t.reference)} · ${escapeHtml(CATEGORY_META[t.category].label)} · priorité ${escapeHtml(PRIORITY_META[t.priority].label.toLowerCase())}</p>`

export function ticketUrl(t: Pick<Ticket, 'id' | 'role'>, forSupport = false): string {
  if (forSupport) return `${origin()}/admin/support/${t.id}`
  return `${origin()}/${t.role === 'recruiter' ? 'recruiter' : t.role === 'hunter' ? 'hunter' : 'candidate'}/support/${t.id}`
}

// ── Création & lecture ────────────────────────────────────────────────────────────────────────

export async function createTicket(actor: Actor, input: {
  subject: string; category: string; priority: string; body: string; pageUrl?: string; attachmentIds?: string[]
}): Promise<{ ticket?: Ticket; error?: string }> {
  const subject = input.subject.trim().slice(0, SUPPORT_LIMITS.subject)
  const body = input.body.trim().slice(0, SUPPORT_LIMITS.body)
  if (subject.length < 4) return { error: 'Donnez un titre plus précis à votre demande.' }
  if (body.length < 10) return { error: 'Décrivez votre demande en quelques phrases.' }
  const category: TicketCategory = isCategory(input.category) ? input.category : 'other'
  const priority: TicketPriority = isPriority(input.priority) ? input.priority : 'normal'

  const { databases } = createAdminClient()
  const open = await databases.listDocuments(DB_ID, COLLECTIONS.SUPPORT_TICKETS, [
    Query.equal('userId', actor.userId), Query.notEqual('status', 'resolved'), Query.notEqual('status', 'closed'), Query.limit(SUPPORT_LIMITS.maxOpenPerUser + 1),
  ])
  if (open.total >= SUPPORT_LIMITS.maxOpenPerUser) return { error: `Vous avez déjà ${SUPPORT_LIMITS.maxOpenPerUser} demandes en cours. Attendez une réponse ou clôturez-en une avant d'en créer une nouvelle.` }

  const attachments = await resolveAttachments(actor, input.attachmentIds)
  let doc: Models.Document | null = null
  for (let i = 0; i < 5 && !doc; i++) {
    try {
      doc = await databases.createDocument(DB_ID, COLLECTIONS.SUPPORT_TICKETS, ID.unique(), {
        reference: makeReference(), userId: actor.userId, userName: actor.name.slice(0, 120), userEmail: actor.email.slice(0, 200),
        role: actor.role, tenantId: actor.tenantId ?? '', subject, category, priority, status: 'open', assignee: '',
        lastMessageAt: new Date().toISOString(), lastMessageBy: 'user', unreadUser: false, unreadSupport: true,
        pageUrl: (input.pageUrl ?? '').slice(0, 300),
      })
    } catch (e) {
      // Collision (très improbable) sur l'index unique de la référence : on retente avec une autre.
      if (!(e instanceof Error && /already exists|unique/i.test(e.message))) throw e
    }
  }
  if (!doc) return { error: 'Impossible de créer le ticket, réessayez.' }
  const ticket = docToTicket(doc)
  await addMessage(ticket.id, actor, 'user', 'message', body, attachments)

  await notifySupport(`[${ticket.reference}] Nouveau ticket : ${subject}`, 'Nouveau ticket de support',
    para(`<strong>${escapeHtml(actor.name)}</strong> · ${escapeHtml(actor.email)} · ${actor.role === 'recruiter' ? 'Recruteur' : actor.role === 'hunter' ? 'Chasseur' : 'Candidat'}`) + meta(ticket) +
    para(`<strong>${escapeHtml(subject)}</strong>`) + quote(body) + files(attachments) + button(ticketUrl(ticket, true), 'Ouvrir dans le Help Desk'))
  return { ticket }
}

/** Nombre de tickets de l'utilisateur avec une réponse du support non lue — pastille du bouton « Support ». */
export async function countUnreadForUser(userId: string): Promise<number> {
  try {
    const { databases } = createAdminClient()
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.SUPPORT_TICKETS, [Query.equal('userId', userId), Query.limit(100)])
    return res.documents.filter(d => (d as unknown as { unreadUser?: boolean }).unreadUser === true).length
  } catch {
    return 0
  }
}

export async function listUserTickets(userId: string): Promise<Ticket[]> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.SUPPORT_TICKETS, [Query.equal('userId', userId), Query.orderDesc('$updatedAt'), Query.limit(100)])
  return res.documents.map(docToTicket).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
}

/** Tickets ouverts avec du nouveau côté support — pastille de la navigation admin. */
export async function countTicketsNeedingSupport(): Promise<number> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.SUPPORT_TICKETS, [Query.equal('status', ['open', 'in_progress', 'waiting_user']), Query.limit(100)])
  return res.documents.filter(d => (d as unknown as { unreadSupport?: boolean }).unreadSupport !== false).length
}

export async function listAllTickets(): Promise<Ticket[]> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.SUPPORT_TICKETS, [Query.orderDesc('$updatedAt'), Query.limit(500)])
  return res.documents.map(docToTicket).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
}

async function listMessages(ticketId: string, includeNotes: boolean): Promise<TicketMessage[]> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.SUPPORT_MESSAGES, [Query.equal('ticketId', ticketId), Query.orderAsc('$createdAt'), Query.limit(500)])
  return res.documents.map(docToMessage).filter(m => includeNotes || m.kind !== 'note')
}

/** Ticket + fil de discussion pour son auteur (notes internes masquées) ; le marque comme lu. */
export async function getUserTicket(ticketId: string, userId: string): Promise<{ ticket: Ticket; messages: TicketMessage[] } | null> {
  let ticket = await getTicketDoc(ticketId)
  if (!ticket || ticket.userId !== userId) return null
  if (ticket.unreadUser) ticket = await patchTicket(ticketId, { unreadUser: false })
  return { ticket, messages: await listMessages(ticketId, false) }
}

/** Ticket + fil complet (notes internes et historique inclus) pour le support ; le marque comme lu. */
export async function getSupportTicket(ticketId: string): Promise<{ ticket: Ticket; messages: TicketMessage[] } | null> {
  let ticket = await getTicketDoc(ticketId)
  if (!ticket) return null
  if (ticket.unreadSupport) ticket = await patchTicket(ticketId, { unreadSupport: false })
  return { ticket, messages: await listMessages(ticketId, true) }
}

// ── Actions de l'utilisateur ──────────────────────────────────────────────────────────────────

export async function userReply(ticketId: string, actor: Actor, bodyRaw: string, attachmentIds?: string[]): Promise<{ ticket?: Ticket; messages?: TicketMessage[]; error?: string }> {
  const body = bodyRaw.trim().slice(0, SUPPORT_LIMITS.body)
  const attachments = await resolveAttachments(actor, attachmentIds)
  if (!body && attachments.length === 0) return { error: 'Écrivez votre message.' }
  const current = await getTicketDoc(ticketId)
  if (!current || current.userId !== actor.userId) return { error: 'Ticket introuvable.' }

  const messages: TicketMessage[] = [await addMessage(ticketId, actor, 'user', 'message', body, attachments)]
  // Une réponse de l'utilisateur rouvre un ticket résolu/fermé/en attente : il redevient à traiter pour le support.
  const reopened = current.status === 'resolved' || current.status === 'closed'
  const status: TicketStatus = current.status === 'in_progress' ? 'in_progress' : 'open'
  if (reopened) messages.push(await addMessage(ticketId, actor, 'user', 'event', 'Ticket rouvert par l’utilisateur'))
  const ticket = await patchTicket(ticketId, { status, lastMessageAt: new Date().toISOString(), lastMessageBy: 'user', unreadSupport: true })

  await notifySupport(`[${ticket.reference}] Nouveau message : ${ticket.subject}`, 'Nouveau message d’un utilisateur',
    para(`<strong>${escapeHtml(actor.name)}</strong> · ${escapeHtml(actor.email)} a écrit sur le ticket <strong>${escapeHtml(ticket.reference)}</strong>${reopened ? ' (ticket rouvert)' : ''} :`) +
    meta(ticket) + quote(body) + files(attachments) + button(ticketUrl(ticket, true), 'Répondre dans le Help Desk'))
  return { ticket, messages }
}

export async function userResolve(ticketId: string, actor: Actor): Promise<{ ticket?: Ticket; messages?: TicketMessage[]; error?: string }> {
  const current = await getTicketDoc(ticketId)
  if (!current || current.userId !== actor.userId) return { error: 'Ticket introuvable.' }
  if (!isOpenStatus(current.status)) return { ticket: current, messages: [] }
  const ev = await addMessage(ticketId, actor, 'user', 'event', 'Marqué comme résolu par l’utilisateur')
  const ticket = await patchTicket(ticketId, { status: 'resolved', lastMessageAt: new Date().toISOString(), lastMessageBy: 'user', unreadSupport: true })
  return { ticket, messages: [ev] }
}

// ── Actions du support / admin ────────────────────────────────────────────────────────────────

export async function supportReply(ticketId: string, actor: Actor, bodyRaw: string, setStatus?: string, attachmentIds?: string[]): Promise<{ ticket?: Ticket; messages?: TicketMessage[]; error?: string }> {
  const body = bodyRaw.trim().slice(0, SUPPORT_LIMITS.body)
  const attachments = await resolveAttachments(actor, attachmentIds)
  if (!body && attachments.length === 0) return { error: 'Écrivez votre réponse.' }
  const current = await getTicketDoc(ticketId)
  if (!current) return { error: 'Ticket introuvable.' }

  const nextStatus: TicketStatus = isStatus(setStatus) ? setStatus : 'waiting_user'
  const messages: TicketMessage[] = [await addMessage(ticketId, actor, 'support', 'message', body, attachments)]
  if (nextStatus !== current.status) messages.push(await addMessage(ticketId, actor, 'support', 'event', `Statut : ${STATUS_META[current.status].label} → ${STATUS_META[nextStatus].label}`))
  const patch: Record<string, unknown> = { status: nextStatus, lastMessageAt: new Date().toISOString(), lastMessageBy: 'support', unreadUser: true }
  if (!current.assignee) {
    patch.assignee = actor.name.slice(0, 100)
    messages.push(await addMessage(ticketId, actor, 'support', 'event', `Assigné à ${actor.name}`))
  }
  const ticket = await patchTicket(ticketId, patch)

  // Le client est prévenu par email à chaque réponse du support.
  await sendMail([ticket.userId], `[${ticket.reference}] Réponse du support : ${ticket.subject}`, 'Le support vous a répondu',
    para(`Bonjour ${escapeHtml(ticket.userName.split(' ')[0] || '')},`) + para(`Notre équipe a répondu à votre demande « <strong>${escapeHtml(ticket.subject)}</strong> » :`) +
    quote(body) + files(attachments) + button(ticketUrl(ticket), 'Voir la conversation et répondre') +
    `<p style="margin:14px 0 0; font-size:11px; color:#9B9B9E; text-align:center;">Pour nous répondre, utilisez le bouton ci-dessus (les réponses à cet email ne sont pas suivies).</p>`)
  return { ticket, messages }
}

export async function addInternalNote(ticketId: string, actor: Actor, bodyRaw: string, attachmentIds?: string[]): Promise<{ messages?: TicketMessage[]; error?: string }> {
  const body = bodyRaw.trim().slice(0, SUPPORT_LIMITS.body)
  const attachments = await resolveAttachments(actor, attachmentIds)
  if (!body && attachments.length === 0) return { error: 'Écrivez votre note.' }
  if (!(await getTicketDoc(ticketId))) return { error: 'Ticket introuvable.' }
  return { messages: [await addMessage(ticketId, actor, 'support', 'note', body, attachments)] }
}

export async function updateTicketMeta(ticketId: string, actor: Actor, patch: {
  status?: string; priority?: string; category?: string; assignee?: string
}): Promise<{ ticket?: Ticket; messages?: TicketMessage[]; error?: string }> {
  const current = await getTicketDoc(ticketId)
  if (!current) return { error: 'Ticket introuvable.' }
  const data: Record<string, unknown> = {}
  const events: string[] = []

  if (patch.status !== undefined && isStatus(patch.status) && patch.status !== current.status) {
    data.status = patch.status
    events.push(`Statut : ${STATUS_META[current.status].label} → ${STATUS_META[patch.status].label}`)
  }
  if (patch.priority !== undefined && isPriority(patch.priority) && patch.priority !== current.priority) {
    data.priority = patch.priority
    events.push(`Priorité : ${PRIORITY_META[current.priority].label} → ${PRIORITY_META[patch.priority].label}`)
  }
  if (patch.category !== undefined && isCategory(patch.category) && patch.category !== current.category) {
    data.category = patch.category
    events.push(`Catégorie : ${CATEGORY_META[current.category].label} → ${CATEGORY_META[patch.category].label}`)
  }
  if (patch.assignee !== undefined && patch.assignee.trim().slice(0, 100) !== current.assignee) {
    const a = patch.assignee.trim().slice(0, 100)
    data.assignee = a
    events.push(a ? `Assigné à ${a}` : 'Assignation retirée')
  }
  if (events.length === 0) return { ticket: current, messages: [] }

  const messages: TicketMessage[] = []
  for (const e of events) messages.push(await addMessage(ticketId, actor, 'support', 'event', e))
  const ticket = await patchTicket(ticketId, data)

  // L'utilisateur est prévenu quand son ticket est résolu.
  if (data.status === 'resolved') {
    await sendMail([ticket.userId], `[${ticket.reference}] Demande résolue : ${ticket.subject}`, 'Votre demande est résolue',
      para(`Votre demande « <strong>${escapeHtml(ticket.subject)}</strong> » a été marquée comme résolue.`) +
      para('Si le problème persiste, répondez simplement dans la conversation : elle sera rouverte.') + button(ticketUrl(ticket), 'Voir la conversation'))
  }
  return { ticket, messages }
}
