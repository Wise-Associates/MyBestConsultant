'use client'

import { useMemo, useRef, useState } from 'react'
import {
  AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, ClipboardPaste, FileSpreadsheet, FileText, Loader2, RotateCcw, Search, Sparkles, Upload, X,
} from 'lucide-react'
import { importJobsChunk, parseFileWithLLM, type ExtractedJob, type ParseResult } from '../import/actions'
import { JobCard } from '../import/import-client'

const ACCEPT = '.csv,.txt,.tsv,.md,.docx,.doc,.xlsx,.xls,.pdf,.pptx,.rtf,.odt,.ods,.odp'
const MAX_FILE = 5 * 1024 * 1024
const CHUNK = 20
const EDITABLE_MAX = 30   // au-delà, tableau compact (pas 1000 cartes éditables)
const BULK_FROM = 10      // au-delà, import « en masse »
const PAGE = 25

const CONTRACT: Record<string, string> = { cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission' }
const LLM_OPTIONS = [
  { value: 'teckia', label: '⚡ TeckiA (rapide)' },
  { value: 'claude', label: '🧠 Claude (précis)' },
  { value: 'gpt4o', label: '🤖 GPT-4o' },
] as const

type Phase = 'idle' | 'parsing' | 'review' | 'importing' | 'done' | 'error'
interface Failure { title: string; error: string }

const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' }

function fmtDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
}

