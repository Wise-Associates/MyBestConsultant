'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Inbox, LifeBuoy, Search, UserX } from 'lucide-react'
import {
  CATEGORY_META, PRIORITY_META, STATUS_META, isOpenStatus,
  type Ticket, type TicketCategory, type TicketPriority,
} from '@/lib/support-shared'
import { StatusPill } from '@/components/support/ticket-view'

const PAGE_SIZE = 20
const DAY = 86_400_000

function timeAgo(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'à l’instant'
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`
  return `il y a ${Math.floor(s / 86400)} j`
}

type Scope = 'active' | 'all' | 'done'
const fieldStyle = { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)' } as const

export function AdminSupportClient({ tickets, adminName, now }: { tickets: Ticket[]; adminName: string; now: string }) {
  const nowMs = new Date(now).getTime()
  const [scope, setScope] = useState<Scope>('active')
  const [priority, setPriority] = useState<'all' | TicketPriority>('all')
  const [category, setCategory] = useState<'all' | TicketCategory>('all')
  const [assignee, setAssignee] = useState<'all' | 'me' | 'none'>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const stats = useMemo(() => {
    const open = tickets.filter(t => isOpenStatus(t.status))
    const oldest = open.filter(t => t.status === 'open').reduce<Ticket | null>((m, t) => (!m || t.createdAt < m.createdAt ? t : m), null)
    return {
      fresh: tickets.filter(t => t.status === 'open').length,
      inProgress: tickets.filter(t => t.status === 'in_progress').length,
      waiting: tickets.filter(t => t.status === 'waiting_user').length,
      unassigned: open.filter(t => !t.assignee).length,
      resolved7: tickets.filter(t => t.status === 'resolved' && nowMs - new Date(t.lastMessageAt).getTime() < 7 * DAY).length,
      oldestDays: oldest ? Math.floor((nowMs - new Date(oldest.createdAt).getTime()) / DAY) : null,
      unread: tickets.filter(t => t.unreadSupport && isOpenStatus(t.status)).length,
    }
  }, [tickets, nowMs])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tickets.filter(t =>
      (scope === 'all' || (scope === 'active' ? isOpenStatus(t.status) : !isOpenStatus(t.status))) &&
      (priority === 'all' || t.priority === priority) &&
      (category === 'all' || t.category === category) &&
      (assignee === 'all' || (assignee === 'me' ? t.assignee === adminName : !t.assignee)) &&
      (!q || `${t.subject} ${t.reference} ${t.userName} ${t.userEmail}`.toLowerCase().includes(q)),
    )
  }, [tickets, scope, priority, category, assignee, query, adminName])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, totalPages)
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1) }

  const cards = [
    { label: 'Nouveaux', value: stats.fresh, color: STATUS_META.open.color, hint: stats.oldestDays !== null ? `le plus ancien : ${stats.oldestDays} j` : 'rien en attente' },
    { label: 'En cours', value: stats.inProgress, color: STATUS_META.in_progress.color, hint: 'en traitement' },
    { label: 'Attente utilisateur', value: stats.waiting, color: STATUS_META.waiting_user.color, hint: 'réponse attendue' },
    { label: 'Non assignés', value: stats.unassigned, color: '#ef4444', hint: 'à prendre en charge' },
    { label: 'Résolus (7 j)', value: stats.resolved7, color: STATUS_META.resolved.color, hint: 'cette semaine' },
  ]

  return (
    <div className="min-h-full p-6 sm:p-8 max-w-6xl mx-auto space-y-6" style={{ color: 'rgba(255,255,255,0.87)' }}>
      <div>
        <p className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: 'rgba(255,255,255,0.3)' }}>SUPPORT</p>
        <h1 className="tracking-tight text-white flex items-center gap-3" style={{ fontSize: '1.75rem', fontWeight: 700 }}><LifeBuoy className="h-6 w-6" style={{ color: '#e8a33d' }} />Help Desk</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Tickets des recruteurs et des candidats — {tickets.length} au total{stats.unread > 0 ? `, ${stats.unread} avec du nouveau` : ''}.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {cards.map(c => (
          <div key={c.label} className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>{c.label}</p>
            <p className="text-3xl font-bold mt-1" style={{ color: c.value > 0 ? c.color : 'rgba(255,255,255,0.35)' }}>{c.value}</p>
            <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{c.hint}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="flex items-center gap-2 px-3 rounded-xl flex-1 min-w-[220px]" style={fieldStyle}>
          <Search className="h-4 w-4 shrink-0" style={{ color: 'rgba(255,255,255,0.4)' }} />
          <input value={query} onChange={e => reset(setQuery)(e.target.value)} placeholder="Rechercher un ticket, un utilisateur, une référence…" className="w-full py-2.5 text-sm outline-none bg-transparent" style={{ color: 'inherit' }} />
        </div>
        <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
          {([['active', 'À traiter'], ['all', 'Tous'], ['done', 'Terminés']] as [Scope, string][]).map(([k, l]) => (
            <button key={k} type="button" onClick={() => reset(setScope)(k)} className="px-3.5 py-2.5 text-xs font-semibold" style={{ background: scope === k ? '#B8860B' : 'rgba(255,255,255,0.04)', color: scope === k ? 'white' : 'rgba(255,255,255,0.55)' }}>{l}</button>
          ))}
        </div>
        <select value={priority} onChange={e => reset(setPriority)(e.target.value as typeof priority)} className="px-3 py-2.5 rounded-xl text-xs outline-none" style={fieldStyle}>
          <option value="all" style={{ color: '#000' }}>Toutes priorités</option>
          {(Object.keys(PRIORITY_META) as TicketPriority[]).map(p => <option key={p} value={p} style={{ color: '#000' }}>{PRIORITY_META[p].label}</option>)}
        </select>
        <select value={category} onChange={e => reset(setCategory)(e.target.value as typeof category)} className="px-3 py-2.5 rounded-xl text-xs outline-none" style={fieldStyle}>
          <option value="all" style={{ color: '#000' }}>Toutes catégories</option>
          {(Object.keys(CATEGORY_META) as TicketCategory[]).map(c => <option key={c} value={c} style={{ color: '#000' }}>{CATEGORY_META[c].label}</option>)}
        </select>
        <select value={assignee} onChange={e => reset(setAssignee)(e.target.value as typeof assignee)} className="px-3 py-2.5 rounded-xl text-xs outline-none" style={fieldStyle}>
          <option value="all" style={{ color: '#000' }}>Tous les agents</option>
          <option value="me" style={{ color: '#000' }}>Mes tickets</option>
          <option value="none" style={{ color: '#000' }}>Non assignés</option>
        </select>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        {rows.length === 0 ? (
          <div className="py-16 text-center">
            <Inbox className="h-8 w-8 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.25)' }} />
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>{tickets.length === 0 ? 'Aucun ticket pour le moment.' : 'Aucun ticket ne correspond à ces filtres.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 760 }}>
              <thead>
                <tr className="text-[11px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.03)' }}>
                  <th className="text-left font-semibold px-4 py-3">Ticket</th>
                  <th className="text-left font-semibold px-3 py-3">Demandeur</th>
                  <th className="text-left font-semibold px-3 py-3">Statut</th>
                  <th className="text-left font-semibold px-3 py-3">Priorité</th>
                  <th className="text-left font-semibold px-3 py-3">Assigné</th>
                  <th className="text-right font-semibold px-4 py-3">Activité</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(t => (
                  <tr key={t.id} className="transition-colors hover:bg-white/[0.04]" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <td className="px-4 py-3 max-w-[340px]">
                      <Link href={`/admin/support/${t.id}`} className="no-underline block">
                        <span className="flex items-center gap-2">
                          {t.unreadSupport && isOpenStatus(t.status) && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#e8a33d' }} title="Nouveau" />}
                          <span className="font-semibold truncate text-white/90">{t.subject}</span>
                        </span>
                        <span className="text-[11px] font-mono" style={{ color: 'rgba(255,255,255,0.35)' }}>{t.reference} · {CATEGORY_META[t.category].label}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-3"><p className="text-white/80 truncate max-w-[170px]">{t.userName}</p><p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{t.role === 'recruiter' ? 'Recruteur' : t.role === 'hunter' ? 'Chasseur' : 'Candidat'}</p></td>
                    <td className="px-3 py-3"><StatusPill status={t.status} /></td>
                    <td className="px-3 py-3"><span className="text-xs font-semibold" style={{ color: PRIORITY_META[t.priority].color }}>● {PRIORITY_META[t.priority].label}</span></td>
                    <td className="px-3 py-3 text-xs" style={{ color: t.assignee ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.3)' }}>{t.assignee || <span className="inline-flex items-center gap-1"><UserX className="h-3 w-3" />Personne</span>}</td>
                    <td className="px-4 py-3 text-right text-xs whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.45)' }}>{timeAgo(t.lastMessageAt, nowMs)}<br /><span style={{ color: 'rgba(255,255,255,0.3)' }}>{t.lastMessageBy === 'user' ? 'de l’utilisateur' : 'du support'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {filtered.length > PAGE_SIZE && (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>Tickets {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, filtered.length)} sur {filtered.length}</p>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage(current - 1)} disabled={current === 1} aria-label="Page précédente" className="w-9 h-9 rounded-lg flex items-center justify-center disabled:opacity-30" style={fieldStyle}><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-xs px-2" style={{ color: 'rgba(255,255,255,0.6)' }}>{current} / {totalPages}</span>
            <button onClick={() => setPage(current + 1)} disabled={current === totalPages} aria-label="Page suivante" className="w-9 h-9 rounded-lg flex items-center justify-center disabled:opacity-30" style={fieldStyle}><ChevronRight className="h-4 w-4" /></button>
          </div>
        </nav>
      )}
    </div>
  )
}
