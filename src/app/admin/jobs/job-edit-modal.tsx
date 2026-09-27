'use client'

import { useState, useTransition } from 'react'
import { X, Loader2, Save, ToggleLeft, ToggleRight, Plus, Trash2 } from 'lucide-react'
import { updateJob } from './actions'

type ContractType = 'cdi' | 'cdd' | 'freelance' | 'mission'
type RemoteType = 'onsite' | 'hybrid' | 'remote'

interface JobRow {
  $id: string
  title: string
  companyName?: string
  location: string
  contractType?: ContractType
  remote?: RemoteType
  salary?: number
  skills: string[]
  description: string
  isActive: boolean
  expiresAt?: string
}

interface Props {
  job: JobRow
  onClose: () => void
  onSaved: (updated: JobRow) => void
}

const CONTRACT_OPTS: { value: ContractType; label: string }[] = [
  { value: 'cdi', label: 'CDI' },
  { value: 'cdd', label: 'CDD' },
  { value: 'freelance', label: 'Freelance' },
  { value: 'mission', label: 'Mission' },
]
const REMOTE_OPTS: { value: RemoteType; label: string }[] = [
  { value: 'onsite', label: 'Présentiel' },
  { value: 'hybrid', label: 'Hybride' },
  { value: 'remote', label: 'Full remote' },
]

const FIELD_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 10,
  border: '1.5px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.05)',
  color: 'rgba(255,255,255,0.85)',
  fontSize: 14,
  outline: 'none',
  transition: 'border-color 0.15s',
}
const SELECT_STYLE: React.CSSProperties = {
  ...FIELD_STYLE,
  cursor: 'pointer',
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.4)' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 14px center',
  paddingRight: 36,
}
const LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.35)',
  marginBottom: 6,
}

