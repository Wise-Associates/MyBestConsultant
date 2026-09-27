// Help Desk (Module 11) — types et constantes partagés serveur / client (aucun accès base ici).

export type TicketStatus = 'open' | 'in_progress' | 'waiting_user' | 'resolved' | 'closed'
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'
export type TicketCategory = 'bug' | 'account' | 'billing' | 'ai' | 'recruiting' | 'feature' | 'other'

export const STATUS_META: Record<TicketStatus, { label: string; userLabel: string; color: string }> = {
  open: { label: 'Nouveau', userLabel: 'Envoyé — en attente du support', color: '#3b82f6' },
  in_progress: { label: 'En cours', userLabel: 'En cours de traitement', color: '#8b5cf6' },
  waiting_user: { label: 'Attente utilisateur', userLabel: 'En attente de votre réponse', color: '#f59e0b' },
  resolved: { label: 'Résolu', userLabel: 'Résolu', color: '#10b981' },
  closed: { label: 'Fermé', userLabel: 'Fermé', color: '#6b7280' },
}
export const STATUS_ORDER: TicketStatus[] = ['open', 'in_progress', 'waiting_user', 'resolved', 'closed']

export const PRIORITY_META: Record<TicketPriority, { label: string; userLabel: string; color: string }> = {
  low: { label: 'Basse', userLabel: 'Simple question', color: '#6b7280' },
  normal: { label: 'Normale', userLabel: 'Ça me gêne', color: '#3b82f6' },
  high: { label: 'Haute', userLabel: 'Ça bloque mon travail', color: '#f59e0b' },
  urgent: { label: 'Urgente', userLabel: 'Urgent', color: '#ef4444' },
}

export const CATEGORY_META: Record<TicketCategory, { label: string; hint: string }> = {
  bug: { label: 'Un problème technique', hint: 'Quelque chose ne fonctionne pas comme prévu' },
  account: { label: 'Mon compte', hint: 'Connexion, mot de passe, profil' },
  billing: { label: 'Facturation & abonnement', hint: 'Plan, paiement, facture' },
  ai: { label: 'IA & matching', hint: 'Screening, entretiens IA, résultats' },
  recruiting: { label: 'Offres & candidatures', hint: 'Publier, gérer, postuler' },
  feature: { label: 'Suggestion', hint: 'Une idée pour améliorer la plateforme' },
  other: { label: 'Autre demande', hint: 'Tout le reste' },
}

export const SUPPORT_LIMITS = { subject: 200, body: 5000, maxOpenPerUser: 10, maxAttachments: 5, maxFileBytes: 8 * 1024 * 1024 } as const

/** Extensions acceptées en pièce jointe (mêmes que le bucket ; pas de SVG/HTML : risque XSS). */
export const ATTACHMENT_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'txt', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip'] as const
export const ATTACHMENT_ACCEPT = ATTACHMENT_EXTENSIONS.map(e => '.' + e).join(',')

export interface Attachment { id: string; name: string; size: number; type: string }

export const isImageAttachment = (a: Pick<Attachment, 'type' | 'name'>) => /^image\/(png|jpe?g|webp|gif)$/.test(a.type) || /\.(png|jpe?g|webp|gif)$/i.test(a.name)
export function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' o'
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' Ko'
  return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' Mo'
}

export interface Ticket {
  id: string
  reference: string
  userId: string
  userName: string
  userEmail: string
  role: string
  tenantId: string
  subject: string
  category: TicketCategory
  priority: TicketPriority
  status: TicketStatus
  assignee: string
  lastMessageAt: string
  lastMessageBy: 'user' | 'support'
  unreadUser: boolean
  unreadSupport: boolean
  pageUrl: string
  createdAt: string
}

export interface TicketMessage {
  id: string
  ticketId: string
  authorId: string
  authorName: string
  authorRole: 'user' | 'support'
  kind: 'message' | 'note' | 'event'
  body: string
  attachments: Attachment[]
  createdAt: string
}

export const isOpenStatus = (s: TicketStatus) => s !== 'resolved' && s !== 'closed'

export function isStatus(v: unknown): v is TicketStatus { return typeof v === 'string' && v in STATUS_META }
export function isPriority(v: unknown): v is TicketPriority { return typeof v === 'string' && v in PRIORITY_META }
export function isCategory(v: unknown): v is TicketCategory { return typeof v === 'string' && v in CATEGORY_META }