export function ImportPanel({ tenantName, onClose, onImported }: { tenantName: string; onClose: () => void; onImported: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [source, setSource] = useState<'file' | 'paste'>('file')
  const [pasteText, setPasteText] = useState('')
  const [llm, setLlm] = useState<string>('claude')
  const [fileName, setFileName] = useState('')
  const [dragging, setDragging] = useState(false)
  const [message, setMessage] = useState('')

  const [result, setResult] = useState<ParseResult | null>(null)
  const [jobs, setJobs] = useState<ExtractedJob[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [showSkipped, setShowSkipped] = useState(false)

  const [progress, setProgress] = useState({ done: 0, total: 0, created: 0, failed: 0 })
  const [failures, setFailures] = useState<Failure[]>([])
  const [cancelled, setCancelled] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const cancelRef = useRef(false)
  const startedAt = useRef(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const editable = jobs.length <= EDITABLE_MAX
  const isSheet = result?.source === 'spreadsheet'

  // ── Analyse ──
  async function analyse(fd: FormData, label: string) {
    setMessage(''); setFileName(label); setPhase('parsing')
    try {
      fd.set('llmProvider', llm)
      const res = await parseFileWithLLM(fd)
      if (res.error) { setMessage(res.error); setPhase('error'); return }
      setResult(res); setJobs(res.jobs)
      setSelected(new Set(res.jobs.filter(j => j.confidence !== 'low' || res.source === 'spreadsheet').map(j => j.id)))
      setQuery(''); setPage(0); setShowSkipped(false)
      setPhase('review')
    } catch {
      setMessage('Le fichier n’a pas pu être analysé (connexion interrompue ou fichier trop lourd). Réessayez, ou découpez-le en plusieurs fichiers.')
      setPhase('error')
    }
  }

  function handleFile(file: File) {
    if (file.size > MAX_FILE) { setMessage('Fichier trop volumineux (5 Mo maximum). Découpez-le en plusieurs fichiers.'); setPhase('error'); return }
    const fd = new FormData(); fd.append('file', file)
    analyse(fd, file.name)
  }
  function handlePaste() {
    if (!pasteText.trim()) return
    const fd = new FormData(); fd.append('text', pasteText)
    analyse(fd, 'Texte collé')
  }

  // ── Import par lots avec progression ──
  async function runImport() {
    const list = jobs.filter(j => selected.has(j.id))
    if (list.length === 0) return
    const bulk = list.length > BULK_FROM
    cancelRef.current = false; setCancelled(false)
    setFailures([]); setProgress({ done: 0, total: list.length, created: 0, failed: 0 }); setElapsed(0)
    startedAt.current = Date.now(); setPhase('importing')
    const tick = setInterval(() => setElapsed(Date.now() - startedAt.current), 500)

    let created = 0
    const failed: Failure[] = []
    let fatal = ''
    for (let i = 0; i < list.length; i += CHUNK) {
      if (cancelRef.current) break
      const chunk = list.slice(i, i + CHUNK)
      let res: Awaited<ReturnType<typeof importJobsChunk>> | null = null
      for (let attempt = 0; attempt < 2 && !res; attempt++) {
        try { res = await importJobsChunk(chunk, { bulk }) } catch { /* nouvelle tentative */ }
      }
      if (!res) chunk.forEach(j => failed.push({ title: j.title, error: 'Connexion interrompue' }))
      else if (res.error) { fatal = res.error; break }
      else { created += res.created; failed.push(...res.failed) }
      setProgress({ done: Math.min(list.length, i + chunk.length), total: list.length, created, failed: failed.length })
      setFailures(failed.slice(0, 200))
    }
    clearInterval(tick)
    setElapsed(Date.now() - startedAt.current)
    if (fatal) { setMessage(fatal); setPhase('error'); if (created > 0) onImported(); return }
    setCancelled(cancelRef.current)
    setPhase('done')
    if (created > 0) onImported()
  }

  function reset() {
    setPhase('idle'); setJobs([]); setSelected(new Set()); setResult(null); setMessage(''); setPasteText(''); setFileName('')
  }

  // ── Tableau compact (gros fichiers) ──
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? jobs.filter(j => `${j.title} ${j.companyName} ${j.location}`.toLowerCase().includes(q)) : jobs
  }, [jobs, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE))
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE)
  const allSelected = jobs.length > 0 && selected.size === jobs.length
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const selectedCount = selected.size

  // ═════ Écrans ═════
  if (phase === 'parsing') {
    return (
      <div className="px-6 py-14 text-center space-y-5">
        <div className="relative w-20 h-20 mx-auto">
          <div className="w-20 h-20 rounded-full border-2 animate-spin" style={{ borderColor: 'rgba(232,163,61,0.2)', borderTopColor: '#E8A33D' }} />
          <Sparkles className="h-7 w-7 absolute inset-0 m-auto" style={{ color: '#E8A33D' }} />
        </div>
        <div>
          <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Analyse en cours…</h3>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>{fileName}</p>
        </div>
        <div className="flex items-center gap-2 justify-center flex-wrap">
          {['Lecture du fichier', 'Extraction des offres', 'Contrôle des données'].map((s, i) => (
            <span key={s} className="text-xs animate-pulse" style={{ color: 'var(--color-text-muted)', animationDelay: `${i * 0.3}s` }}>{i > 0 && '· '}{s}</span>
          ))}
        </div>
        <p className="text-xs max-w-sm mx-auto" style={{ color: 'var(--color-text-muted)' }}>Les fichiers Excel et CSV sont lus directement, même avec des milliers de lignes. Les autres formats passent par l’IA.</p>
      </div>
    )
  }

  if (phase === 'importing') {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
    const eta = progress.done > 0 ? (elapsed / progress.done) * (progress.total - progress.done) : 0
    return (
      <div className="px-6 py-10 space-y-6">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center" style={{ background: 'rgba(232,163,61,0.14)' }}><Loader2 className="h-8 w-8 animate-spin" style={{ color: '#E8A33D' }} /></div>
          <h3 className="text-lg font-bold mt-4" style={{ color: 'var(--color-text)' }}>Import en cours… {pct} %</h3>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>Ne fermez pas cette fenêtre tant que l’import n’est pas terminé.</p>
        </div>
        <div>
          <div className="h-3 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.08)' }}>
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #E8A33D, #f0c36b)' }} />
          </div>
          <div className="flex justify-between text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>
            <span><strong style={{ color: 'var(--color-text)' }}>{progress.done}</strong> / {progress.total} offres traitées</span>
            <span>{fmtDuration(elapsed)}{progress.done > 0 && progress.done < progress.total ? ` · encore ~${fmtDuration(eta)}` : ''}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(16,185,129,0.08)' }}><p className="text-xl font-bold" style={{ color: '#059669' }}>{progress.created}</p><p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>créées</p></div>
          <div className="rounded-xl p-3 text-center" style={{ background: progress.failed ? 'rgba(239,68,68,0.08)' : 'rgba(0,0,0,0.04)' }}><p className="text-xl font-bold" style={{ color: progress.failed ? '#dc2626' : 'var(--color-text-muted)' }}>{progress.failed}</p><p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>en erreur</p></div>
        </div>
        <button type="button" onClick={() => { cancelRef.current = true }} className="mx-auto flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}><X className="h-3.5 w-3.5" />Arrêter après le lot en cours</button>
      </div>
    )
  }

  if (phase === 'done') {
    const ok = progress.failed === 0 && !cancelled
    return (
      <div className="px-6 py-10 text-center space-y-5">
        <div className="w-20 h-20 rounded-full mx-auto flex items-center justify-center" style={{ background: ok ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.14)' }}>
          {ok ? <CheckCircle2 className="h-10 w-10" style={{ color: '#10b981' }} /> : <AlertCircle className="h-10 w-10" style={{ color: '#d97706' }} />}
        </div>
        <div>
          <h3 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>{progress.created} offre{progress.created > 1 ? 's' : ''} importée{progress.created > 1 ? 's' : ''}</h3>
          <p className="text-sm mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
            {ok ? `Tout s’est bien passé (en ${fmtDuration(elapsed)}). Vos offres sont publiées et visibles par les candidats.`
              : cancelled ? `Import arrêté : ${progress.total - progress.done} offre${progress.total - progress.done > 1 ? 's' : ''} non traitée${progress.total - progress.done > 1 ? 's' : ''}.`
              : `${progress.failed} offre${progress.failed > 1 ? 's' : ''} n’ont pas pu être créée${progress.failed > 1 ? 's' : ''}.`}
          </p>
          {progress.total > BULK_FROM && <p className="text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>Import en masse : les offres ont été créées sans publication automatique sur les réseaux ni recherche de candidats ; vous pouvez les lancer offre par offre.</p>}
        </div>
        {failures.length > 0 && (
          <div className="text-left rounded-xl p-3 max-h-40 overflow-y-auto text-xs space-y-1" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
            {failures.slice(0, 50).map((f, i) => <p key={i} style={{ color: '#b91c1c' }}><strong>{f.title}</strong> — {f.error}</p>)}
            {failures.length > 50 && <p style={{ color: 'var(--color-text-muted)' }}>… et {failures.length - 50} autres.</p>}
          </div>
        )}
        <div className="flex gap-3 justify-center flex-wrap">
          <button type="button" onClick={onClose} className="px-6 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--color-primary)', color: 'white' }}>Voir mes offres</button>
          <button type="button" onClick={reset} className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold" style={{ ...card, color: 'var(--color-text-muted)' }}><RotateCcw className="h-4 w-4" />Nouvel import</button>
        </div>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="px-6 py-10 text-center space-y-5">
        <div className="w-20 h-20 rounded-full mx-auto flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.1)' }}><AlertCircle className="h-10 w-10" style={{ color: '#ef4444' }} /></div>
        <div><h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>L’import n’a pas abouti</h3><p className="text-sm mt-2 max-w-md mx-auto" style={{ color: '#b91c1c' }}>{message}</p></div>
        <button type="button" onClick={reset} className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--color-primary)', color: 'white' }}><RotateCcw className="h-4 w-4" />Réessayer</button>
      </div>
    )
  }

  if (phase === 'review') {
    const skipped = result?.skipped ?? []
    return (
      <div className="flex flex-col max-h-[72vh]">
        <div className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="min-w-0">
            <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{jobs.length} offre{jobs.length > 1 ? 's' : ''} détectée{jobs.length > 1 ? 's' : ''}{isSheet && result?.totalRows ? ` sur ${result.totalRows} ligne${result.totalRows > 1 ? 's' : ''}` : ''}</p>
            <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {isSheet ? <FileSpreadsheet className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}{isSheet ? 'Lecture directe du tableur' : 'Extraction par l’IA'} · {fileName}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setSelected(allSelected ? new Set() : new Set(jobs.map(j => j.id)))} className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>{allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}</button>
            <button type="button" onClick={reset} aria-label="Recommencer" className="p-1.5 rounded-lg" style={{ color: 'var(--color-text-muted)' }}><RotateCcw className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-3 flex-1">
          {skipped.length > 0 && (
            <div className="rounded-xl px-3.5 py-2.5 text-xs" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#92400e' }}>
              <button type="button" onClick={() => setShowSkipped(v => !v)} className="font-semibold text-left w-full">
                {skipped.length} ligne{skipped.length > 1 ? 's' : ''} ignorée{skipped.length > 1 ? 's' : ''} {showSkipped ? '▲' : '▼'}
              </button>
              {showSkipped && <ul className="mt-1.5 space-y-0.5 max-h-28 overflow-y-auto">{skipped.map((s, i) => <li key={i}>Ligne {s.row} : {s.reason}</li>)}</ul>}
            </div>
          )}

          {jobs.length === 0 ? (
            <div className="text-center py-12" style={{ color: 'var(--color-text-muted)' }}>
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" /><p className="text-sm">Aucune offre détectée dans ce fichier.</p>
              <button type="button" onClick={reset} className="mt-3 text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>Essayer un autre fichier</button>
            </div>
          ) : editable ? (
            jobs.map(job => (
              <JobCard key={job.id} job={job} selected={selected.has(job.id)} onToggle={() => toggle(job.id)}
                onUpdate={p => setJobs(prev => prev.map(j => (j.id === job.id ? { ...j, ...p } : j)))}
                onRemove={() => { setJobs(prev => prev.filter(j => j.id !== job.id)); setSelected(s => { const n = new Set(s); n.delete(job.id); return n }) }} />
            ))
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={card}>
                <Search className="h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
                <input value={query} onChange={e => { setQuery(e.target.value); setPage(0) }} placeholder="Rechercher dans les offres…" className="flex-1 bg-transparent outline-none text-sm" style={{ color: 'var(--color-text)' }} />
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{filtered.length}</span>
              </div>
              <div className="rounded-xl overflow-hidden" style={card}>
                {shown.map(j => (
                  <label key={j.id} className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <input type="checkbox" checked={selected.has(j.id)} onChange={() => toggle(j.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{j.title}</span>
                      <span className="block text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>{[j.companyName, j.location].filter(Boolean).join(' · ') || '—'}</span>
                    </span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: 'rgba(232,163,61,0.14)', color: '#b8862f' }}>{CONTRACT[j.contractType]}</span>
                    {j.salary != null && <span className="text-xs shrink-0 hidden sm:block" style={{ color: 'var(--color-text-muted)' }}>{j.salary} €</span>}
                  </label>
                ))}
                {shown.length === 0 && <p className="text-sm text-center py-6" style={{ color: 'var(--color-text-muted)' }}>Aucun résultat.</p>}
              </div>
              <div className="flex items-center justify-between text-xs" style={{ color: 'var(--color-text-muted)' }}>
                <span>Page {page + 1} / {pageCount}</span>
                <div className="flex gap-1">
                  <button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)} aria-label="Page précédente" className="p-1.5 rounded-lg disabled:opacity-30" style={card}><ChevronLeft className="h-4 w-4" /></button>
                  <button type="button" disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)} aria-label="Page suivante" className="p-1.5 rounded-lg disabled:opacity-30" style={card}><ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3.5" style={{ borderTop: '1px solid var(--color-border)' }}>
          {selectedCount > BULK_FROM && <p className="text-[11px] mb-2" style={{ color: 'var(--color-text-muted)' }}>Import en masse : les offres sont créées sans publication automatique sur les réseaux ni recherche de candidats offre par offre.</p>}
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}><strong style={{ color: 'var(--color-text)' }}>{selectedCount}</strong> sélectionnée{selectedCount > 1 ? 's' : ''} sur {jobs.length}</p>
            <button type="button" onClick={runImport} disabled={selectedCount === 0} className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40" style={{ background: 'var(--color-primary)', color: 'white' }}>
              Importer {selectedCount} offre{selectedCount > 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Départ : choix du fichier ──
  return (
    <div className="p-6 space-y-4 max-h-[72vh] overflow-y-auto">
      <div className="flex items-center gap-3 p-3 rounded-2xl flex-wrap" style={card}>
        <Sparkles className="h-4 w-4 shrink-0" style={{ color: '#E8A33D' }} />
        <span className="text-xs shrink-0" style={{ color: 'var(--color-text-muted)' }}>Modèle IA</span>
        <div className="flex gap-1.5 flex-wrap">
          {LLM_OPTIONS.map(o => (
            <button key={o.value} type="button" onClick={() => setLlm(o.value)} className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: llm === o.value ? 'rgba(232,163,61,0.16)' : 'transparent', color: llm === o.value ? '#b8862f' : 'var(--color-text-muted)', border: `1px solid ${llm === o.value ? 'rgba(232,163,61,0.5)' : 'var(--color-border)'}` }}>{o.label}</button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid var(--color-border)' }}>
        {([['file', 'Fichier', Upload], ['paste', 'Coller du texte', ClipboardPaste]] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" onClick={() => setSource(id)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ background: source === id ? 'var(--color-primary)' : 'transparent', color: source === id ? 'white' : 'var(--color-text-muted)' }}><Icon className="h-4 w-4" />{label}</button>
        ))}
      </div>

      {source === 'file' ? (
        <div onClick={() => fileRef.current?.click()} onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
          className="cursor-pointer rounded-3xl border-2 border-dashed flex flex-col items-center justify-center gap-3 py-12 px-6 transition-colors"
          style={{ borderColor: dragging ? '#E8A33D' : 'var(--color-border)', background: dragging ? 'rgba(232,163,61,0.06)' : 'var(--color-surface)' }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(232,163,61,0.14)' }}><Upload className="h-6 w-6" style={{ color: '#E8A33D' }} /></div>
          <div className="text-center">
            <p className="text-base font-bold" style={{ color: 'var(--color-text)' }}>Glissez votre fichier ici</p>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>ou cliquez pour parcourir</p>
            <p className="text-xs mt-3" style={{ color: 'var(--color-text-muted)' }}><strong>Excel / CSV : milliers de lignes acceptés</strong> · PDF · Word · PowerPoint · TXT — 5 Mo max</p>
            <a href="/templates/modele-import-offres.xlsx" download onClick={e => e.stopPropagation()} className="text-xs font-semibold mt-1.5 hover:underline inline-block" style={{ color: 'var(--color-primary)' }}>Télécharger le modèle Excel</a>
          </div>
          <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleFile(f) }} />
        </div>
      ) : (
        <div className="space-y-3">
          <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={9}
            placeholder={`Collez ici vos offres (texte libre, CSV…)\n\nExemple :\nDéveloppeur React Senior — Paris — CDI\nExpertise React, TypeScript, Node.js requise`}
            className="w-full rounded-2xl px-4 py-3 text-sm leading-relaxed outline-none resize-none" style={{ ...card, color: 'var(--color-text)' }} />
          <button type="button" onClick={handlePaste} disabled={!pasteText.trim()} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm disabled:opacity-40" style={{ background: 'var(--color-primary)', color: 'white' }}>
            <Sparkles className="h-4 w-4" />Analyser avec l’IA
          </button>
        </div>
      )}
      <p className="text-[11px] text-center" style={{ color: 'var(--color-text-muted)' }}>Offres importées pour {tenantName}.</p>
    </div>
  )
}
