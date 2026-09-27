'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { AlertCircle, CheckCircle2, FileText, Loader2, MapPin, Pencil, Search, Send, Trash2, Upload, X } from 'lucide-react'
import type { HunterProfile } from '@/lib/hunter'
import { deleteProfileAction, importCvAction, updateProfileAction } from '../actions'

type UploadItem = { key: string; name: string; status: 'uploading' | 'done' | 'warn' | 'error'; note?: string }

const inputCls = 'w-full px-3.5 py-2.5 rounded-xl text-sm outline-none'
const inputStyle = { background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' } as const
const initials = (p: HunterProfile) => `${p.firstName[0] ?? ''}${p.lastName[0] ?? ''}`.toUpperCase() || '?'

export function VivierClient({ initial }: { initial: HunterProfile[] }) {
  const [profiles, setProfiles] = useState(initial)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<HunterProfile | null>(null)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return profiles.filter(p => !q || `${p.firstName} ${p.lastName} ${p.title} ${p.city} ${p.skills.join(' ')}`.toLowerCase().includes(q))
  }, [profiles, query])

  async function importFiles(files: File[]) {
    for (const file of files) {
      const key = `${file.name}-${Date.now()}-${Math.random()}`
      setUploads(u => [...u, { key, name: file.name, status: 'uploading' }])
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await importCvAction(fd)
        if (res.error || !res.profile) setUploads(u => u.map(x => x.key === key ? { ...x, status: 'error', note: res.error ?? 'Échec' } : x))
        else {
          setProfiles(p => [res.profile!, ...p])
          setUploads(u => u.map(x => x.key === key ? { ...x, status: res.extracted ? 'done' : 'warn', note: res.extracted ? 'Profil lu par l’IA' : 'CV enregistré — complétez le profil à la main' } : x))
        }
      } catch {
        setUploads(u => u.map(x => x.key === key ? { ...x, status: 'error', note: 'Échec de l’envoi' } : x))
      }
    }
  }

  async function remove(p: HunterProfile) {
    if (!window.confirm(`Supprimer le profil de ${p.firstName} ${p.lastName} de votre vivier ?`)) return
    const res = await deleteProfileAction(p.id)
    if (res.error) window.alert(res.error)
    else setProfiles(list => list.filter(x => x.id !== p.id))
  }

  return (
    <div className="space-y-6">
      {/* ── Import ── */}
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); void importFiles([...e.dataTransfer.files]) }}
        onClick={() => input.current?.click()}
        className="rounded-3xl p-8 sm:p-10 text-center cursor-pointer transition-all"
        style={{ background: drag ? 'rgba(20,184,166,0.1)' : 'var(--color-surface)', border: `2px dashed ${drag ? '#14b8a6' : 'var(--color-border)'}` }}>
        <input ref={input} type="file" multiple accept=".pdf,.doc,.docx" className="hidden" onChange={e => { const f = [...(e.target.files ?? [])]; e.target.value = ''; void importFiles(f) }} />
        <span className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-3" style={{ background: 'rgba(20,184,166,0.14)', color: '#0d9488' }}><Upload className="h-7 w-7" /></span>
        <p className="font-bold" style={{ color: 'var(--color-text)', fontSize: '1.05rem' }}>Glissez vos CV ici, ou cliquez pour parcourir</p>
        <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-muted)' }}>PDF, DOC, DOCX · plusieurs fichiers à la fois · 10 Mo max chacun · l’IA en extrait le nom, les coordonnées et les compétences</p>
      </div>

      {uploads.length > 0 && (
        <ul className="space-y-2">
          {uploads.map(u => (
            <li key={u.key} className="flex items-center gap-3 px-4 py-3 rounded-2xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              {u.status === 'uploading' && <Loader2 className="h-4 w-4 animate-spin shrink-0" style={{ color: '#14b8a6' }} />}
              {u.status === 'done' && <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: '#10b981' }} />}
              {u.status === 'warn' && <AlertCircle className="h-4 w-4 shrink-0" style={{ color: '#f59e0b' }} />}
              {u.status === 'error' && <AlertCircle className="h-4 w-4 shrink-0" style={{ color: '#ef4444' }} />}
              <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{u.name}</span>
              <span className="text-xs ml-auto shrink-0" style={{ color: u.status === 'error' ? '#ef4444' : 'var(--color-text-muted)' }}>{u.status === 'uploading' ? 'Analyse du CV…' : u.note}</span>
            </li>
          ))}
        </ul>
      )}

      {/* ── Liste ── */}
      {profiles.length > 0 && (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2.5 px-4 rounded-xl flex-1 min-w-[220px]" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <Search className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-muted)' }} />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher un nom, un poste, une compétence, une ville…" className="w-full py-3 text-sm outline-none bg-transparent" style={{ color: 'var(--color-text)' }} />
            </div>
            <p className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>{visible.length} profil{visible.length > 1 ? 's' : ''}</p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {visible.map(p => (
              <article key={p.id} className="rounded-3xl p-5 flex flex-col" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 12px 32px -20px rgba(11,29,81,0.2)' }}>
                <div className="flex items-start gap-3.5">
                  <span className="w-12 h-12 rounded-2xl flex items-center justify-center font-bold shrink-0" style={{ background: 'rgba(20,184,166,0.16)', color: '#0d9488' }}>{initials(p)}</span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold truncate" style={{ color: 'var(--color-text)', fontSize: '1.02rem' }}>{p.firstName} {p.lastName}</h3>
                    <p className="text-sm truncate" style={{ color: p.title ? 'var(--color-text)' : 'var(--color-text-muted)' }}>{p.title || 'Poste à préciser'}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {p.city && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{p.city}</span>}
                      {p.yearsOfExperience !== null && <span>{p.yearsOfExperience} an{p.yearsOfExperience > 1 ? 's' : ''} d’exp.</span>}
                      {p.rate && <span>{p.rate}</span>}
                      {p.availability && <span>Dispo : {p.availability}</span>}
                    </div>
                  </div>
                </div>
                {p.skills.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3.5">
                    {p.skills.slice(0, 8).map(s => <span key={s} className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(11,29,81,0.06)', color: 'var(--color-text)' }}>{s}</span>)}
                    {p.skills.length > 8 && <span className="text-[11px] font-semibold px-2 py-1" style={{ color: 'var(--color-text-muted)' }}>+{p.skills.length - 8}</span>}
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 mt-4 pt-4 flex-wrap" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <span className="text-xs font-semibold" style={{ color: p.proposals > 0 ? '#3b82f6' : 'var(--color-text-muted)' }}>{p.proposals > 0 ? `Proposé ${p.proposals} fois` : 'Jamais proposé'}</span>
                  <div className="flex items-center gap-1.5">
                    {p.cvFileId && <a href={`/api/cv/${p.cvFileId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold no-underline" style={{ background: 'rgba(11,29,81,0.06)', color: 'var(--color-text)' }}><FileText className="h-3.5 w-3.5" />CV</a>}
                    <button type="button" onClick={() => setEditing(p)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold" style={{ background: 'rgba(11,29,81,0.06)', color: 'var(--color-text)' }}><Pencil className="h-3.5 w-3.5" />Modifier</button>
                    <Link href="/hunter/offres" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold no-underline" style={{ background: '#14b8a6', color: 'white' }}><Send className="h-3.5 w-3.5" />Proposer</Link>
                    <button type="button" onClick={() => remove(p)} aria-label="Supprimer" className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[rgba(239,68,68,0.1)]" style={{ color: '#ef4444' }}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {profiles.length === 0 && uploads.length === 0 && (
        <p className="text-center text-sm py-6" style={{ color: 'var(--color-text-muted)' }}>Votre vivier est vide. Importez vos premiers CV pour commencer à proposer des profils.</p>
      )}

      {editing && <ProfileEditor profile={editing} onClose={() => setEditing(null)} onSaved={p => { setProfiles(list => list.map(x => x.id === p.id ? p : x)); setEditing(null) }} />}
    </div>
  )
}

function ProfileEditor({ profile, onClose, onSaved }: { profile: HunterProfile; onClose: () => void; onSaved: (p: HunterProfile) => void }) {
  const [f, setF] = useState({ ...profile, skillsText: profile.skills.join(', '), years: profile.yearsOfExperience === null ? '' : String(profile.yearsOfExperience) })
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const set = (k: string, v: string) => setF(x => ({ ...x, [k]: v }))
  const field = (label: string, key: keyof typeof f, placeholder = '', span = false) => (
    <label className={`block ${span ? 'sm:col-span-2' : ''}`}><span className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text)' }}>{label}</span>
      <input className={inputCls} style={inputStyle} value={String(f[key] ?? '')} placeholder={placeholder} onChange={e => set(key as string, e.target.value)} /></label>
  )

  function save() {
    setError(null)
    startTransition(async () => {
      const res = await updateProfileAction(profile.id, {
        firstName: f.firstName, lastName: f.lastName, title: f.title, city: f.city, summary: f.summary,
        skills: f.skillsText.split(',').map(s => s.trim()).filter(Boolean),
        yearsOfExperience: f.years === '' ? null : Number(f.years),
        contactEmail: f.contactEmail, contactPhone: f.contactPhone, rate: f.rate, availability: f.availability, notes: f.notes,
      })
      if (res.error || !res.profile) setError(res.error ?? 'Erreur'); else onSaved(res.profile)
    })
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4" style={{ background: 'rgba(8,12,24,0.6)', backdropFilter: 'blur(3px)' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl" style={{ background: 'var(--color-surface)', boxShadow: '0 30px 80px rgba(0,0,0,0.45)' }} onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 flex items-center justify-between sticky top-0" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
          <h2 className="font-bold" style={{ color: 'var(--color-text)' }}>Modifier le profil</h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[rgba(0,0,0,0.06)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-6 grid sm:grid-cols-2 gap-4">
          {field('Prénom', 'firstName')}{field('Nom', 'lastName')}
          {field('Poste / titre', 'title', 'Ex. Architecte Cloud Senior', true)}
          {field('Ville', 'city')}{field('Années d’expérience', 'years', '8')}
          {field('Prétentions (TJM / salaire)', 'rate', 'Ex. 650 €/jour')}{field('Disponibilité', 'availability', 'Ex. Immédiate, préavis 1 mois')}
          <label className="block sm:col-span-2"><span className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text)' }}>Compétences <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>(séparées par des virgules)</span></span>
            <input className={inputCls} style={inputStyle} value={f.skillsText} onChange={e => set('skillsText', e.target.value)} placeholder="AWS, Terraform, Kubernetes…" /></label>
          <label className="block sm:col-span-2"><span className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text)' }}>Résumé du profil</span>
            <textarea className={`${inputCls} resize-y`} style={{ ...inputStyle, minHeight: 90 }} value={f.summary} onChange={e => set('summary', e.target.value)} /></label>
          {field('Email du candidat (privé)', 'contactEmail')}{field('Téléphone du candidat (privé)', 'contactPhone')}
          <label className="block sm:col-span-2"><span className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text)' }}>Notes personnelles <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>(jamais transmises aux recruteurs)</span></span>
            <textarea className={`${inputCls} resize-y`} style={{ ...inputStyle, minHeight: 64 }} value={f.notes} onChange={e => set('notes', e.target.value)} /></label>
        </div>
        <div className="px-6 pb-6 flex items-center justify-between gap-3">
          <p className="text-sm font-medium" style={{ color: '#dc2626' }}>{error}</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ color: 'var(--color-text-muted)' }}>Annuler</button>
            <button type="button" onClick={save} disabled={pending} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50" style={{ background: 'var(--color-primary)', color: 'white' }}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}Enregistrer</button>
          </div>
        </div>
      </div>
    </div>
  )
}
