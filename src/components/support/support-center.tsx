'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ChevronRight, Loader2, LifeBuoy, MessageSquarePlus, Send, X } from 'lucide-react'
import {
  CATEGORY_META, PRIORITY_META, SUPPORT_LIMITS, isOpenStatus,
  type Ticket, type TicketCategory, type TicketPriority,
} from '@/lib/support-shared'
import { createTicketAction } from '@/lib/support-actions'
import { StatusPill } from './ticket-view'
import { AttachmentPicker, useAttachments } from './attachments'

function timeAgo(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'à l’instant'
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`
  if (s < 86400 * 7) return `il y a ${Math.floor(s / 86400)} j`
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

const inputStyle = { background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' } as const

export function SupportCenter({ tickets, basePath, backHref, now }: { tickets: Ticket[]; basePath: string; backHref: string; now: string }) {
  const router = useRouter()
  const [composing, setComposing] = useState(tickets.length === 0)
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('all')
  const [category, setCategory] = useState<TicketCategory>('bug')
  const [priority, setPriority] = useState<TicketPriority>('normal')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [pageUrl, setPageUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const files = useAttachments()
  const nowMs = new Date(now).getTime()

  // Page d'où l'utilisateur vient (aide le support à reproduire le problème).
  useEffect(() => {
    try {
      const ref = document.referrer ? new URL(document.referrer) : null
      if (ref && ref.origin === location.origin && !ref.pathname.includes('/support')) setPageUrl(ref.pathname)
    } catch { /* pas de referrer */ }
  }, [])

  const visible = useMemo(() => tickets.filter(t => filter === 'all' || (filter === 'open' ? isOpenStatus(t.status) : !isOpenStatus(t.status))), [tickets, filter])
  const unread = tickets.filter(t => t.unreadUser).length

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await createTicketAction({ subject, category, priority, body, pageUrl, attachmentIds: files.ids })
      if (res.error || !res.ticket) { setError(res.error ?? 'Erreur lors de l’envoi'); return }
      router.push(`${basePath}/${res.ticket.id}`)
    })
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
          <Link href={backHref} className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80" style={{ color: 'rgba(255,255,255,0.55)' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Retour à mon espace
          </Link>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,163,61,0.15)' }}>
                <LifeBuoy className="h-6 w-6" style={{ color: 'var(--color-primary)' }} />
              </div>
              <div>
                <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>Aide &amp; support</h1>
                <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>Une question, un problème ? Notre équipe vous répond ici et par email.</p>
              </div>
            </div>
            {!composing && (
              <button type="button" onClick={() => setComposing(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-opacity hover:opacity-90" style={{ background: 'var(--color-primary)', color: 'white' }}>
                <MessageSquarePlus className="h-4 w-4" />Nouvelle demande
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {composing && (
          <form onSubmit={submit} className="rounded-3xl p-5 sm:p-6 space-y-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 16px 40px -22px rgba(11,29,81,0.2)' }}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold" style={{ color: 'var(--color-text)', fontSize: '1.05rem' }}>Nouvelle demande</h2>
              {tickets.length > 0 && <button type="button" onClick={() => setComposing(false)} aria-label="Fermer" className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[rgba(0,0,0,0.05)]" style={{ color: 'var(--color-text-muted)' }}><X className="h-4 w-4" /></button>}
            </div>

            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text)' }}>De quoi s&apos;agit-il ?</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(Object.keys(CATEGORY_META) as TicketCategory[]).map(c => (
                  <button key={c} type="button" onClick={() => setCategory(c)} className="text-left rounded-xl p-3 transition-colors"
                    style={category === c ? { background: 'rgba(232,163,61,0.14)', border: '1px solid var(--color-primary)' } : { background: 'var(--color-background)', border: '1px solid var(--color-border)' }}>
                    <p className="text-xs font-bold leading-tight" style={{ color: 'var(--color-text)' }}>{CATEGORY_META[c].label}</p>
                    <p className="text-[10px] mt-1 leading-snug" style={{ color: 'var(--color-text-muted)' }}>{CATEGORY_META[c].hint}</p>
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="flex justify-between text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>Titre de votre demande<span style={{ color: 'var(--color-text-muted)' }}>{subject.length}/{SUPPORT_LIMITS.subject}</span></span>
              <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={SUPPORT_LIMITS.subject} required placeholder="Ex. Je n'arrive pas à publier mon offre"
                className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} />
            </label>

            <label className="block">
              <span className="flex justify-between text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>Décrivez précisément votre demande<span style={{ color: 'var(--color-text-muted)' }}>{body.length}/{SUPPORT_LIMITS.body}</span></span>
              <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={SUPPORT_LIMITS.body} required rows={6}
                placeholder="Ce que vous faisiez, ce que vous attendiez, ce qui s'est passé (message d'erreur, page concernée…)"
                className="w-full px-3.5 py-3 rounded-xl text-sm outline-none resize-y" style={{ ...inputStyle, minHeight: 130 }} />
            </label>

            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Pièces jointes <span className="font-normal" style={{ color: 'var(--color-text-muted)' }}>(capture d'écran, document…)</span></p>
              <AttachmentPicker state={files} />
            </div>

            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Importance</p>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(PRIORITY_META) as TicketPriority[]).map(p => (
                  <button key={p} type="button" onClick={() => setPriority(p)} className="px-3.5 py-2 rounded-full text-xs font-semibold transition-colors"
                    style={priority === p ? { background: `${PRIORITY_META[p].color}22`, border: `1px solid ${PRIORITY_META[p].color}`, color: PRIORITY_META[p].color } : { background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                    {PRIORITY_META[p].userLabel}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm font-medium rounded-lg px-3 py-2" style={{ background: 'rgba(239,68,68,0.08)', color: '#dc2626' }}>{error}</p>}
            <div className="flex items-center justify-end gap-3">
              {tickets.length > 0 && <button type="button" onClick={() => setComposing(false)} className="text-sm font-semibold px-4 py-2.5" style={{ color: 'var(--color-text-muted)' }}>Annuler</button>}
              <button type="submit" disabled={pending || files.uploading > 0} className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-opacity disabled:opacity-50" style={{ background: 'var(--color-primary)', color: 'white' }}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{pending ? 'Envoi…' : 'Envoyer ma demande'}
              </button>
            </div>
          </form>
        )}

        {tickets.length > 0 && (
          <section>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <h2 className="font-bold flex items-center gap-2" style={{ color: 'var(--color-text)', fontSize: '1.05rem' }}>
                Mes demandes
                {unread > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--color-primary)', color: 'white' }}>{unread} réponse{unread > 1 ? 's' : ''}</span>}
              </h2>
              <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                {([['all', 'Toutes'], ['open', 'En cours'], ['done', 'Terminées']] as const).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setFilter(k)} className="px-3.5 py-2 text-xs font-semibold" style={{ background: filter === k ? 'var(--hero-bg)' : 'transparent', color: filter === k ? 'white' : 'var(--color-text-muted)' }}>{l}</button>
                ))}
              </div>
            </div>
            <div className="space-y-2.5">
              {visible.length === 0 && <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-muted)' }}>Aucune demande dans cette catégorie.</p>}
              {visible.map(t => (
                <Link key={t.id} href={`${basePath}/${t.id}`} className="group flex items-center gap-3 rounded-2xl p-4 no-underline transition-colors hover:border-[var(--color-primary)]"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  {t.unreadUser && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: 'var(--color-primary)' }} title="Nouvelle réponse" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-text)' }}>{t.subject}</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                      <span className="font-mono">{t.reference}</span> · {CATEGORY_META[t.category].label} · {timeAgo(t.lastMessageAt, nowMs)}
                    </p>
                  </div>
                  <StatusPill status={t.status} user />
                  <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" style={{ color: 'var(--color-primary)' }} />
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
