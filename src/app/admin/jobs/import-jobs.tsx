'use client'

import { useState, useRef, useTransition } from 'react'
import {
  Upload, FileText, Loader2, Check, X, ChevronDown, ChevronUp,
  Sparkles, AlertCircle, Brain, Zap, Plus, Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { createJobsFromExtracted, type ExtractedJob } from './actions'

type Provider = 'claude' | 'teckia'
type Step = 'upload' | 'extracting' | 'review' | 'done'

const CONTRACT_LABELS: Record<string, string> = { cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission' }
const REMOTE_LABELS: Record<string, string> = { onsite: 'Présentiel', hybrid: 'Hybride', remote: 'Remote' }

const inp = "bg-white/[0.06] border-white/[0.1] text-white/80 placeholder:text-white/25 focus:border-white/30 focus:ring-0 rounded-lg text-sm h-8"
const ta  = "bg-white/[0.06] border-white/[0.1] text-white/80 placeholder:text-white/25 focus:border-white/30 focus:ring-0 rounded-lg text-sm resize-none"

// ── Single job card (editable) ─────────────────────────────────────
function JobCard({
  job, index, selected, onToggle, onChange, onRemove,
}: {
  job: ExtractedJob
  index: number
  selected: boolean
  onToggle: () => void
  onChange: (j: ExtractedJob) => void
  onRemove: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  function field<K extends keyof ExtractedJob>(key: K, value: ExtractedJob[K]) {
    onChange({ ...job, [key]: value })
  }

  return (
    <div style={{
      borderRadius: 14,
      border: selected
        ? '1px solid rgba(184,134,11,0.45)'
        : '1px solid rgba(255,255,255,0.07)',
      background: selected ? 'rgba(184,134,11,0.04)' : 'rgba(255,255,255,0.02)',
      overflow: 'hidden',
      transition: 'all 0.15s',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
        {/* Checkbox */}
        <button onClick={onToggle} style={{
          width: 18, height: 18, borderRadius: 5, flexShrink: 0,
          border: selected ? '2px solid #B8860B' : '2px solid rgba(255,255,255,0.2)',
          background: selected ? '#B8860B' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', transition: 'all 0.12s',
        }}>
          {selected && <Check size={10} color="#000" strokeWidth={3} />}
        </button>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, fontSize: 13, color: '#fff', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {job.title || '(sans titre)'}
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
            {job.companyName && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{job.companyName}</span>}
            {job.companyName && job.location && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.18)' }}>·</span>}
            {job.location && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{job.location}</span>}
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.18)' }}>·</span>
            <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 99, background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.45)' }}>
              {CONTRACT_LABELS[job.contractType] ?? job.contractType}
            </span>
            <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 99, background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.45)' }}>
              {REMOTE_LABELS[job.remote] ?? job.remote}
            </span>
            {job.salary && (
              <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 99, background: 'rgba(184,134,11,0.12)', color: '#B8860B', fontWeight: 600 }}>
                {job.salary} €{job.contractType === 'mission' || job.contractType === 'freelance' ? '/j' : '/an'}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <button onClick={() => setExpanded(e => !e)}
          style={{ padding: 6, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', display: 'flex' }}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <button onClick={onRemove}
          style={{ padding: 6, borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: 'none', cursor: 'pointer', color: 'rgba(239,68,68,0.6)', display: 'flex' }}>
          <Trash2 size={14} />
        </button>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div style={{ padding: '0 14px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>Titre</p>
              <Input value={job.title} onChange={e => field('title', e.target.value)} className={inp} />
            </div>
            <div>
              <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>Entreprise</p>
              <Input value={job.companyName} onChange={e => field('companyName', e.target.value)} className={inp} />
            </div>
            <div>
              <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>Localisation</p>
              <Input value={job.location} onChange={e => field('location', e.target.value)} className={inp} />
            </div>
            <div>
              <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>Tarif / Salaire</p>
              <Input type="number" value={job.salary ?? ''} onChange={e => field('salary', e.target.value ? Number(e.target.value) : null)} className={inp} placeholder="ex: 700" />
            </div>
            <div>
              <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>Contrat</p>
              <select value={job.contractType} onChange={e => field('contractType', e.target.value as ExtractedJob['contractType'])}
                style={{ width: '100%', height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)', fontSize: 13, padding: '0 8px' }}>
                <option value="mission">Mission</option>
                <option value="freelance">Freelance</option>
                <option value="cdi">CDI</option>
                <option value="cdd">CDD</option>
              </select>
            </div>
            <div>
              <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>Télétravail</p>
              <select value={job.remote} onChange={e => field('remote', e.target.value as ExtractedJob['remote'])}
                style={{ width: '100%', height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)', fontSize: 13, padding: '0 8px' }}>
                <option value="hybrid">Hybride</option>
                <option value="onsite">Présentiel</option>
                <option value="remote">Full remote</option>
              </select>
            </div>
            <div>
              <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>Durée</p>
              <Input value={job.duration} onChange={e => field('duration', e.target.value)} className={inp} placeholder="ex: 6 mois" />
            </div>
            <div>
              <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>Démarrage</p>
              <Input value={job.startDate} onChange={e => field('startDate', e.target.value)} className={inp} placeholder="ex: ASAP" />
            </div>
          </div>

          {/* Skills */}
          <div style={{ marginTop: 8 }}>
            <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 6 }}>Compétences</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {job.skills.map((sk, si) => (
                <span key={si} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, background: 'rgba(11,29,81,0.5)', border: '1px solid rgba(180,200,255,0.12)', fontSize: 11, color: 'rgba(180,200,255,0.7)' }}>
                  {sk}
                  <button onClick={() => field('skills', job.skills.filter((_, i) => i !== si))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: 0, display: 'flex' }}>
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Description */}
          <div style={{ marginTop: 8 }}>
            <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>Description</p>
            <Textarea value={job.description} onChange={e => field('description', e.target.value)} className={ta} rows={5} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── MAIN COMPONENT ────────────────────────────────────────────────
export function ImportJobs({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('upload')
  const [provider, setProvider] = useState<Provider>('claude')
  const [dragOver, setDragOver] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState('')
  const [jobs, setJobs] = useState<ExtractedJob[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [usedProvider, setUsedProvider] = useState<string>('')
  const [isPending, startTransition] = useTransition()
  const [doneMsg, setDoneMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function reset() {
    setStep('upload'); setJobs([]); setSelected(new Set()); setError(''); setDoneMsg('')
  }

  async function handleFile(file: File) {
    setError('')
    setExtracting(true)
    setStep('extracting')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('provider', provider)
      const res = await fetch('/api/admin/extract-jobs', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Extraction échouée')
      const extracted: ExtractedJob[] = data.jobs
      setJobs(extracted)
      setSelected(new Set(extracted.map((_, i) => i)))
      setUsedProvider(data.provider ?? provider)
      setStep('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur')
      setStep('upload')
    } finally {
      setExtracting(false)
    }
  }

  function toggleAll() {
    if (selected.size === jobs.length) setSelected(new Set())
    else setSelected(new Set(jobs.map((_, i) => i)))
  }

  function handleCreate() {
    const toCreate = jobs.filter((_, i) => selected.has(i))
    startTransition(async () => {
      const r = await createJobsFromExtracted(toCreate, tenantId)
      if ('error' in r) { setError(r.error); return }
      setDoneMsg(`${r.created} offre${r.created > 1 ? 's' : ''} créée${r.created > 1 ? 's' : ''} avec succès !`)
      setStep('done')
    })
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}
        className="gap-2 font-semibold"
        style={{ background: 'linear-gradient(135deg, rgba(11,29,81,0.9), rgba(22,36,102,0.9))', border: '1px solid rgba(184,134,11,0.35)', color: '#fff' }}>
        <Sparkles size={15} />
        Importer via IA
      </Button>
    )
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(1,4,18,0.88)', backdropFilter: 'blur(8px)',
    }}>
      <div style={{
        width: '90vw', maxWidth: 720, maxHeight: '90vh',
        borderRadius: 20, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        background: '#0c0e14', border: '1px solid rgba(255,255,255,0.09)',
        boxShadow: '0 40px 120px rgba(0,0,0,0.8)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg,rgba(11,29,81,0.9),rgba(22,36,102,0.9))', border: '1px solid rgba(184,134,11,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Sparkles size={15} color="#B8860B" />
          </div>
          <div>
            <p style={{ fontWeight: 700, fontSize: 14, color: '#fff', margin: 0 }}>Import d&apos;appels d&apos;offres</p>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', margin: 0 }}>PDF, Word, Excel, PowerPoint ou CSV → extraction IA → création automatique</p>
          </div>
          <div style={{ flex: 1 }} />
          {step !== 'extracting' && (
            <button onClick={() => { setOpen(false); reset() }}
              style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', display: 'flex' }}>
              <X size={16} />
            </button>
          )}
        </div>

        {/* Steps indicator */}
        <div style={{ display: 'flex', padding: '10px 20px', gap: 6, flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          {(['upload', 'extracting', 'review', 'done'] as const).map((s, i) => {
            const current = ['upload', 'extracting', 'review', 'done'].indexOf(step)
            const isActive = i === current
            const isDone = i < current
            return (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 99, fontSize: 9, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isDone ? '#B8860B' : isActive ? 'rgba(184,134,11,0.2)' : 'rgba(255,255,255,0.06)',
                  border: isActive ? '1px solid rgba(184,134,11,0.5)' : 'none',
                  color: isDone ? '#000' : isActive ? '#B8860B' : 'rgba(255,255,255,0.2)',
                }}>
                  {isDone ? <Check size={10} strokeWidth={3} /> : i + 1}
                </div>
                <span style={{ fontSize: 10, color: isActive ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)', fontWeight: isActive ? 600 : 400 }}>
                  {{ upload: 'Upload', extracting: 'Extraction', review: 'Révision', done: 'Terminé' }[s]}
                </span>
                {i < 3 && <div style={{ width: 16, height: 1, background: 'rgba(255,255,255,0.07)', margin: '0 2px' }} />}
              </div>
            )
          })}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>

          {/* STEP: UPLOAD */}
          {step === 'upload' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Provider selector */}
              <div>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Moteur IA</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  {([['claude', 'Claude (Anthropic)', Brain], ['teckia', 'Gemma4 (self-hosted)', Zap]] as [Provider, string, React.ElementType][]).map(([id, label, Icon]) => (
                    <button key={id} onClick={() => setProvider(id)}
                      style={{
                        flex: 1, padding: '10px 14px', borderRadius: 12, border: provider === id ? '1px solid rgba(184,134,11,0.5)' : '1px solid rgba(255,255,255,0.08)',
                        background: provider === id ? 'rgba(184,134,11,0.08)' : 'rgba(255,255,255,0.03)',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                        color: provider === id ? '#B8860B' : 'rgba(255,255,255,0.4)',
                        transition: 'all 0.15s',
                      }}>
                      <Icon size={15} />
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
                      {provider === id && <Check size={12} style={{ marginLeft: 'auto' }} />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
                onClick={() => fileRef.current?.click()}
                style={{
                  padding: '40px 20px', borderRadius: 16, cursor: 'pointer', textAlign: 'center',
                  border: dragOver ? '2px dashed rgba(184,134,11,0.6)' : '2px dashed rgba(255,255,255,0.1)',
                  background: dragOver ? 'rgba(184,134,11,0.05)' : 'rgba(255,255,255,0.02)',
                  transition: 'all 0.15s',
                }}>
                <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,.md,.docx,.doc,.xlsx,.xls,.pdf,.pptx,.rtf,.odt,.ods,.odp" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
                <Upload size={32} color="rgba(255,255,255,0.2)" style={{ margin: '0 auto 12px' }} />
                <p style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>
                  Glisser un fichier ici ou cliquer pour parcourir
                </p>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>PDF, Word, Excel, PowerPoint, CSV — peut contenir plusieurs offres</p>
                <a href="/templates/modele-import-offres.xlsx" download onClick={e => e.stopPropagation()}
                  style={{ fontSize: 12, fontWeight: 600, color: '#60a5fa', marginTop: 6, display: 'inline-block' }}>
                  Télécharger le modèle Excel
                </a>
              </div>

              {error && (
                <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <AlertCircle size={15} color="#f87171" />
                  <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{error}</p>
                </div>
              )}
            </div>
          )}

          {/* STEP: EXTRACTING */}
          {step === 'extracting' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '40px 0' }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(184,134,11,0.1)', border: '1px solid rgba(184,134,11,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Loader2 size={24} color="#B8860B" className="animate-spin" />
              </div>
              <p style={{ fontWeight: 600, fontSize: 15, color: '#fff', margin: 0 }}>Extraction en cours…</p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', margin: 0 }}>
                {provider === 'claude' ? 'Claude analyse le document' : 'Gemma4 analyse le document'} — cela peut prendre 15–45 secondes
              </p>
            </div>
          )}

          {/* STEP: REVIEW */}
          {step === 'review' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Summary bar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: 'rgba(184,134,11,0.08)', border: '1px solid rgba(184,134,11,0.2)' }}>
                <Sparkles size={14} color="#B8860B" />
                <span style={{ fontSize: 12, color: '#B8860B', fontWeight: 600 }}>
                  {jobs.length} offre{jobs.length > 1 ? 's' : ''} détectée{jobs.length > 1 ? 's' : ''} par {usedProvider}
                </span>
                <div style={{ flex: 1 }} />
                <button onClick={toggleAll} style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', background: 'none', border: 'none', cursor: 'pointer' }}>
                  {selected.size === jobs.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                </button>
                <button onClick={reset} style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <FileText size={11} /> Autre fichier
                </button>
              </div>

              {/* Job cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {jobs.map((job, i) => (
                  <JobCard
                    key={i} job={job} index={i}
                    selected={selected.has(i)}
                    onToggle={() => {
                      const next = new Set(selected)
                      next.has(i) ? next.delete(i) : next.add(i)
                      setSelected(next)
                    }}
                    onChange={j => setJobs(prev => prev.map((p, pi) => pi === i ? j : p))}
                    onRemove={() => {
                      setJobs(prev => prev.filter((_, pi) => pi !== i))
                      setSelected(prev => {
                        const next = new Set<number>()
                        prev.forEach(n => { if (n < i) next.add(n); else if (n > i) next.add(n - 1) })
                        return next
                      })
                    }}
                  />
                ))}
              </div>

              {error && (
                <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <AlertCircle size={15} color="#f87171" />
                  <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{error}</p>
                </div>
              )}
            </div>
          )}

          {/* STEP: DONE */}
          {step === 'done' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '40px 0' }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Check size={24} color="#34d399" />
              </div>
              <p style={{ fontWeight: 600, fontSize: 15, color: '#fff', margin: 0 }}>{doneMsg}</p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', margin: 0 }}>Les offres sont maintenant visibles dans la liste</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
          {step === 'review' && (
            <>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                {selected.size} offre{selected.size > 1 ? 's' : ''} sélectionnée{selected.size > 1 ? 's' : ''}
              </span>
              <div style={{ flex: 1 }} />
              <Button variant="ghost" onClick={() => { setOpen(false); reset() }} style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
                Annuler
              </Button>
              <Button onClick={handleCreate} disabled={isPending || selected.size === 0}
                className="gap-2" style={{ background: 'linear-gradient(135deg, #0B1D51, #162466)', border: '1px solid rgba(184,134,11,0.35)', color: '#fff', fontWeight: 700 }}>
                {isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Créer {selected.size > 0 ? `${selected.size} offre${selected.size > 1 ? 's' : ''}` : ''}
              </Button>
            </>
          )}
          {step === 'done' && (
            <>
              <div style={{ flex: 1 }} />
              <Button onClick={() => { reset() }} variant="ghost" style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                Importer un autre fichier
              </Button>
              <Button onClick={() => { setOpen(false); reset() }}
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontWeight: 600 }}>
                Fermer
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
