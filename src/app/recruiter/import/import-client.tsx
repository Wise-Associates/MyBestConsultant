'use client'

import { useState, useTransition, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Upload, FileText, Clipboard, Loader2, Check, AlertCircle,
  ChevronDown, ChevronUp, Trash2, Plus, X, Sparkles,
  ArrowRight, ArrowLeft, RotateCcw, CheckCircle2, Info,
} from 'lucide-react'
import { parseFileWithLLM, confirmImport, improveExtractedJob, type ExtractedJob } from './actions'

// ── Contract / Remote labels ──────────────────────────────────────
const CONTRACT_LABELS: Record<string, string> = {
  cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission',
}
const REMOTE_LABELS: Record<string, string> = {
  onsite: 'Présentiel', hybrid: 'Hybride', remote: 'Full remote',
}
const CONFIDENCE_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  high:   { color: '#10b981', bg: 'rgba(16,185,129,0.1)', label: 'Confiance haute' },
  medium: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', label: 'Confiance moyenne' },
  low:    { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  label: 'À vérifier' },
}

const ACCEPT = '.csv,.txt,.tsv,.md,.docx,.doc,.xlsx,.xls,.pdf,.pptx,.rtf,.odt,.ods,.odp'

// ── Editable job card ─────────────────────────────────────────────
export function JobCard({
  job, selected, onToggle, onUpdate, onRemove,
}: {
  job: ExtractedJob
  selected: boolean
  onToggle: () => void
  onUpdate: (patch: Partial<ExtractedJob>) => void
  onRemove: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editingSkill, setEditingSkill] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiError, setAiError] = useState('')
  const [isImproving, startImproving] = useTransition()
  const conf = CONFIDENCE_STYLE[job.confidence]

  function improveWithAI() {
    setAiError('')
    startImproving(async () => {
      const result = await improveExtractedJob(
        {
          title: job.title, description: job.description, skills: job.skills,
          location: job.location, contractType: job.contractType, remote: job.remote, salary: job.salary,
        },
        aiPrompt,
      )
      if ('error' in result) { setAiError(result.error); return }
      onUpdate(result)
      setAiPrompt('')
    })
  }

  return (
    <div className="rounded-3xl overflow-hidden border transition-all duration-300"
      style={{
        borderColor: selected ? 'rgba(37,99,235,0.4)' : 'var(--color-border)',
        background: 'var(--color-surface)',
        boxShadow: selected ? '0 10px 30px -10px rgba(37,99,235,0.25)' : '0 10px 30px -10px rgba(11,29,81,0.1)',
      }}>

      {/* Header row */}
      <div className="flex items-start gap-4 px-5 py-4">
        {/* Checkbox */}
        <button onClick={onToggle}
          className="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all"
          style={{
            borderColor: selected ? '#2563eb' : 'var(--color-border)',
            background: selected ? '#2563eb' : 'transparent',
          }}>
          {selected && <Check className="h-3 w-3 text-white" />}
        </button>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-3 flex-wrap">
            <input
              value={job.title}
              onChange={e => onUpdate({ title: e.target.value })}
              className="flex-1 min-w-0 bg-transparent text-base font-bold focus:outline-none border-b border-transparent"
              style={{ color: 'var(--color-text)' }}
            />
            {/* Confidence badge */}
            <span className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full"
              style={{ background: conf.bg, color: conf.color }}>
              {conf.label}
            </span>
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <input
              value={job.location}
              onChange={e => onUpdate({ location: e.target.value })}
              placeholder="Lieu"
              className="bg-transparent text-sm focus:outline-none w-32 border-b border-transparent"
              style={{ color: 'var(--color-text-muted)' }}
            />
            <select value={job.contractType} onChange={e => onUpdate({ contractType: e.target.value as ExtractedJob['contractType'] })}
              className="bg-transparent text-sm focus:outline-none appearance-none cursor-pointer" style={{ color: 'var(--color-text-muted)' }}>
              {Object.entries(CONTRACT_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <select value={job.remote} onChange={e => onUpdate({ remote: e.target.value as ExtractedJob['remote'] })}
              className="bg-transparent text-sm focus:outline-none appearance-none cursor-pointer" style={{ color: 'var(--color-text-muted)' }}>
              {Object.entries(REMOTE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            {job.salary ? (
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                <input type="number" value={job.salary}
                  onChange={e => onUpdate({ salary: Number(e.target.value) || null })}
                  className="bg-transparent text-sm focus:outline-none w-20 border-b border-transparent" style={{ color: 'var(--color-text-muted)' }} />
                <span> €/j</span>
              </span>
            ) : (
              <button onClick={() => onUpdate({ salary: 0 })}
                className="text-xs transition-colors" style={{ color: 'var(--color-text-muted)', opacity: 0.6 }}>
                + Salaire
              </button>
            )}
          </div>

          {/* Skills */}
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            {job.skills.map((skill, i) => (
              <span key={i} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold"
                style={{ background: 'rgba(11,29,81,0.06)', color: 'var(--color-text)' }}>
                {skill}
                <button onClick={() => onUpdate({ skills: job.skills.filter((_, j) => j !== i) })}
                  className="ml-0.5" style={{ color: 'var(--color-text-muted)' }}>
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            <input
              value={editingSkill}
              onChange={e => setEditingSkill(e.target.value)}
              onKeyDown={e => {
                if ((e.key === 'Enter' || e.key === ',') && editingSkill.trim()) {
                  e.preventDefault()
                  onUpdate({ skills: [...job.skills, editingSkill.trim()] })
                  setEditingSkill('')
                }
              }}
              placeholder="+ compétence"
              className="text-xs bg-transparent focus:outline-none w-28 px-1"
              style={{ color: 'var(--color-text-muted)' }}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg transition-all" style={{ color: 'var(--color-text-muted)' }}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button onClick={onRemove}
            className="p-1.5 rounded-lg transition-all hover:bg-red-50" style={{ color: 'var(--color-text-muted)' }}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Expanded: description + company */}
      {expanded && (
        <div className="px-5 pb-4 pt-0 space-y-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div>
            <p className="text-[10px] uppercase tracking-widest mb-1.5 mt-3" style={{ color: 'var(--color-text-muted)' }}>Entreprise</p>
            <input value={job.companyName} onChange={e => onUpdate({ companyName: e.target.value })}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ background: 'rgba(11,29,81,0.03)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Description</p>
            <textarea value={job.description} onChange={e => onUpdate({ description: e.target.value })}
              rows={4}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none resize-none leading-relaxed"
              style={{ background: 'rgba(11,29,81,0.03)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
          </div>
          <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(232,163,61,0.06)', border: '1px solid rgba(232,163,61,0.25)' }}>
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#B8860B' }}>
              <Sparkles className="h-3 w-3" /> Améliorer avec l&apos;IA
            </p>
            <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} rows={2}
              placeholder="Ex. « Passe le TJM à 650€, mets Lyon et full remote, rends la description plus percutante »"
              className="w-full rounded-lg px-3 py-2 text-xs focus:outline-none resize-vertical"
              style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
            {aiError && <p className="text-xs" style={{ color: '#ef4444' }}>{aiError}</p>}
            <button onClick={improveWithAI} disabled={isImproving || !aiPrompt.trim()}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-85 disabled:opacity-50"
              style={{ background: '#B8860B', color: 'white' }}>
              {isImproving ? <><Loader2 className="h-3 w-3 animate-spin" /> Amélioration…</> : <><Sparkles className="h-3 w-3" /> Améliorer l&apos;offre</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Upload zone ───────────────────────────────────────────────────
function DropZone({ onFile }: { onFile: (f: File) => void }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }, [onFile])

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className="cursor-pointer rounded-3xl border-2 border-dashed transition-all duration-300 flex flex-col items-center justify-center gap-4 py-16 px-8 hover:-translate-y-0.5"
      style={{
        borderColor: dragging ? 'rgba(37,99,235,0.5)' : 'var(--color-border)',
        background: 'var(--color-surface)',
        boxShadow: dragging ? '0 10px 30px -10px rgba(37,99,235,0.35)' : '0 10px 30px -10px rgba(11,29,81,0.1)',
      }}>
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: 'rgba(37,99,235,0.1)' }}>
        <Upload className="h-7 w-7" style={{ color: '#2563eb' }} />
      </div>
      <div className="text-center">
        <p className="text-base font-bold" style={{ color: 'var(--color-text)' }}>Glissez votre fichier ici</p>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>ou cliquez pour parcourir</p>
        <p className="text-xs mt-3" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>PDF · Word · Excel · PowerPoint · CSV · TXT — max 5 Mo</p>
        <a href="/templates/modele-import-offres.xlsx" download onClick={e => e.stopPropagation()}
          className="text-xs font-semibold mt-1 hover:underline inline-block" style={{ color: '#2563eb' }}>
          Télécharger le modèle Excel
        </a>
      </div>
      <input ref={inputRef} type="file" accept={ACCEPT} className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────
type Step = 'upload' | 'parsing' | 'review' | 'importing' | 'done'

const LLM_OPTIONS = [
  { value: 'teckia', label: '⚡ TeckiA (rapide)' },
  { value: 'claude', label: '🧠 Claude (précis)' },
  { value: 'gpt4o', label: '🤖 GPT-4o' },
] as const

export function ImportClient({ tenantName }: { tenantName: string }) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('upload')
  const [activeTab, setActiveTab] = useState<'file' | 'paste'>('file')
  const [pasteText, setPasteText] = useState('')
  const [llmProvider, setLlmProvider] = useState<string>('claude')
  const [jobs, setJobs] = useState<ExtractedJob[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rawPreview, setRawPreview] = useState('')
  const [error, setError] = useState('')
  const [importedCount, setImportedCount] = useState(0)
  const [isPending, startTransition] = useTransition()

  function updateJob(id: string, patch: Partial<ExtractedJob>) {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, ...patch } : j))
  }
  function removeJob(id: string) {
    setJobs(prev => prev.filter(j => j.id !== id))
    setSelected(prev => { const s = new Set(prev); s.delete(id); return s })
  }
  function toggleJob(id: string) {
    setSelected(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }
  function toggleAll() {
    if (selected.size === jobs.length) setSelected(new Set())
    else setSelected(new Set(jobs.map(j => j.id)))
  }

  async function parse(formData: FormData) {
    formData.set('llmProvider', llmProvider)
    setError('')
    setStep('parsing')
    startTransition(async () => {
      const result = await parseFileWithLLM(formData)
      if (result.error) {
        setError(result.error)
        setStep('upload')
        return
      }
      setRawPreview(result.rawPreview)
      setJobs(result.jobs)
      setSelected(new Set(result.jobs.filter(j => j.confidence !== 'low').map(j => j.id)))
      setStep('review')
    })
  }

  function handleFile(file: File) {
    const fd = new FormData()
    fd.append('file', file)
    parse(fd)
  }

  function handlePaste() {
    if (!pasteText.trim()) return
    const fd = new FormData()
    fd.append('text', pasteText)
    parse(fd)
  }

  function handleConfirm() {
    const toImport = jobs.filter(j => selected.has(j.id))
    if (toImport.length === 0) return
    setStep('importing')
    startTransition(async () => {
      const result = await confirmImport(toImport)
      if (result.error) { setError(result.error); setStep('review') }
      else { setImportedCount(result.imported); setStep('done') }
    })
  }

  function reset() {
    setStep('upload')
    setJobs([])
    setSelected(new Set())
    setPasteText('')
    setError('')
  }

  // ── DONE screen ──
  if (step === 'done') {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--page-bg)',
      }} className="flex items-center justify-center p-8">
        <div className="text-center max-w-md space-y-6 rounded-3xl p-10"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 20px 50px -12px rgba(11,29,81,0.18)' }}>
          <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto"
            style={{ background: 'rgba(16,185,129,0.12)' }}>
            <CheckCircle2 className="h-10 w-10" style={{ color: '#10b981' }} />
          </div>
          <div>
            <h2 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{importedCount} offre{importedCount > 1 ? 's' : ''} importée{importedCount > 1 ? 's' : ''}</h2>
            <p className="mt-2" style={{ color: 'var(--color-text-muted)' }}>Vos offres sont maintenant publiées et visibles par les candidats.</p>
          </div>
          <div className="flex gap-3 justify-center flex-wrap">
            <button onClick={() => router.push('/recruiter/dashboard')}
              className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-opacity hover:opacity-90"
              style={{ background: 'var(--color-primary)', color: 'white', boxShadow: '0 10px 24px rgba(11,29,81,0.25)' }}>
              Voir le dashboard <ArrowRight className="h-4 w-4" />
            </button>
            <button onClick={reset}
              className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-colors"
              style={{ background: 'rgba(11,29,81,0.04)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
              <RotateCcw className="h-4 w-4" /> Nouvel import
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── PARSING screen ──
  if (step === 'parsing') {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--page-bg)',
      }} className="flex items-center justify-center p-8">
        <div className="text-center space-y-6">
          <div className="relative w-20 h-20 mx-auto">
            <div className="w-20 h-20 rounded-full border-2 animate-spin"
              style={{ borderColor: 'rgba(37,99,235,0.15)', borderTopColor: '#3b82f6' }} />
            <Sparkles className="h-7 w-7 absolute inset-0 m-auto" style={{ color: '#3b82f6' }} />
          </div>
          <div>
            <h2 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>Analyse en cours…</h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>L&apos;IA extrait les offres d&apos;emploi depuis votre fichier</p>
          </div>
          <div className="flex items-center gap-2 justify-center">
            {['Lecture du fichier', 'Extraction des offres', 'Structuration des données'].map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                {i > 0 && <div className="w-6 h-px" style={{ background: 'var(--color-border)' }} />}
                <span className="text-xs animate-pulse" style={{ color: 'var(--color-text-muted)', animationDelay: `${i * 0.3}s` }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── REVIEW screen ──
  if (step === 'review') {
    const selectedJobs = jobs.filter(j => selected.has(j.id))
    const highConf = jobs.filter(j => j.confidence === 'high').length
    const lowConf = jobs.filter(j => j.confidence === 'low').length

    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--page-bg)',
      }}>
        {/* Top bar */}
        <div className="sticky top-0 z-10" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
          <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link href="/recruiter/dashboard"
                className="p-2 rounded-xl no-underline transition-all shrink-0"
                style={{ color: '#7c3aed', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.25)' }}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <button onClick={reset} className="transition-colors" style={{ color: 'var(--color-text-muted)' }}>
                <RotateCcw className="h-4 w-4" />
              </button>
              <div>
                <h1 className="text-base font-bold" style={{ color: 'var(--color-text)' }}>
                  {jobs.length} offre{jobs.length > 1 ? 's' : ''} extraite{jobs.length > 1 ? 's' : ''}
                </h1>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {highConf} haute confiance · {jobs.length - highConf - lowConf} moyenne · {lowConf} à vérifier
                </p>
              </div>
            </div>

            {/* Stats pills */}
            <div className="hidden md:flex items-center gap-2">
              {rawPreview && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
                  style={{ background: 'rgba(11,29,81,0.04)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                  <Info className="h-3.5 w-3.5" />
                  Texte extrait : {rawPreview.slice(0, 40)}…
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <button onClick={toggleAll}
                className="text-xs transition-colors" style={{ color: 'var(--color-text-muted)' }}>
                {selected.size === jobs.length ? 'Tout désélect.' : 'Tout sélect.'}
              </button>
              <button onClick={handleConfirm} disabled={selectedJobs.length === 0 || isPending}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
                style={{ background: '#2563eb', color: 'white', boxShadow: '0 8px 20px rgba(37,99,235,0.3)' }}>
                {isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Import…</>
                  : <><Check className="h-4 w-4" /> Importer {selectedJobs.length} offre{selectedJobs.length > 1 ? 's' : ''}</>}
              </button>
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="max-w-4xl mx-auto px-6 mt-4">
            <div className="flex items-center gap-3 p-4 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
              <AlertCircle className="h-4 w-4 shrink-0" />{error}
            </div>
          </div>
        )}

        {/* Job cards */}
        <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">
          {jobs.length === 0 ? (
            <div className="text-center py-16" style={{ color: 'var(--color-text-muted)' }}>
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>Aucune offre détectée dans ce fichier</p>
              <button onClick={reset} className="mt-4 text-sm font-semibold" style={{ color: '#2563eb' }}>
                Réessayer avec un autre fichier
              </button>
            </div>
          ) : (
            jobs.map(job => (
              <JobCard key={job.id} job={job}
                selected={selected.has(job.id)}
                onToggle={() => toggleJob(job.id)}
                onUpdate={p => updateJob(job.id, p)}
                onRemove={() => removeJob(job.id)}
              />
            ))
          )}

          {/* Add manual job */}
          <button
            onClick={() => {
              const newJob: ExtractedJob = {
                id: Math.random().toString(36).slice(2, 9),
                title: 'Nouveau poste',
                location: 'Paris',
                contractType: 'mission',
                remote: 'hybrid',
                salary: null,
                skills: [],
                description: '',
                companyName: tenantName,
                confidence: 'high',
              }
              setJobs(prev => [...prev, newJob])
              setSelected(prev => new Set([...prev, newJob.id]))
            }}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border border-dashed text-sm transition-all"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}>
            <Plus className="h-4 w-4" /> Ajouter une offre manuellement
          </button>
        </div>

        {/* Bottom bar */}
        <div className="sticky bottom-0 px-6 py-4" style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', boxShadow: '0 -8px 24px rgba(11,29,81,0.06)' }}>
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              <span className="font-bold" style={{ color: 'var(--color-text)' }}>{selectedJobs.length}</span> offre{selectedJobs.length > 1 ? 's' : ''} sélectionnée{selectedJobs.length > 1 ? 's' : ''} sur {jobs.length}
            </p>
            <button onClick={handleConfirm} disabled={selectedJobs.length === 0 || isPending}
              className="flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
              style={{ background: '#2563eb', color: 'white', boxShadow: '0 8px 20px rgba(37,99,235,0.3)' }}>
              {isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Import en cours…</>
                : <><Sparkles className="h-4 w-4" /> Confirmer l&apos;import</>}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── UPLOAD screen ──
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
    }}>
      {/* Header */}
      <div className="sticky top-0 z-20" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 12px 30px rgba(0,0,0,0.15)' }}>
        <div className="max-w-2xl mx-auto px-6 py-10">
          <Link href="/recruiter/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80"
            style={{ color: '#c4b5fd' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Retour à l&apos;espace recruteur
          </Link>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-4"
            style={{ background: 'rgba(37,99,235,0.18)', color: '#60a5fa' }}>
            <Sparkles className="h-3.5 w-3.5" /> Propulsé par l&apos;IA
          </div>
          <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.9rem' }}>Import automatique d&apos;offres</h1>
          <p className="mt-2 leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Importez vos offres depuis n&apos;importe quel format — CSV, Excel, Word, PDF ou texte brut.
            Notre IA extrait et structure automatiquement toutes les informations.
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* LLM selector */}
        <div className="flex items-center gap-3 mb-6 p-4 rounded-2xl"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
          <Sparkles className="h-4 w-4 shrink-0" style={{ color: '#2563eb' }} />
          <span className="text-xs shrink-0" style={{ color: 'var(--color-text-muted)' }}>Modèle IA</span>
          <div className="flex gap-1.5 flex-wrap">
            {LLM_OPTIONS.map(opt => (
              <button key={opt.value} type="button"
                onClick={() => setLlmProvider(opt.value)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: llmProvider === opt.value ? 'rgba(37,99,235,0.14)' : 'rgba(11,29,81,0.03)',
                  color: llmProvider === opt.value ? '#2563eb' : 'var(--color-text-muted)',
                  border: llmProvider === opt.value ? '1px solid rgba(37,99,235,0.3)' : '1px solid var(--color-border)',
                }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 rounded-xl mb-6 w-fit"
          style={{ background: 'rgba(11,29,81,0.04)', border: '1px solid var(--color-border)' }}>
          {[
            { id: 'file' as const, label: 'Fichier', icon: Upload },
            { id: 'paste' as const, label: 'Coller du texte', icon: Clipboard },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: activeTab === tab.id ? 'var(--color-primary)' : 'transparent',
                color: activeTab === tab.id ? 'white' : 'var(--color-text-muted)',
                boxShadow: activeTab === tab.id ? '0 4px 12px rgba(11,29,81,0.25)' : 'none',
              }}>
              <tab.icon className="h-4 w-4" />{tab.label}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 p-4 rounded-xl mb-4 text-sm" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
            <AlertCircle className="h-4 w-4 shrink-0" />{error}
            <button onClick={() => setError('')} className="ml-auto"><X className="h-4 w-4" /></button>
          </div>
        )}

        {/* File tab */}
        {activeTab === 'file' && <DropZone onFile={handleFile} />}

        {/* Paste tab */}
        {activeTab === 'paste' && (
          <div className="space-y-4">
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              rows={12}
              placeholder={`Collez ici vos offres d'emploi (texte libre, CSV, JSON…)\n\nExemple :\nDéveloppeur React Senior — Paris — CDI\nExpertise React, TypeScript, Node.js requise\nSalaire : 55-65K€\n\nChef de Projet IT — Lyon — Mission 6 mois\nTJM : 500-600€...`}
              className="w-full rounded-2xl px-5 py-4 text-sm leading-relaxed focus:outline-none resize-none"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                boxShadow: '0 8px 24px rgba(11,29,81,0.06)',
              }}
            />
            <button
              onClick={handlePaste}
              disabled={!pasteText.trim() || isPending}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-sm transition-all disabled:opacity-40"
              style={{ background: '#2563eb', color: 'white', boxShadow: '0 10px 24px rgba(37,99,235,0.3)' }}>
              <Sparkles className="h-4 w-4" />
              Analyser avec l&apos;IA
            </button>
          </div>
        )}

        {/* Format guide */}
        <div className="mt-8 rounded-2xl p-5 space-y-3"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Formats supportés</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { fmt: 'CSV / TSV', desc: 'Export depuis ATS, Excel, etc.', q: '★★★' },
              { fmt: 'Excel (.xlsx)', desc: 'Fichiers tableur Microsoft', q: '★★★' },
              { fmt: 'Word (.docx)', desc: 'Documents texte formatés', q: '★★☆' },
              { fmt: 'PDF', desc: 'Annonces, plaquettes', q: '★☆☆' },
            ].map(f => (
              <div key={f.fmt} className="flex items-center gap-3 p-3 rounded-xl"
                style={{ background: 'rgba(11,29,81,0.03)' }}>
                <FileText className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-muted)', opacity: 0.6 }} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{f.fmt}</p>
                  <p className="text-[10px] truncate" style={{ color: 'var(--color-text-muted)' }}>{f.desc}</p>
                </div>
                <span className="text-[10px] shrink-0" style={{ color: '#B8860B' }}>{f.q}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