export function JobEditModal({ job, onClose, onSaved }: Props) {
  const [form, setForm] = useState<JobRow>({ ...job })
  const [newSkill, setNewSkill] = useState('')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  const set = <K extends keyof JobRow>(k: K, v: JobRow[K]) =>
    setForm(p => ({ ...p, [k]: v }))

  const addSkill = () => {
    const s = newSkill.trim()
    if (s && !form.skills.includes(s) && form.skills.length < 10) {
      set('skills', [...form.skills, s])
      setNewSkill('')
    }
  }

  const save = () => {
    setError('')
    startTransition(async () => {
      const res = await updateJob(form.$id, {
        title: form.title,
        companyName: form.companyName,
        location: form.location,
        contractType: form.contractType,
        remote: form.remote,
        salary: form.salary,
        skills: form.skills,
        description: form.description,
        isActive: form.isActive,
        expiresAt: form.expiresAt ?? '',
      })
      if (res.error) { setError(res.error); return }
      onSaved(form)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onClick={e => { if (e.target === e.currentTarget && !pending) onClose() }}
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: '#0f172a',
          border: '1px solid rgba(255,255,255,0.09)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.5)',
          maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', marginBottom: 2 }}>
              Modifier l&apos;offre
            </p>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'white', lineHeight: 1.2 }}>
              {job.title}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {/* Active toggle */}
            <button
              onClick={() => set('isActive', !form.isActive)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: form.isActive ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.06)',
                color: form.isActive ? '#34d399' : 'rgba(255,255,255,0.35)',
                border: `1px solid ${form.isActive ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.08)'}`,
              }}
            >
              {form.isActive
                ? <ToggleRight className="h-4 w-4" />
                : <ToggleLeft className="h-4 w-4" />}
              {form.isActive ? 'Active' : 'Inactive'}
            </button>
            <button onClick={() => !pending && onClose()}
              className="p-2 rounded-lg transition-opacity hover:opacity-60"
              style={{ color: 'rgba(255,255,255,0.3)' }}>
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="overflow-y-auto px-7 py-6 space-y-5 flex-1">

          {/* Row 1: titre + entreprise */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label style={LABEL_STYLE}>Titre du poste</label>
              <input
                value={form.title}
                onChange={e => set('title', e.target.value)}
                style={FIELD_STYLE}
                onFocus={e => (e.target.style.borderColor = 'rgba(184,134,11,0.6)')}
                onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
              />
            </div>
            <div>
              <label style={LABEL_STYLE}>Entreprise cliente</label>
              <input
                value={form.companyName ?? ''}
                onChange={e => set('companyName', e.target.value)}
                placeholder="Nom de l'entreprise…"
                style={FIELD_STYLE}
                onFocus={e => (e.target.style.borderColor = 'rgba(184,134,11,0.6)')}
                onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
              />
            </div>
          </div>

          {/* Row 2: localisation + contrat + remote */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label style={LABEL_STYLE}>Localisation</label>
              <input
                value={form.location}
                onChange={e => set('location', e.target.value)}
                style={FIELD_STYLE}
                onFocus={e => (e.target.style.borderColor = 'rgba(184,134,11,0.6)')}
                onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
              />
            </div>
            <div>
              <label style={LABEL_STYLE}>Contrat</label>
              <select
                value={form.contractType ?? 'mission'}
                onChange={e => set('contractType', e.target.value as ContractType)}
                style={SELECT_STYLE}
              >
                {CONTRACT_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label style={LABEL_STYLE}>Télétravail</label>
              <select
                value={form.remote ?? 'hybrid'}
                onChange={e => set('remote', e.target.value as RemoteType)}
                style={SELECT_STYLE}
              >
                {REMOTE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Row 3: salaire */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label style={LABEL_STYLE}>
                {form.contractType === 'cdi' || form.contractType === 'cdd' ? 'Salaire €/an' : 'TJM €/jour'}
              </label>
              <input
                type="number"
                value={form.salary ?? ''}
                onChange={e => set('salary', e.target.value ? Number(e.target.value) : undefined)}
                placeholder="Ex: 650"
                style={FIELD_STYLE}
                onFocus={e => (e.target.style.borderColor = 'rgba(184,134,11,0.6)')}
                onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
              />
            </div>
            <div>
              <label style={LABEL_STYLE}>Disponible jusqu&apos;au</label>
              <input
                type="date"
                value={form.expiresAt ? form.expiresAt.slice(0, 10) : ''}
                onChange={e => set('expiresAt', e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : '')}
                style={{ ...FIELD_STYLE, colorScheme: 'dark' }}
                onFocus={e => (e.target.style.borderColor = 'rgba(184,134,11,0.6)')}
                onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
              />
              <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 4 }}>
                Vide = pas de désactivation automatique. Modifiable ici uniquement (admin).
              </p>
            </div>
          </div>

          {/* Skills */}
          <div>
            <label style={LABEL_STYLE}>Compétences ({form.skills.length}/10)</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {form.skills.map((s, i) => (
                <span key={i} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium"
                  style={{ background: 'rgba(184,134,11,0.12)', color: '#DAA520', border: '1px solid rgba(184,134,11,0.2)' }}>
                  {s}
                  <button onClick={() => set('skills', form.skills.filter((_, idx) => idx !== i))}
                    className="hover:opacity-60 transition-opacity">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            {form.skills.length < 10 && (
              <div className="flex gap-2">
                <input
                  value={newSkill}
                  onChange={e => setNewSkill(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addSkill()}
                  placeholder="Ajouter une compétence…"
                  style={{ ...FIELD_STYLE, flex: 1 }}
                  onFocus={e => (e.target.style.borderColor = 'rgba(184,134,11,0.6)')}
                  onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
                />
                <button onClick={addSkill}
                  className="px-3 rounded-lg transition-opacity hover:opacity-70"
                  style={{ background: 'rgba(184,134,11,0.15)', color: '#DAA520', border: '1px solid rgba(184,134,11,0.2)' }}>
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label style={LABEL_STYLE}>Description</label>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              rows={8}
              style={{ ...FIELD_STYLE, resize: 'vertical', lineHeight: 1.7 }}
              onFocus={e => (e.target.style.borderColor = 'rgba(184,134,11,0.6)')}
              onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
            />
          </div>

          {error && (
            <div className="px-4 py-3 rounded-xl text-sm"
              style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-7 py-5 flex items-center justify-between"
          style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <button onClick={() => !pending && onClose()}
            className="px-5 py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-60"
            style={{ color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)' }}>
            Annuler
          </button>
          <button
            onClick={save}
            disabled={pending}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #B8860B, #DAA520)', color: 'white' }}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {pending ? 'Enregistrement…' : 'Enregistrer les modifications'}
          </button>
        </div>
      </div>
    </div>
  )
}
