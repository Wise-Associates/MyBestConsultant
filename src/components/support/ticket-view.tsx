'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, CheckCircle2, Clock, ExternalLink, Loader2, LifeBuoy, Send, ShieldCheck, StickyNote, User as UserIcon, UserCheck, UserX,
} from 'lucide-react'
import {
  CATEGORY_META, PRIORITY_META, STATUS_META, STATUS_ORDER, SUPPORT_LIMITS, isOpenStatus,
  type Ticket, type TicketCategory, type TicketMessage, type TicketPriority, type TicketStatus,
} from '@/lib/support-shared'
import { AttachmentList, AttachmentPicker, useAttachments } from './attachments'
import {
  replyTicketAction, resolveTicketAction, supportNoteAction, supportReplyAction, supportUpdateAction,
} from '@/lib/support-actions'

const PALETTE = {
  light: { text: 'var(--color-text)', muted: 'var(--color-text-muted)', surface: 'var(--color-surface)', border: 'var(--color-border)', soft: 'rgba(11,29,81,0.04)', input: 'var(--color-background)' },
  dark: { text: 'rgba(255,255,255,0.88)', muted: 'rgba(255,255,255,0.45)', surface: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.1)', soft: 'rgba(255,255,255,0.05)', input: 'rgba(255,255,255,0.07)' },
}

const fmt = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const initials = (n: string) => n.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?'

export function StatusPill({ status, user = false }: { status: TicketStatus; user?: boolean }) {
  const m = STATUS_META[status]
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: `${m.color}1f`, color: m.color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.color }} />{user ? m.userLabel : m.label}
    </span>
  )
}

