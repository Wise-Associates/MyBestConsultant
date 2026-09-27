'use client'

import { useState, useTransition } from 'react'
import { Plus, X, Loader2, Check, AlertCircle, Building2, User, Mail, Lock, Eye, EyeOff } from 'lucide-react'
import { createTenant } from './actions'

export function CreateTenantDialog() {
  const [open, setOpen] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [done, setDone] = useState(false)

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await createTenant(fd)
      if (res.error) { setError(res.error) }
      else { setDone(true); setTimeout(() => { setOpen(false); setDone(false) }, 1200) }
    })
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setError(''); setDone(false) }}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
        style={{ background: '#B8860B', color: 'white', boxShadow: '0 2px 12px rgba(184,134,11,0.35)' }}>
        <Plus className="h-4 w-4" /> Nouveau tenant
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-md rounded-2xl overflow-hidden"
            style={{ background: '#1a1d2e', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(184,134,11,0.15)' }}>
                  <Building2 className="h-4 w-4 text-amber-400" />
                </div>
                <div>
                  <h2 className="font-semibold text-white">Nouveau tenant</h2>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Crée l&apos;entreprise + le compte recruteur</p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg transition-all" style={{ color: 'rgba(255,255,255,0.4)' }}>
                <X className="h-4 w-4" />
              </button>
            </div>

            {done ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="w-12 h-12 rounded-full flex items-center justify-center bg-emerald-500/15">
                  <Check className="h-6 w-6 text-emerald-400" />
                </div>
                <p className="text-white font-semibold">Tenant créé !</p>
              </div>
            ) : (
              <form onSubmit={submit} className="px-6 py-5 space-y-4">

                {error && (
                  <div className="flex items-start gap-2.5 p-3.5 rounded-xl text-sm text-red-400"
                    style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{error}
                  </div>
                )}

                {/* Company name */}
                <div>
                  <label className="text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    <Building2 className="h-3.5 w-3.5" /> Nom de l&apos;entreprise
                  </label>
                  <input name="name" required placeholder="Acme Corp"
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-400/40"
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }} />
                </div>

                {/* Recruiter name */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      <User className="h-3.5 w-3.5" /> Prénom recruteur
                    </label>
                    <input name="firstName" required placeholder="Jean"
                      className="w-full px-3.5 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-400/40"
                      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'rgba(255,255,255,0.5)' }}>Nom</label>
                    <input name="lastName" required placeholder="Dupont"
                      className="w-full px-3.5 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-400/40"
                      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }} />
                  </div>
                </div>

                {/* Email */}
                <div>
                  <label className="text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    <Mail className="h-3.5 w-3.5" /> Email du recruteur
                  </label>
                  <input name="email" type="email" required placeholder="jean@acme.com"
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-400/40"
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }} />
                </div>

                {/* Password */}
                <div>
                  <label className="text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    <Lock className="h-3.5 w-3.5" /> Mot de passe temporaire
                  </label>
                  <div className="relative">
                    <input name="password" type={showPw ? 'text' : 'password'} required placeholder="Min. 8 caractères"
                      className="w-full px-3.5 py-2.5 pr-10 rounded-xl text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-400/40"
                      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }} />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.35)' }}>
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setOpen(false)}
                    className="px-4 py-2 rounded-xl text-sm transition-all" style={{ color: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.06)' }}>
                    Annuler
                  </button>
                  <button type="submit" disabled={isPending}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all"
                    style={{ background: '#B8860B', color: 'white', opacity: isPending ? 0.7 : 1 }}>
                    {isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Création…</> : <><Plus className="h-3.5 w-3.5" />Créer</>}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
