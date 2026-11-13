'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Ban, Check, Clock, Copy, Crown, Loader2, Mail, RefreshCw, Search, ShieldCheck, Trash2, UserCheck, UserCog, UserPlus, Users, X,
} from 'lucide-react'
import type { TeamMember } from '@/lib/team'
import { TEAM_ROLE_LABEL, canManageTeam, filterTeam, teamActionDenial, type TeamAction, type TeamListFilter, type TeamRole, type TeamStatus } from '@/lib/team-roles'
import { timeAgoFr } from '@/lib/format-date'
import { inviteUserAction, removeUserAction, resendInviteAction, setUserActiveAction, setUserRoleAction, transferOwnershipAction } from './actions'

// Utilisateurs de l'organisation (demande du 2026-11-13, inspirée de la page Utilisateurs de l'admin) : chiffres,
// recherche et filtres, tableau des comptes avec leur rôle, leur état et les actions permises (team-roles.ts ; le
// serveur revérifie chaque action). La liste vient du serveur : après chaque action, la page est relue.

const STATUS_LABEL: Record<TeamStatus, string> = { active: 'Actif', pending: 'Invitation en attente', disabled: 'Désactivé' }
const STATUS_FILTERS: { value: TeamListFilter['status']; label: string }[] = [
  { value: 'all', label: 'Tous' }, { value: 'active', label: 'Actifs' }, { value: 'pending', label: 'En attente' }, { value: 'disabled', label: 'Désactivés' },
]

const surface = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' } as const
const inputCls = 'w-full h-10 px-3 rounded-lg text-sm outline-none transition-colors focus:border-[var(--color-brand-orange)]'
const smallBtn = 'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-semibold transition-colors hover:bg-[var(--color-background)] disabled:opacity-40'

const initials = (m: TeamMember) => ((m.firstName[0] ?? '') + (m.lastName[0] ?? '') || (m.email[0] ?? '?')).toUpperCase()
const fullName = (m: TeamMember) => `${m.firstName} ${m.lastName}`.trim() || m.email

function RoleBadge({ role }: { role: TeamRole }) {
  const style = role === 'owner'
    ? { background: 'color-mix(in srgb, var(--color-brand-orange) 14%, transparent)', color: 'var(--color-text)' }
    : role === 'admin'
      ? { background: 'color-mix(in srgb, var(--color-text) 9%, transparent)', color: 'var(--color-text)' }
      : { background: 'var(--color-background)', color: 'var(--color-text-muted)' }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={style}>
      {role === 'owner' ? <Crown className="h-3 w-3" aria-hidden /> : role === 'admin' ? <ShieldCheck className="h-3 w-3" aria-hidden /> : null}
      {TEAM_ROLE_LABEL[role]}
    </span>
  )
}

function StatusCell({ m, nowMs }: { m: TeamMember; nowMs: number }) {
  if (m.status === 'pending') {
    const days = m.inviteExpiresAt ? Math.ceil((new Date(m.inviteExpiresAt).getTime() - nowMs) / 86_400_000) : null
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: '#b45309' }}>
        <Clock className="h-3.5 w-3.5" aria-hidden />{STATUS_LABEL.pending}{days !== null ? (days > 0 ? ` · ${days} j` : ' · expirée') : ''}
      </span>
    )
  }
  if (m.status === 'disabled') {
    return <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: '#b91c1c' }}><Ban className="h-3.5 w-3.5" aria-hidden />{STATUS_LABEL.disabled}</span>
  }
  return (
    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
      <span className="font-semibold" style={{ color: '#047857' }}>Actif</span>
      {m.lastAccess ? ` · connecté ${timeAgoFr(m.lastAccess, nowMs)}` : ''}
    </span>
  )
}