export function TicketView({ initialTicket, initialMessages, mode, backHref, adminName }: {
  initialTicket: Ticket; initialMessages: TicketMessage[]; mode: 'user' | 'admin'; backHref: string; adminName?: string
}) {
  const admin = mode === 'admin'
  const P = PALETTE[admin ? 'dark' : 'light']
  const [ticket, setTicket] = useState(initialTicket)
  const [messages, setMessages] = useState(initialMessages)
  const [body, setBody] = useState('')
  const [tab, setTab] = useState<'reply' | 'note'>('reply')
  const [afterStatus, setAfterStatus] = useState<'waiting_user' | 'in_progress' | 'resolved' | 'keep'>('waiting_user')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const endRef = useRef<HTMLDivElement>(null)
  const files = useAttachments()
  const open = isOpenStatus(ticket.status)

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  const merge = (t?: Ticket, m?: TicketMessage[]) => {
    if (t) setTicket(t)
    if (m?.length) setMessages(prev => [...prev, ...m.filter(x => !prev.some(p => p.id === x.id))])
  }

  function send() {
    const text = body.trim()
    if ((!text && files.ids.length === 0) || pending || files.uploading > 0) return
    setError(null)
    startTransition(async () => {
      const res = admin
        ? tab === 'note'
          ? await supportNoteAction(ticket.id, text, files.ids)
          : await supportReplyAction(ticket.id, text, afterStatus === 'keep' ? ticket.status : afterStatus, files.ids)
        : await replyTicketAction(ticket.id, text, files.ids)
      if (res.error) { setError(res.error); return }
      merge(res.ticket, res.messages)
      setBody('')
      files.clear()
    })
  }

  function resolve() {
    setError(null)
    startTransition(async () => {
      const res = await resolveTicketAction(ticket.id)
      if (res.error) setError(res.error); else merge(res.ticket, res.messages)
    })
  }

  function update(patch: { status?: string; priority?: string; category?: string; assignee?: string }) {
    setError(null)
    startTransition(async () => {
      const res = await supportUpdateAction(ticket.id, patch)
      if (res.error) setError(res.error); else merge(res.ticket, res.messages)
    })
  }

  const selectCls = 'w-full px-3 py-2 rounded-lg text-sm outline-none'
  const selectStyle = { background: P.input, border: `1px solid ${P.border}`, color: P.text }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80" style={{ color: P.muted }}>
        <ArrowLeft className="h-3.5 w-3.5" /> {admin ? 'Tous les tickets' : 'Mes demandes'}
      </Link>

      <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
        {/* ── Conversation ── */}
        <div className="min-w-0 space-y-4">
          <div className="rounded-3xl p-5 sm:p-6" style={{ background: P.surface, border: `1px solid ${P.border}` }}>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded" style={{ background: P.soft, color: P.muted }}>{ticket.reference}</span>
              <StatusPill status={ticket.status} user={!admin} />
              <span className="text-[11px] font-semibold" style={{ color: PRIORITY_META[ticket.priority].color }}>● {admin ? PRIORITY_META[ticket.priority].label : PRIORITY_META[ticket.priority].userLabel}</span>
            </div>
            <h1 style={{ color: P.text, fontWeight: 700, fontSize: '1.25rem', lineHeight: 1.3 }}>{ticket.subject}</h1>
            <p className="text-xs mt-1.5" style={{ color: P.muted }}>{CATEGORY_META[ticket.category].label} · ouvert le {fmt(ticket.createdAt)}</p>
          </div>

          <div className="space-y-3">
            {messages.map(m => {
              if (m.kind === 'event') {
                return <p key={m.id} className="text-center text-[11px]" style={{ color: P.muted }}><span className="px-3 py-1 rounded-full" style={{ background: P.soft }}>{m.body} · {fmt(m.createdAt)}</span></p>
              }
              const support = m.authorRole === 'support'
              const mine = admin ? support : !support
              const note = m.kind === 'note'
              return (
                <div key={m.id} className={`flex gap-3 ${mine ? 'flex-row-reverse' : ''}`}>
                  <span className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5"
                    style={{ background: support ? 'rgba(232,163,61,0.2)' : 'rgba(99,102,241,0.16)', color: support ? '#b8862f' : '#6366f1' }}>
                    {support ? <ShieldCheck className="h-4 w-4" /> : initials(m.authorName)}
                  </span>
                  <div className={`max-w-[85%] min-w-0 ${mine ? 'items-end' : ''}`}>
                    <p className={`text-[11px] mb-1 ${mine ? 'text-right' : ''}`} style={{ color: P.muted }}>
                      <strong style={{ color: P.text }}>{support && !admin ? 'Support MyBestConsultant' : m.authorName}</strong>
                      {note && <span className="ml-1.5 font-bold" style={{ color: '#f59e0b' }}>· Note interne</span>} · {fmt(m.createdAt)}
                    </p>
                    <div className="rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words"
                      style={note
                        ? { background: 'rgba(245,158,11,0.1)', border: '1px dashed rgba(245,158,11,0.5)', color: P.text }
                        : mine
                          ? { background: 'rgba(232,163,61,0.16)', border: '1px solid rgba(232,163,61,0.3)', color: P.text }
                          : { background: P.surface, border: `1px solid ${P.border}`, color: P.text }}>
                      {m.body}
                      <AttachmentList attachments={m.attachments} ticketId={ticket.id} dark={admin} />
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={endRef} />
          </div>

          {/* ── Composer ── */}
          <div className="rounded-3xl p-4 sm:p-5" style={{ background: P.surface, border: `1px solid ${P.border}` }}>
            {admin && (
              <div className="flex gap-1 mb-3">
                {([['reply', 'Répondre à l’utilisateur', Send], ['note', 'Note interne', StickyNote]] as const).map(([k, l, Icon]) => (
                  <button key={k} type="button" onClick={() => setTab(k)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
                    style={tab === k ? { background: k === 'note' ? 'rgba(245,158,11,0.2)' : 'rgba(232,163,61,0.22)', color: k === 'note' ? '#f59e0b' : '#e8a33d' } : { color: P.muted }}>
                    <Icon className="h-3.5 w-3.5" />{l}
                  </button>
                ))}
              </div>
            )}
            {!admin && !open && <p className="text-xs mb-2" style={{ color: P.muted }}>Cette demande est {ticket.status === 'closed' ? 'fermée' : 'résolue'} — répondre la rouvrira automatiquement.</p>}
            <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={SUPPORT_LIMITS.body} rows={4}
              onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') send() }}
              placeholder={admin ? (tab === 'note' ? 'Visible uniquement par l’équipe support…' : 'Votre réponse à l’utilisateur…') : 'Écrivez votre message…'}
              className="w-full px-3.5 py-3 rounded-xl text-sm outline-none resize-y" style={{ ...selectStyle, minHeight: 96 }} />
            <div className="mt-3"><AttachmentPicker state={files} dark={admin} /></div>
            <div className="flex items-center justify-between gap-3 flex-wrap mt-3">
              <div className="flex items-center gap-2 flex-wrap">
                {admin && tab === 'reply' && (
                  <label className="flex items-center gap-2 text-xs" style={{ color: P.muted }}>Après l’envoi :
                    <select value={afterStatus} onChange={e => setAfterStatus(e.target.value as typeof afterStatus)} className="px-2.5 py-1.5 rounded-lg text-xs outline-none" style={selectStyle}>
                      <option value="waiting_user">En attente de l’utilisateur</option>
                      <option value="in_progress">En cours</option>
                      <option value="resolved">Résolu</option>
                      <option value="keep">Statut inchangé</option>
                    </select>
                  </label>
                )}
                {!admin && open && (
                  <button type="button" onClick={resolve} disabled={pending} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-opacity hover:opacity-80 disabled:opacity-50" style={{ background: 'rgba(16,185,129,0.12)', color: '#059669' }}>
                    <CheckCircle2 className="h-3.5 w-3.5" />C’est résolu
                  </button>
                )}
                <span className="text-[11px]" style={{ color: P.muted }}>{body.length}/{SUPPORT_LIMITS.body} · Ctrl+Entrée pour envoyer</span>
              </div>
              <button type="button" onClick={send} disabled={pending || files.uploading > 0 || (!body.trim() && files.ids.length === 0)} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-opacity disabled:opacity-40" style={{ background: 'var(--color-primary)', color: 'white' }}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{tab === 'note' && admin ? 'Ajouter la note' : 'Envoyer'}
              </button>
            </div>
            {error && <p className="text-xs mt-2.5 font-medium" style={{ color: '#ef4444' }}>{error}</p>}
          </div>
        </div>

        {/* ── Colonne latérale ── */}
        <aside className="space-y-4 lg:sticky lg:top-[84px] min-w-0">
          {admin ? (
            <>
              <div className="rounded-3xl p-5 space-y-3.5" style={{ background: P.surface, border: `1px solid ${P.border}` }}>
                <p className="text-xs font-bold uppercase tracking-widest" style={{ color: P.muted }}>Traitement</p>
                <label className="block"><span className="text-[11px] font-semibold" style={{ color: P.muted }}>Statut</span>
                  <select className={`${selectCls} mt-1`} style={selectStyle} value={ticket.status} disabled={pending} onChange={e => update({ status: e.target.value })}>
                    {STATUS_ORDER.map(s => <option key={s} value={s} style={{ color: '#000' }}>{STATUS_META[s].label}</option>)}
                  </select></label>
                <label className="block"><span className="text-[11px] font-semibold" style={{ color: P.muted }}>Priorité</span>
                  <select className={`${selectCls} mt-1`} style={selectStyle} value={ticket.priority} disabled={pending} onChange={e => update({ priority: e.target.value as TicketPriority })}>
                    {(Object.keys(PRIORITY_META) as TicketPriority[]).map(p => <option key={p} value={p} style={{ color: '#000' }}>{PRIORITY_META[p].label}</option>)}
                  </select></label>
                <label className="block"><span className="text-[11px] font-semibold" style={{ color: P.muted }}>Catégorie</span>
                  <select className={`${selectCls} mt-1`} style={selectStyle} value={ticket.category} disabled={pending} onChange={e => update({ category: e.target.value as TicketCategory })}>
                    {(Object.keys(CATEGORY_META) as TicketCategory[]).map(c => <option key={c} value={c} style={{ color: '#000' }}>{CATEGORY_META[c].label}</option>)}
                  </select></label>
                <div>
                  <span className="text-[11px] font-semibold" style={{ color: P.muted }}>Assigné à</span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="flex-1 min-w-0 truncate text-sm" style={{ color: ticket.assignee ? P.text : P.muted }}>{ticket.assignee || 'Personne'}</span>
                    {adminName && ticket.assignee !== adminName && (
                      <button type="button" disabled={pending} onClick={() => update({ assignee: adminName })} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold" style={{ background: 'rgba(232,163,61,0.2)', color: '#e8a33d' }}><UserCheck className="h-3.5 w-3.5" />Moi</button>
                    )}
                    {ticket.assignee && (
                      <button type="button" disabled={pending} onClick={() => update({ assignee: '' })} aria-label="Retirer l’assignation" className="p-1.5 rounded-lg" style={{ background: P.soft, color: P.muted }}><UserX className="h-3.5 w-3.5" /></button>
                    )}
                  </div>
                </div>
              </div>
              <div className="rounded-3xl p-5 space-y-2 text-sm" style={{ background: P.surface, border: `1px solid ${P.border}` }}>
                <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: P.muted }}>Demandeur</p>
                <p className="flex items-center gap-2" style={{ color: P.text }}><UserIcon className="h-3.5 w-3.5" style={{ color: P.muted }} />{ticket.userName}</p>
                <a href={`mailto:${ticket.userEmail}`} className="block truncate no-underline hover:underline" style={{ color: '#e8a33d' }}>{ticket.userEmail}</a>
                <p className="text-xs" style={{ color: P.muted }}>{ticket.role === 'recruiter' ? 'Recruteur' : ticket.role === 'hunter' ? 'Chasseur' : 'Candidat'}</p>
                {ticket.pageUrl && <p className="text-xs break-all flex items-start gap-1.5" style={{ color: P.muted }}><ExternalLink className="h-3 w-3 mt-0.5 shrink-0" />{ticket.pageUrl}</p>}
              </div>
            </>
          ) : (
            <div className="rounded-3xl p-5" style={{ background: P.surface, border: `1px solid ${P.border}` }}>
              <div className="flex items-center gap-2.5 mb-3">
                <span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(232,163,61,0.16)', color: 'var(--color-primary)' }}><LifeBuoy className="h-4 w-4" /></span>
                <p className="font-bold text-sm" style={{ color: P.text }}>Suivi de votre demande</p>
              </div>
              <ul className="space-y-2.5 text-sm" style={{ color: P.text }}>
                <li className="flex justify-between gap-3"><span style={{ color: P.muted }}>Référence</span><span className="font-mono text-xs font-bold">{ticket.reference}</span></li>
                <li className="flex justify-between gap-3"><span style={{ color: P.muted }}>Statut</span><StatusPill status={ticket.status} user /></li>
                <li className="flex justify-between gap-3"><span style={{ color: P.muted }}>Dernière activité</span><span className="text-xs">{fmt(ticket.lastMessageAt)}</span></li>
                {ticket.assignee && <li className="flex justify-between gap-3"><span style={{ color: P.muted }}>Suivi par</span><span className="text-xs font-semibold">{ticket.assignee}</span></li>}
              </ul>
              <p className="text-xs mt-4 pt-3 flex items-start gap-1.5" style={{ borderTop: `1px solid ${P.border}`, color: P.muted }}>
                <Clock className="h-3.5 w-3.5 shrink-0 mt-0.5" />Vous serez prévenu par email à chaque réponse de notre équipe.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
