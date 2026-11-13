'use client'

import Link from 'next/link'
import {
  Users, Crown, Clock, ShieldCheck, Ban, UserCog, Briefcase, BarChart3, History, Kanban, FolderOpen, Video, Brain, ArrowRight,
} from 'lucide-react'
import type { TeamMember } from '@/lib/team'
import { TEAM_ROLE_LABEL } from '@/lib/team-roles'
import { timeAgoFr } from '@/lib/format-date'
import type { ActivityItem } from './data'

// Équipe du recruteur : ses membres (lecture seule) et l'historique partagé de l'équipe. La gestion des comptes
// (inviter, désactiver, rôles, retirer) est sur la page « Utilisateurs » (/recruiter/utilisateurs, 2026-11-13).

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6']
const colorFor = (s: string) => AVATAR_COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length]
const initials = (m: { firstName: string; lastName: string; email?: string }) =>
  ((m.firstName[0] ?? '') + (m.lastName[0] ?? '') || (m.email?.[0] ?? '?')).toUpperCase()

function Avatar({ label, name, size = 40 }: { label: string; name: string; size?: number }) {
  return (
    <span className="rounded-full flex items-center justify-center font-bold shrink-0" style={{ width: size, height: size, background: `${colorFor(name)}1f`, color: colorFor(name), fontSize: size * 0.36 }}>
      {label}
    </span>
  )
}

export function TeamClient({ members, activity, currentUserId, now }: {
  members: TeamMember[]; activity: ActivityItem[]; currentUserId: string; now: string
}) {
  const nowMs = new Date(now).getTime()

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
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid var(--hero-line)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,163,61,0.15)' }}>
              <Users className="h-6 w-6" style={{ color: 'var(--color-primary)' }} />
            </div>
            <div>
              <h1 style={{ color: 'var(--hero-fg)', fontWeight: 300, fontSize: '1.75rem' }}>Mon équipe</h1>
              <p className="text-sm mt-0.5" style={{ color: 'var(--hero-fg-muted)' }}>Vos collaborateurs partagent vos annonces, rapports et historique</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 grid lg:grid-cols-[1fr_380px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          {/* ── Membres (lecture seule) ── */}
          <section className="rounded-3xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 16px 40px -22px rgba(11,29,81,0.18)' }}>
            <div className="px-5 sm:px-6 py-4 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <h2 className="font-bold" style={{ color: 'var(--color-text)', fontSize: '1rem' }}>Membres ({members.length})</h2>
              <Link href="/recruiter/utilisateurs" className="inline-flex items-center gap-1.5 text-sm font-semibold no-underline hover:underline" style={{ color: 'var(--color-brand-orange)' }}>
                <UserCog className="h-4 w-4" aria-hidden /> Gérer les utilisateurs <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
            <ul>
              {members.map(m => {
                const name = `${m.firstName} ${m.lastName}`.trim() || m.email
                return (
                  <li key={m.userId} className="px-5 sm:px-6 py-4 flex items-center gap-3.5 flex-wrap" style={{ borderTop: '1px solid var(--color-border)' }}>
                    <Avatar label={initials(m)} name={name} />
                    <div className="min-w-0 flex-1" style={{ minWidth: 180 }}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{name}</p>
                        {m.userId === currentUserId && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(11,29,81,0.07)', color: 'var(--color-text-muted)' }}>Vous</span>}
                        {m.role === 'owner'
                          ? <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(232,163,61,0.16)', color: '#8a5a12' }}><Crown className="h-3 w-3" />{TEAM_ROLE_LABEL.owner}</span>
                          : m.role === 'admin'
                            ? <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(11,29,81,0.07)', color: 'var(--color-text)' }}><ShieldCheck className="h-3 w-3" />{TEAM_ROLE_LABEL.admin}</span>
                            : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(99,102,241,0.1)', color: '#4f46e5' }}>{TEAM_ROLE_LABEL.member}</span>}
                        {m.status === 'pending' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.14)', color: '#b45309' }}>
                            <Clock className="h-3 w-3" />Invitation en attente
                          </span>
                        )}
                        {m.status === 'disabled' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.08)', color: '#b91c1c' }}>
                            <Ban className="h-3 w-3" />Désactivé
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>
                        {m.email}{m.lastAccess && m.status === 'active' ? ` · dernière connexion ${timeAgoFr(m.lastAccess, nowMs)}` : ''}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>

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
                          {a.jobTitle}{a.note ? ` · ${a.note}` : ''} · {timeAgoFr(a.at, nowMs)}
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