export function UsersClient({ members, currentUserId, myRole, rolesAvailable, maxTeamSize, now }: {
  members: TeamMember[]
  currentUserId: string
  myRole: TeamRole
  /** Attribut des administrateurs présent en base : sinon, les rôles ne peuvent pas changer. */
  rolesAvailable: boolean
  maxTeamSize: number
  now: string
}) {
  const router = useRouter()
  const nowMs = new Date(now).getTime()
  const manager = canManageTeam(myRole)
  const [filter, setFilter] = useState<TeamListFilter>({ query: '', status: 'all', role: 'all' })
  const [inviteOpen, setInviteOpen] = useState(false)
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '' })
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string; link?: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [inviting, startInvite] = useTransition()

  const listed = filterTeam(members, filter)
  const stats = {
    active: members.filter(m => m.status === 'active').length,
    admins: members.filter(m => m.role !== 'member').length,
    pending: members.filter(m => m.status === 'pending').length,
    disabled: members.filter(m => m.status === 'disabled').length,
  }
  const can = (action: TeamAction, m: TeamMember) => teamActionDenial(myRole, action, { role: m.role, status: m.status, isSelf: m.userId === currentUserId }) === null

  /**
   * Action sur un compte : message affiché, puis la page est relue dans tous les cas — une action en partie faite
   * (compte supprimé, liste des administrateurs pas mise à jour) ne doit pas laisser une ligne périmée à l'écran.
   */
  async function run(m: TeamMember, work: () => Promise<{ error?: string }>, done?: string) {
    setBusy(m.userId)
    setNotice(null)
    try {
      const res = await work()
      if (res.error) setNotice({ tone: 'err', text: res.error })
      else if (done) setNotice({ tone: 'ok', text: done })
      router.refresh()
    } catch {
      setNotice({ tone: 'err', text: 'Le serveur ne répond pas : vérifiez votre connexion puis réessayez.' })
    } finally {
      setBusy(null)
    }
  }

  function invite(e: React.FormEvent) {
    e.preventDefault()
    setNotice(null)
    startInvite(async () => {
      try {
        const res = await inviteUserAction(form)
        if (res.error || !res.member) { setNotice({ tone: 'err', text: res.error ?? 'Invitation impossible.' }); return }
        setForm({ firstName: '', lastName: '', email: '' })
        setInviteOpen(false)
        setNotice(res.emailSent
          ? { tone: 'ok', text: `Invitation envoyée à ${res.member.email}. Le lien est valable 7 jours.` }
          : { tone: 'warn', text: 'Le compte est créé mais l’e-mail n’a pas pu partir. Transmettez ce lien à la personne :', link: res.inviteUrl })
        router.refresh()
      } catch {
        setNotice({ tone: 'err', text: 'Le serveur ne répond pas : vérifiez votre connexion puis réessayez.' })
      }
    })
  }

  async function resend(m: TeamMember) {
    setBusy(m.userId)
    setNotice(null)
    try {
      const res = await resendInviteAction(m.userId)
      if (res.error) setNotice({ tone: 'err', text: res.error })
      else setNotice(res.emailSent ? { tone: 'ok', text: `Nouvelle invitation envoyée à ${m.email}.` } : { tone: 'warn', text: 'L’e-mail n’a pas pu partir. Transmettez ce lien :', link: res.inviteUrl })
      // Nouvelle échéance de l'invitation (7 jours) : la ligne doit la montrer.
      router.refresh()
    } catch {
      setNotice({ tone: 'err', text: 'Le serveur ne répond pas : vérifiez votre connexion puis réessayez.' })
    } finally {
      setBusy(null)
    }
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setNotice({ tone: 'warn', text: 'Copie impossible dans ce navigateur : sélectionnez le lien et copiez-le.', link })
    }
  }

  const noticeColors = {
    ok: { background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', color: '#047857' },
    warn: { background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)', color: '#92400e' },
    err: { background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)', color: '#b91c1c' },
  }

  const actionsFor = (m: TeamMember) => {
    const isBusy = busy === m.userId
    return (
      <div className="flex items-center gap-1 flex-wrap justify-end">
        {can('resend', m) && (
          <button type="button" onClick={() => resend(m)} disabled={isBusy} className={smallBtn} style={{ color: 'var(--color-text)' }}>
            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Renvoyer
          </button>
        )}
        {can('disable', m) && (
          <button type="button" disabled={isBusy} className={smallBtn} style={{ color: 'var(--color-text)' }}
            onClick={() => window.confirm(`Désactiver le compte de ${fullName(m)} ? La personne est déconnectée et ne peut plus se connecter ; ses données restent.`)
              && run(m, () => setUserActiveAction(m.userId, false), `Compte de ${fullName(m)} désactivé.`)}>
            <Ban className="h-3.5 w-3.5" /> Désactiver
          </button>
        )}
        {can('enable', m) && (
          <button type="button" disabled={isBusy} className={smallBtn} style={{ color: 'var(--color-text)' }}
            onClick={() => run(m, () => setUserActiveAction(m.userId, true), `Compte de ${fullName(m)} réactivé.`)}>
            <UserCheck className="h-3.5 w-3.5" /> Réactiver
          </button>
        )}
        {can('transfer', m) && (
          <button type="button" disabled={isBusy} className={smallBtn} style={{ color: 'var(--color-text)' }}
            onClick={() => window.confirm(`Transférer la propriété de l’organisation à ${fullName(m)} ? Vous deviendrez membre : seul le nouveau propriétaire pourra vous rendre des droits.`)
              && run(m, () => transferOwnershipAction(m.userId), `${fullName(m)} est maintenant propriétaire de l’organisation.`)}>
            <Crown className="h-3.5 w-3.5" /> Faire propriétaire
          </button>
        )}
        {can('remove', m) && (
          <button type="button" disabled={isBusy} aria-label={`Retirer ${fullName(m)}`} title="Retirer de l’organisation"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:bg-[rgba(239,68,68,0.08)] disabled:opacity-40" style={{ color: '#b91c1c' }}
            onClick={() => window.confirm(`Retirer ${fullName(m)} de l’organisation ? Son compte est supprimé immédiatement.`)
              && run(m, () => removeUserAction(m.userId), `${fullName(m)} a été retiré de l’organisation.`)}>
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        )}
      </div>
    )
  }

  const roleCell = (m: TeamMember) => (can('setRole', m) && rolesAvailable ? (
    <label className="inline-flex items-center">
      <span className="sr-only">Rôle de {fullName(m)}</span>
      <select value={m.role} disabled={busy === m.userId} className="h-8 px-2 rounded-lg text-xs font-semibold outline-none" style={{ ...surface, color: 'var(--color-text)' }}
        onChange={e => run(m, () => setUserRoleAction(m.userId, e.target.value), `Rôle de ${fullName(m)} mis à jour.`)}>
        <option value="admin">{TEAM_ROLE_LABEL.admin}</option>
        <option value="member">{TEAM_ROLE_LABEL.member}</option>
      </select>
    </label>
  ) : <RoleBadge role={m.role} />)

  return (
    <div className="min-h-[calc(100vh-68px)]" style={{ background: 'var(--color-surface)' }}>
      <header className="flex items-center gap-3 flex-wrap min-h-16 px-4 sm:px-6 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <UserCog className="h-5 w-5 shrink-0" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />
        {/* Taille écrite ici : la règle globale des titres (globals.css, modèle du site) l'emporte sur les classes. */}
        <h1 style={{ color: 'var(--color-text)', fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 }}>Utilisateurs</h1>
        <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{members.length} / {maxTeamSize}</span>
        <span className="flex-1" />
        {manager && (
          <button type="button" onClick={() => setInviteOpen(v => !v)} aria-expanded={inviteOpen} disabled={members.length >= maxTeamSize}
            title={members.length >= maxTeamSize ? `Votre organisation est limitée à ${maxTeamSize} utilisateurs.` : undefined}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-40" style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
            <UserPlus className="h-4 w-4" aria-hidden /> Inviter un utilisateur
          </button>
        )}
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {inviteOpen && manager && (
          <section className="rounded-2xl p-5" style={surface} aria-labelledby="invite-title">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 id="invite-title" style={{ color: 'var(--color-text)', fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 }}>Inviter un utilisateur</h2>
                <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Il reçoit un e-mail pour créer son mot de passe et rejoint l’organisation comme membre.</p>
              </div>
              <button type="button" onClick={() => setInviteOpen(false)} aria-label="Fermer" className="p-1.5 rounded-lg" style={{ color: 'var(--color-text-muted)' }}><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={invite} className="grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr_auto] items-end">
              <label className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Prénom
                <input required value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} maxLength={100} className={`${inputCls} mt-1.5 font-normal`} style={{ ...surface, color: 'var(--color-text)' }} />
              </label>
              <label className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Nom
                <input required value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} maxLength={100} className={`${inputCls} mt-1.5 font-normal`} style={{ ...surface, color: 'var(--color-text)' }} />
              </label>
              <label className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Adresse e-mail professionnelle
                <input required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} maxLength={254} className={`${inputCls} mt-1.5 font-normal`} style={{ ...surface, color: 'var(--color-text)' }} />
              </label>
              <button type="submit" disabled={inviting} className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg text-sm font-bold disabled:opacity-50" style={{ background: 'var(--color-text)', color: 'var(--color-surface)' }}>
                {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} {inviting ? 'Envoi…' : 'Envoyer l’invitation'}
              </button>
            </form>
          </section>
        )}

        {notice && (
          <div role={notice.tone === 'err' ? 'alert' : 'status'} className="rounded-xl p-3.5 text-sm" style={noticeColors[notice.tone]}>
            <p>{notice.text}</p>
            {notice.link && (
              <div className="flex items-center gap-2 mt-2">
                <label className="sr-only" htmlFor="invite-link">Lien d’invitation</label>
                <input id="invite-link" readOnly value={notice.link} onFocus={e => e.currentTarget.select()} className="flex-1 min-w-0 h-9 px-3 rounded-lg text-xs outline-none" style={{ ...surface, color: 'var(--color-text)' }} />
                <button type="button" onClick={() => copyLink(notice.link ?? '')} className="inline-flex items-center gap-1 h-9 px-3 rounded-lg text-xs font-bold" style={{ background: 'var(--color-text)', color: 'var(--color-surface)' }}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Copié' : 'Copier'}
                </button>
              </div>
            )}
          </div>
        )}

        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Comptes actifs', value: stats.active, icon: Users },
            { label: 'Propriétaire et administrateurs', value: stats.admins, icon: ShieldCheck },
            { label: 'Invitations en attente', value: stats.pending, icon: Clock },
            { label: 'Comptes désactivés', value: stats.disabled, icon: Ban },
          ].map(s => (
            <div key={s.label} className="rounded-2xl p-4 flex items-center gap-3" style={surface}>
              <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--color-background)', color: 'var(--color-text)' }}>
                <s.icon className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <dd className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>{s.value}</dd>
                <dt className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{s.label}</dt>
              </div>
            </div>
          ))}
        </dl>

        {!manager && (
          <p className="flex items-start gap-2 rounded-xl p-3.5 text-sm" style={{ ...surface, color: 'var(--color-text-muted)' }}>
            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
            Seuls le propriétaire et les administrateurs de l’organisation peuvent inviter, désactiver ou retirer des utilisateurs.
          </p>
        )}
        {myRole === 'owner' && !rolesAvailable && (
          <p role="status" className="rounded-xl p-3.5 text-sm" style={noticeColors.warn}>
            Les rôles d’administrateur ne sont pas encore activés sur la plateforme : vous restez seul à gérer les utilisateurs. Contactez le support.
          </p>
        )}

        <section className="rounded-2xl overflow-hidden" style={surface} aria-label="Utilisateurs de l’organisation">
          <div className="flex items-center gap-2 flex-wrap px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="relative flex-1 min-w-[14rem]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--color-text-muted)' }} aria-hidden />
              <label htmlFor="users-search" className="sr-only">Rechercher un utilisateur</label>
              <input id="users-search" value={filter.query} onChange={e => setFilter(f => ({ ...f, query: e.target.value }))} placeholder="Rechercher par nom ou e-mail…"
                className={`${inputCls} pl-9`} style={{ ...surface, color: 'var(--color-text)' }} />
            </div>
            <div className="inline-flex rounded-lg p-0.5" role="group" aria-label="État du compte" style={{ background: 'var(--color-background)' }}>
              {STATUS_FILTERS.map(s => (
                <button key={s.value} type="button" onClick={() => setFilter(f => ({ ...f, status: s.value }))} aria-pressed={filter.status === s.value}
                  className="h-8 px-3 rounded-md text-xs font-semibold whitespace-nowrap"
                  style={filter.status === s.value ? { ...surface, color: 'var(--color-text)' } : { color: 'var(--color-text-muted)' }}>
                  {s.label}
                </button>
              ))}
            </div>
            <label className="inline-flex items-center">
              <span className="sr-only">Rôle</span>
              <select value={filter.role} onChange={e => setFilter(f => ({ ...f, role: e.target.value as TeamListFilter['role'] }))}
                className="h-10 px-2.5 rounded-lg text-sm outline-none" style={{ ...surface, color: 'var(--color-text)' }}>
                <option value="all">Tous les rôles</option>
                <option value="owner">{TEAM_ROLE_LABEL.owner}</option>
                <option value="admin">Administrateurs</option>
                <option value="member">Membres</option>
              </select>
            </label>
          </div>

          {listed.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>Aucun utilisateur ne correspond à cette recherche.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="hidden md:table-header-group">
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Utilisateur', 'Rôle', 'État', ''].map((h, i) => (
                    <th key={i} scope="col" className={`px-4 py-2.5 text-xs font-semibold ${i === 3 ? 'text-right' : 'text-left'}`} style={{ color: 'var(--color-text-muted)' }}>
                      {h || <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listed.map(m => (
                  // Sous 768 px, chaque ligne s'empile : nom, puis rôle et état, puis actions (le choix du rôle écrasait le nom).
                  <tr key={m.userId} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-3 md:table-row md:p-0" style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="col-span-2 md:px-4 md:py-3 min-w-0">
                      <div className="flex items-center gap-3 min-w-0">
                        <span aria-hidden className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'var(--color-background)', color: 'var(--color-text)' }}>{initials(m)}</span>
                        <div className="min-w-0">
                          <p className="font-semibold truncate" style={{ color: m.status === 'disabled' ? 'var(--color-text-muted)' : 'var(--color-text)' }}>
                            {fullName(m)}
                            {m.userId === currentUserId && <span className="ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-background)', color: 'var(--color-text-muted)' }}>Vous</span>}
                          </p>
                          <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>{m.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="md:px-4 md:py-3">{roleCell(m)}</td>
                    <td className="md:px-4 md:py-3"><StatusCell m={m} nowMs={nowMs} /></td>
                    <td className="col-span-2 md:px-4 md:py-3">{manager ? actionsFor(m) : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}
