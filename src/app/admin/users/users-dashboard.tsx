'use client'

import { useMemo, useState, useTransition, type CSSProperties } from 'react'
import {
  Users, ShieldCheck, Briefcase, User, Calendar, Building2, Search,
  Plus, X, Loader2, AlertCircle, Power, PowerOff, Trash2, RefreshCcw, UserX,
} from 'lucide-react'
import type { UserRole } from '@/types'
import {
  createUserManually, toggleUserStatus, deleteUserAccount, listAllUsers, type AdminUserRow,
} from './actions'

const ROLE_CONFIG: Record<UserRole, { label: string; accent: string; icon: typeof User }> = {
  admin:     { label: 'Admin',     accent: '#f59e0b', icon: ShieldCheck },
  recruiter: { label: 'Recruteur', accent: '#60a5fa', icon: Briefcase },
  candidate: { label: 'Candidat',  accent: '#34d399', icon: User },
  hunter:    { label: 'Chasseur',  accent: '#a78bfa', icon: Briefcase },
}

const fieldLabel: CSSProperties = { fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }
const inputStyle: CSSProperties = { width: '100%', height: 36, borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)', fontSize: 13, padding: '0 10px', outline: 'none' }

function randomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%'
  let out = ''
  for (let i = 0; i < 14; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

// ── Create user modal ─────────────────────────────────────────────
function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState(randomPassword())
  const [role, setRole] = useState<UserRole>('candidate')
  const [companyName, setCompanyName] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function submit() {
    setError('')
    if (!firstName.trim() || !lastName.trim() || !email.trim() || password.length < 8) {
      setError('Prénom, nom, email et mot de passe (8+ caractères) requis')
      return
    }
    if (role === 'recruiter' && !companyName.trim()) {
      setError('Nom d\'entreprise requis pour un recruteur')
      return
    }
    startTransition(async () => {
      const res = await createUserManually({
        firstName, lastName, email, password, role,
        companyName: role === 'recruiter' ? companyName : undefined,
      })
      if (res.error) { setError(res.error); return }
      onCreated()
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(1,4,18,0.88)', backdropFilter: 'blur(8px)' }}>
      <div style={{ width: '90vw', maxWidth: 460, borderRadius: 20, overflow: 'hidden', background: '#0c0e14', border: '1px solid rgba(255,255,255,0.09)', boxShadow: '0 40px 120px rgba(0,0,0,0.8)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg,rgba(11,29,81,0.9),rgba(22,36,102,0.9))', border: '1px solid rgba(184,134,11,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Plus size={15} color="#B8860B" />
          </div>
          <p style={{ fontWeight: 700, fontSize: 14, color: '#fff', margin: 0 }}>Créer un compte</p>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', display: 'flex' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '70vh', overflowY: 'auto' }}>
          <div>
            <p style={fieldLabel}>Rôle</p>
            <div style={{ display: 'flex', gap: 6 }}>
              {(Object.entries(ROLE_CONFIG) as [UserRole, typeof ROLE_CONFIG['admin']][]).map(([id, cfg]) => (
                <button key={id} type="button" onClick={() => setRole(id)}
                  style={{
                    flex: 1, padding: '8px 10px', borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    border: role === id ? `1px solid ${cfg.accent}80` : '1px solid rgba(255,255,255,0.08)',
                    background: role === id ? `${cfg.accent}18` : 'rgba(255,255,255,0.03)',
                    color: role === id ? cfg.accent : 'rgba(255,255,255,0.45)',
                  }}>
                  <cfg.icon size={13} />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{cfg.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <p style={fieldLabel}>Prénom</p>
              <input value={firstName} onChange={e => setFirstName(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <p style={fieldLabel}>Nom</p>
              <input value={lastName} onChange={e => setLastName(e.target.value)} style={inputStyle} />
            </div>
          </div>

          <div>
            <p style={fieldLabel}>Email</p>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} />
          </div>

          {role === 'recruiter' && (
            <div>
              <p style={fieldLabel}>Entreprise</p>
              <input value={companyName} onChange={e => setCompanyName(e.target.value)} style={inputStyle} placeholder="Nom de l'entreprise" />
            </div>
          )}

          <div>
            <p style={fieldLabel}>Mot de passe</p>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={password} onChange={e => setPassword(e.target.value)} style={{ ...inputStyle, flex: 1, fontFamily: 'monospace' }} />
              <button type="button" onClick={() => setPassword(randomPassword())} title="Générer un mot de passe"
                style={{ width: 36, borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <RefreshCcw size={14} />
              </button>
            </div>
            <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 5, lineHeight: 1.4 }}>
              Le compte est actif immédiatement — transmets ces identifiants à la personne concernée.
            </p>
          </div>

          {error && (
            <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <AlertCircle size={15} color="#f87171" />
              <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{error}</p>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ padding: '10px 16px', borderRadius: 10, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 13, cursor: 'pointer' }}>
            Annuler
          </button>
          <button onClick={submit} disabled={isPending}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 10, background: 'linear-gradient(135deg, #0B1D51, #162466)', border: '1px solid rgba(184,134,11,0.35)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: isPending ? 'default' : 'pointer', opacity: isPending ? 0.6 : 1 }}>
            {isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Créer le compte
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main dashboard ─────────────────────────────────────────────────
export function UsersDashboard({
  initialUsers, loadError, currentUserId,
}: {
  initialUsers: AdminUserRow[]
  loadError?: string
  currentUserId: string
}) {
  const [users, setUsers] = useState<AdminUserRow[]>(initialUsers)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [showCreate, setShowCreate] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<AdminUserRow | null>(null)
  const [rowError, setRowError] = useState('')
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [, startTransition] = useTransition()

  const stats = useMemo(() => ({
    total: users.length,
    admin: users.filter(u => u.role === 'admin').length,
    recruiter: users.filter(u => u.role === 'recruiter').length,
    candidate: users.filter(u => u.role === 'candidate').length,
    active: users.filter(u => u.status).length,
    inactive: users.filter(u => !u.status).length,
  }), [users])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter(u => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (statusFilter === 'active' && !u.status) return false
      if (statusFilter === 'inactive' && u.status) return false
      if (q) {
        const haystack = `${u.firstName} ${u.lastName} ${u.email} ${u.companyName ?? ''}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [users, search, roleFilter, statusFilter])

  function withPending(id: string, fn: () => Promise<void>) {
    setRowError('')
    setPendingIds(prev => new Set(prev).add(id))
    startTransition(async () => {
      await fn()
      setPendingIds(prev => { const s = new Set(prev); s.delete(id); return s })
    })
  }

  function handleToggle(u: AdminUserRow) {
    withPending(u.authId, async () => {
      const res = await toggleUserStatus(u.authId, !u.status)
      if (res.error) { setRowError(res.error); return }
      setUsers(prev => prev.map(x => x.authId === u.authId ? { ...x, status: !x.status } : x))
    })
  }

  function handleDelete(u: AdminUserRow) {
    withPending(u.authId, async () => {
      const res = await deleteUserAccount(u.authId, u.profileId)
      if (res.error) { setRowError(res.error); setConfirmDelete(null); return }
      setUsers(prev => prev.filter(x => x.authId !== u.authId))
      setConfirmDelete(null)
    })
  }

  function handleCreated() {
    setShowCreate(false)
    startTransition(async () => {
      const res = await listAllUsers()
      if (!res.error) setUsers(res.users)
    })
  }

  return (
    <div className="min-h-full p-8 space-y-6" style={{ color: 'rgba(255,255,255,0.87)' }}>

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: 'rgba(255,255,255,0.3)' }}>GESTION</p>
          <h1 className="text-[28px] font-bold tracking-tight text-white">Utilisateurs</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {stats.total} compte{stats.total > 1 ? 's' : ''} enregistré{stats.total > 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 font-semibold text-sm"
          style={{ padding: '11px 18px', borderRadius: 12, background: 'linear-gradient(135deg, rgba(11,29,81,0.9), rgba(22,36,102,0.9))', border: '1px solid rgba(184,134,11,0.35)', color: '#fff', cursor: 'pointer' }}>
          <Plus size={15} />
          Créer un compte
        </button>
      </div>

      {loadError && (
        <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertCircle className="h-4 w-4 shrink-0" style={{ color: '#f87171' }} />
          <p className="text-sm" style={{ color: '#f87171' }}>{loadError}</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Total',      value: stats.total,      icon: Users,       accent: '#B8860B' },
          { label: 'Admins',     value: stats.admin,      icon: ShieldCheck, accent: '#f59e0b' },
          { label: 'Recruteurs', value: stats.recruiter,  icon: Briefcase,   accent: '#60a5fa' },
          { label: 'Candidats',  value: stats.candidate,  icon: User,        accent: '#34d399' },
          { label: 'Inactifs',   value: stats.inactive,   icon: UserX,       accent: '#ef4444' },
        ].map(s => (
          <div key={s.label} className="rounded-2xl p-5 flex items-center gap-4"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${s.accent}18` }}>
              <s.icon className="h-5 w-5" style={{ color: s.accent }} />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{s.value}</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher par nom, email, entreprise…"
            className="w-full text-sm"
            style={{ height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.85)', padding: '0 12px 0 36px', outline: 'none' }}
          />
        </div>

        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value as UserRole | 'all')}
          style={{ height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', padding: '0 12px', fontSize: 13, cursor: 'pointer' }}>
          <option value="all" style={{ background: '#0a0c10' }}>Tous les rôles</option>
          <option value="admin" style={{ background: '#0a0c10' }}>Admin</option>
          <option value="recruiter" style={{ background: '#0a0c10' }}>Recruteur</option>
          <option value="candidate" style={{ background: '#0a0c10' }}>Candidat</option>
        </select>

        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
          style={{ height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', padding: '0 12px', fontSize: 13, cursor: 'pointer' }}>
          <option value="all" style={{ background: '#0a0c10' }}>Tous les statuts</option>
          <option value="active" style={{ background: '#0a0c10' }}>Actifs</option>
          <option value="inactive" style={{ background: '#0a0c10' }}>Inactifs</option>
        </select>
      </div>

      {rowError && (
        <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertCircle className="h-4 w-4 shrink-0" style={{ color: '#f87171' }} />
          <p className="text-sm" style={{ color: '#f87171' }}>{rowError}</p>
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="px-6 py-4 flex items-center justify-between" style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <h2 className="font-semibold text-sm text-white">Comptes</h2>
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{filtered.length} résultat{filtered.length > 1 ? 's' : ''}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {['Utilisateur', 'Rôle', 'Entreprise', 'Statut', 'Inscrit le', ''].map((h, i) => (
                  <th key={i}
                    className={`text-left px-6 py-3 text-xs font-medium whitespace-nowrap ${i === 2 ? 'hidden md:table-cell' : ''} ${i === 4 ? 'hidden lg:table-cell' : ''}`}
                    style={{ color: 'rgba(255,255,255,0.3)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-20" style={{ color: 'rgba(255,255,255,0.25)' }}>
                    <Users className="h-10 w-10 mx-auto mb-3 opacity-20" />
                    <p>Aucun utilisateur ne correspond à ces filtres</p>
                  </td>
                </tr>
              ) : filtered.map(u => {
                const rc = ROLE_CONFIG[u.role] ?? ROLE_CONFIG.candidate
                const RoleIcon = rc.icon
                const initials = `${u.firstName.charAt(0)}${u.lastName.charAt(0)}`.toUpperCase() || '?'
                const isSelf = u.authId === currentUserId
                const isPending = pendingIds.has(u.authId)
                return (
                  <tr key={u.authId} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: u.status ? 1 : 0.55 }}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center font-semibold text-xs shrink-0 text-white"
                          style={{ background: 'rgba(255,255,255,0.08)' }}>
                          {initials}
                        </div>
                        <div>
                          <p className="font-medium text-white flex items-center gap-2">
                            {u.firstName} {u.lastName}
                            {isSelf && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>(vous)</span>}
                          </p>
                          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                        style={{ background: `${rc.accent}15`, color: rc.accent, border: `1px solid ${rc.accent}25` }}>
                        <RoleIcon className="h-3 w-3" />
                        {rc.label}
                      </span>
                    </td>
                    <td className="px-4 py-4 hidden md:table-cell">
                      {u.companyName ? (
                        <span className="flex items-center gap-1.5 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
                          <Building2 className="h-3.5 w-3.5" />
                          {u.companyName}
                        </span>
                      ) : (
                        <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                        style={u.status
                          ? { background: 'rgba(52,211,153,0.12)', color: '#34d399', border: '1px solid rgba(52,211,153,0.25)' }
                          : { background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>
                        {u.status ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td className="px-4 py-4 hidden lg:table-cell">
                      <span className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(u.createdAt).toLocaleDateString('fr-FR')}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          disabled={isSelf || isPending}
                          onClick={() => handleToggle(u)}
                          title={u.status ? 'Désactiver le compte' : 'Activer le compte'}
                          style={{
                            padding: 7, borderRadius: 8, border: 'none', display: 'flex',
                            background: 'rgba(255,255,255,0.05)',
                            color: isSelf ? 'rgba(255,255,255,0.15)' : u.status ? '#f59e0b' : '#34d399',
                            cursor: isSelf || isPending ? 'default' : 'pointer',
                            opacity: isPending ? 0.5 : 1,
                          }}>
                          {isPending ? <Loader2 size={14} className="animate-spin" /> : u.status ? <PowerOff size={14} /> : <Power size={14} />}
                        </button>
                        <button
                          disabled={isSelf || isPending}
                          onClick={() => setConfirmDelete(u)}
                          title="Supprimer le compte"
                          style={{
                            padding: 7, borderRadius: 8, border: 'none', display: 'flex',
                            background: 'rgba(239,68,68,0.08)',
                            color: isSelf ? 'rgba(255,255,255,0.15)' : '#f87171',
                            cursor: isSelf || isPending ? 'default' : 'pointer',
                          }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <CreateUserModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />
      )}

      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(1,4,18,0.88)', backdropFilter: 'blur(8px)' }}>
          <div style={{ width: '90vw', maxWidth: 400, borderRadius: 20, padding: 24, background: '#0c0e14', border: '1px solid rgba(239,68,68,0.25)', boxShadow: '0 40px 120px rgba(0,0,0,0.8)' }}>
            <div className="flex items-center gap-3 mb-3">
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(239,68,68,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 size={16} color="#f87171" />
              </div>
              <p style={{ fontWeight: 700, fontSize: 15, color: '#fff', margin: 0 }}>Supprimer ce compte ?</p>
            </div>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5, marginBottom: 20 }}>
              <strong style={{ color: 'rgba(255,255,255,0.8)' }}>{confirmDelete.firstName} {confirmDelete.lastName}</strong> ({confirmDelete.email}) sera définitivement supprimé. Cette action est irréversible.
            </p>
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)} style={{ padding: '9px 16px', borderRadius: 10, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 13, cursor: 'pointer' }}>
                Annuler
              </button>
              <button onClick={() => handleDelete(confirmDelete)}
                disabled={pendingIds.has(confirmDelete.authId)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, background: '#dc2626', border: 'none', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                {pendingIds.has(confirmDelete.authId) ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Supprimer définitivement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
