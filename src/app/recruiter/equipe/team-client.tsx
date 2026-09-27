'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Users, UserPlus, Crown, Mail, Copy, Check, Loader2, Trash2, RefreshCw, Clock, ShieldCheck,
  Briefcase, BarChart3, History, Kanban, FolderOpen, Video, Brain, ArrowRight,
} from 'lucide-react'
import type { TeamMember } from '@/lib/team'
import type { ActivityItem } from './data'
import { inviteMemberAction, removeMemberAction, resendInviteAction } from './actions'

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6']
const colorFor = (s: string) => AVATAR_COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length]
const initials = (m: { firstName: string; lastName: string; email?: string }) =>
  ((m.firstName[0] ?? '') + (m.lastName[0] ?? '') || (m.email?.[0] ?? '?')).toUpperCase()

function timeAgo(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'à l’instant'
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`
  if (s < 86400 * 7) return `il y a ${Math.floor(s / 86400)} j`
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

const inputCls = 'w-full px-3.5 py-2.5 rounded-xl text-sm outline-none transition-shadow focus:shadow-[0_0_0_3px_rgba(232,163,61,0.25)]'
const inputStyle = { background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' } as const

function Avatar({ label, name, size = 40 }: { label: string; name: string; size?: number }) {
  return (
    <span className="rounded-full flex items-center justify-center font-bold shrink-0" style={{ width: size, height: size, background: `${colorFor(name)}1f`, color: colorFor(name), fontSize: size * 0.36 }}>
      {label}
    </span>
  )
}

export function TeamClient({ members: initialMembers, activity, currentUserId, isOwner, now }: {
  members: TeamMember[]; activity: ActivityItem[]; currentUserId: string; isOwner: boolean; now: string
}) {
  const [members, setMembers] = useState(initialMembers)
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '' })
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string; link?: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const nowMs = new Date(now).getTime()

  function invite(e: React.FormEvent) {
    e.preventDefault()
    setNotice(null)
    startTransition(async () => {
      const res = await inviteMemberAction(form)
      if (res.error || !res.member) { setNotice({ tone: 'err', text: res.error ?? 'Erreur lors de l’invitation' }); return }
      setMembers(m => [...m, res.member!])
      setForm({ firstName: '', lastName: '', email: '' })
      setNotice(res.emailSent
        ? { tone: 'ok', text: `Invitation envoyée à ${res.member.email}. Le lien est valable 7 jours.` }
        : { tone: 'warn', text: 'Le compte est créé mais l’email n’a pas pu partir. Transmettez ce lien à la personne :', link: res.inviteUrl })
    })
  }

  async function resend(m: TeamMember) {
    setBusy(m.userId); setNotice(null)
    const res = await resendInviteAction(m.userId)
    setBusy(null)
    if (res.error) setNotice({ tone: 'err', text: res.error })
    else setNotice(res.emailSent ? { tone: 'ok', text: `Nouvelle invitation envoyée à ${m.email}.` } : { tone: 'warn', text: 'L’email n’a pas pu partir. Transmettez ce lien :', link: res.inviteUrl })
  }

  async function remove(m: TeamMember) {
    if (!window.confirm(`Retirer ${m.firstName} ${m.lastName} de l’équipe ? Son accès sera supprimé immédiatement.`)) return
    setBusy(m.userId); setNotice(null)
    const res = await removeMemberAction(m.userId)
    setBusy(null)
    if (res.error) setNotice({ tone: 'err', text: res.error })
    else setMembers(ms => ms.filter(x => x.userId !== m.userId))
  }

  async function copy(text: string, key: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1800) } catch { /* presse-papiers indisponible */ }
  }

  const noticeStyle = {
    ok: { bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)', color: '#047857' },
    warn: { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.35)', color: '#92400e' },
    err: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.3)', color: '#b91c1c' },
  }

  const shared = [
    { icon: <Briefcase className="h-4 w-4" />, text: 'Annonces et candidatures' },
    { icon: <Kanban className="h-4 w-4" />, text: 'Pipelines et matching IA' },
    { icon: <Video className="h-4 w-4" />, text: 'Entretiens IA et analyses' },
    { icon: <BarChart3 className="h-4 w-4" />, text: 'Reporting et rapports PDF' },
    { icon: <History className="h-4 w-4" />, text: 'Historique des actions' },
    { icon: <Brain className="h-4 w-4" />, text: 'Page marque employeur' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <Link href="/recruiter/dashboard" className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80" style={{ color: 'rgba(255,255,255,0.55)' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Retour à l&apos;espace recruteur
          </Link>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,163,61,0.15)' }}>
              <Users className="h-6 w-6" style={{ color: 'var(--color-primary)' }} />
            </div>
            <div>
              <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>Mon équipe</h1>
              <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>Invitez vos collaborateurs : ils partagent vos annonces, rapports et historique</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 grid lg:grid-cols-[1fr_380px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          {/* ── Membres ── */}
          <section className="rounded-3xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 16px 40px -22px rgba(11,29,81,0.18)' }}>
            <div className="px-5 sm:px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <h2 className="font-bold" style={{ color: 'var(--color-text)', fontSize: '1rem' }}>Membres ({members.length})</h2>
            </div>
            <ul>
              {members.map(m => {
                const name = `${m.firstName} ${m.lastName}`.trim() || m.email
                const daysLeft = m.inviteExpiresAt ? Math.ceil((new Date(m.inviteExpiresAt).getTime() - nowMs) / 86_400_000) : null
                return (
                  <li key={m.userId} className="px-5 sm:px-6 py-4 flex items-center gap-3.5 flex-wrap" style={{ borderTop: '1px solid var(--color-border)' }}>
                    <Avatar label={initials(m)} name={name} />
                    <div className="min-w-0 flex-1" style={{ minWidth: 180 }}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{name}</p>
                        {m.userId === currentUserId && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(11,29,81,0.07)', color: 'var(--color-text-muted)' }}>Vous</span>}
                        {m.isOwner
                          ? <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(232,163,61,0.16)', color: '#b8862f' }}><Crown className="h-3 w-3" />Propriétaire</span>
                          : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(99,102,241,0.1)', color: '#4f46e5' }}>Membre</span>}
                        {m.status === 'pending' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.14)', color: '#b45309' }}>
                            <Clock className="h-3 w-3" />Invitation en attente{daysLeft !== null && daysLeft > 0 ? ` · ${daysLeft} j` : daysLeft !== null ? ' · expirée' : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>
                        {m.email}{m.lastAccess && m.status === 'active' ? ` · dernière connexion ${timeAgo(m.lastAccess, nowMs)}` : ''}
                      </p>
                    </div>
                    {isOwner && !m.isOwner && (
                      <div className="flex items-center gap-1.5">
                        {m.status === 'pending' && (
                          <button onClick={() => resend(m)} disabled={busy === m.userId} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-opacity hover:opacity-80 disabled:opacity-50" style={{ background: 'rgba(232,163,61,0.14)', color: '#b8862f' }}>
                            {busy === m.userId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Renvoyer
                          </button>
                        )}
                        <button onClick={() => remove(m)} disabled={busy === m.userId} aria-label={`Retirer ${name}`} className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[rgba(239,68,68,0.1)] disabled:opacity-50" style={{ color: '#ef4444' }}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>

          {/* ── Invitation ── */}
          {isOwner ? (
            <section className="rounded-3xl p-5 sm:p-6" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 16px 40px -22px rgba(11,29,81,0.18)' }}>
              <div className="flex items-start gap-3 mb-4">
                <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,163,61,0.14)', color: 'var(--color-primary)' }}><UserPlus className="h-4 w-4" /></span>
                <div>
                  <h2 className="font-bold" style={{ color: 'var(--color-text)', fontSize: '1rem' }}>Inviter un collaborateur</h2>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Il reçoit un email pour créer son mot de passe et rejoint immédiatement votre espace.</p>
                </div>
              </div>
              <form onSubmit={invite} className="grid sm:grid-cols-2 gap-3">
                <input className={inputCls} style={inputStyle} required placeholder="Prénom" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
                <input className={inputCls} style={inputStyle} required placeholder="Nom" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
                <input className={`${inputCls} sm:col-span-2`} style={inputStyle} required type="email" placeholder="Adresse email professionnelle" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                <div className="sm:col-span-2 flex items-center justify-end">
                  <button type="submit" disabled={pending} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-opacity disabled:opacity-50" style={{ background: 'var(--color-primary)', color: 'white' }}>
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                    {pending ? 'Envoi…' : 'Envoyer l’invitation'}
                  </button>
                </div>
              </form>
              {notice && (
                <div className="mt-4 rounded-xl p-3.5 text-sm" style={{ background: noticeStyle[notice.tone].bg, border: `1px solid ${noticeStyle[notice.tone].border}`, color: noticeStyle[notice.tone].color }}>
                  <p>{notice.text}</p>
                  {notice.link && (
                    <div className="flex items-center gap-2 mt-2">
                      <input readOnly value={notice.link} onFocus={e => e.currentTarget.select()} className="flex-1 min-w-0 px-3 py-2 rounded-lg text-xs outline-none" style={{ background: 'white', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
                      <button type="button" onClick={() => copy(notice.link!, 'notice')} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold" style={{ background: 'var(--hero-bg)', color: 'white' }}>
                        {copied === 'notice' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied === 'notice' ? 'Copié' : 'Copier'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          ) : (
            <div className="rounded-2xl p-4 flex items-start gap-3 text-sm" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
              <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" style={{ color: 'var(--color-primary)' }} />
              Seul le propriétaire du compte peut inviter ou retirer des membres.
            </div>
          )}

          {/* ── Historique ── */}
          <section className="rounded-3xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 16px 40px -22px rgba(11,29,81,0.18)' }}>
            <div className="px-5 sm:px-6 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <History className="h-4 w-4" style={{ color: 'var(--color-primary)' }} />
              <h2 className="font-bold" style={{ color: 'var(--color-text)', fontSize: '1rem' }}>Historique de l&apos;équipe</h2>
            </div>
            {activity.length === 0 ? (
              <p className="px-6 py-10 text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>Aucune action pour le moment. Les mouvements dans vos pipelines apparaîtront ici.</p>
            ) : (
              <ul>
                {activity.map(a => {
                  const who = a.actor ?? 'Un membre de l’équipe'
                  return (
                    <li key={a.id} className="px-5 sm:px-6 py-3.5 flex items-start gap-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                      <Avatar label={a.actor ? (a.actor.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()) : '·'} name={who} size={34} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-snug" style={{ color: 'var(--color-text)' }}>
                          <strong>{who}</strong>{' '}
                          {a.kind === 'screening' && <>a lancé le screening IA de <strong>{a.candidate}</strong></>}
                          {a.kind === 'interview' && <>a envoyé un entretien IA à <strong>{a.candidate}</strong></>}
                          {a.kind === 'contact' && <>a contacté <strong>{a.candidate}</strong> sur WhatsApp</>}
                          {a.kind === 'stage_change' && <>a déplacé <strong>{a.candidate}</strong> vers <span className="font-semibold" style={{ color: a.stageColor }}>{a.stageLabel}</span></>}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                          {a.jobTitle}{a.note ? ` · ${a.note}` : ''} · {timeAgo(a.at, nowMs)}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>

        {/* ── Colonne latérale ── */}
        <aside className="space-y-4 lg:sticky lg:top-[84px] min-w-0">
          <div className="rounded-3xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p className="font-bold text-sm mb-3" style={{ color: 'var(--color-text)' }}>Ce que partage l&apos;équipe</p>
            <ul className="space-y-2.5">
              {shared.map(s => (
                <li key={s.text} className="flex items-center gap-2.5 text-sm" style={{ color: 'var(--color-text)' }}>
                  <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'rgba(16,185,129,0.1)', color: '#059669' }}>{s.icon}</span>{s.text}
                </li>
              ))}
            </ul>
            <div className="mt-4 pt-4 flex items-start gap-2.5 text-xs" style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
              <FolderOpen className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Reste personnel : chaque membre garde son propre <strong>vivier de CV</strong> et sa boîte de réception des notifications.</span>
            </div>
          </div>
          <Link href="/recruiter/marque-employeur" className="group flex items-center justify-between gap-3 rounded-3xl p-5 no-underline transition-colors hover:border-[var(--color-primary)]" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div>
              <p className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>Page marque employeur</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Toute l&apos;équipe peut la compléter.</p>
            </div>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" style={{ color: 'var(--color-primary)' }} />
          </Link>
        </aside>
      </div>
    </div>
  )
}
