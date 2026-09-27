'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Send, Upload, X, FileText, CheckCircle2, Loader2, Plus, Paperclip } from 'lucide-react'
import { MobileApplyBar } from './mobile-apply-bar'

interface Props {
  jobId: string
  tenantId: string
  jobTitle: string
  hasCV: boolean
}

export function ApplyModal({ jobId, tenantId, jobTitle, hasCV }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [coverLetter, setCoverLetter] = useState('')
  const [cvFile, setCvFile] = useState<File | null>(null)
  const [docFiles, setDocFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const cvRef = useRef<HTMLInputElement>(null)
  const docsRef = useRef<HTMLInputElement>(null)

  const MAX_LETTER = 2500
  const remaining = MAX_LETTER - coverLetter.length

  const onCvDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) setCvFile(f)
  }, [])

  const addDocs = (files: FileList | null) => {
    if (!files) return
    setDocFiles(prev => [...prev, ...Array.from(files)].slice(0, 5))
  }

  const removeDoc = (i: number) => setDocFiles(prev => prev.filter((_, idx) => idx !== i))

  const submit = async () => {
    if (!hasCV && !cvFile) { setError('Veuillez uploader votre CV.'); return }
    if (!coverLetter.trim()) { setError('Veuillez écrire un message de motivation.'); return }
    setError('')
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('jobId', jobId)
      fd.append('tenantId', tenantId)
      fd.append('coverLetter', coverLetter)
      if (cvFile) fd.append('cv', cvFile)
      docFiles.forEach(f => fd.append('docs', f))

      const res = await fetch('/api/apply', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erreur')
      setDone(true)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inattendue')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
        style={{ background: 'var(--color-primary)', color: 'white' }}
      >
        <Send className="h-4 w-4" />
        Postuler à cette offre
      </button>

      {/* Mobile-only fixed CTA bar — same action/state as the inline button above, but only
          visible once that button has scrolled out of view (see MobileApplyBar). */}
      {!done && (
        <MobileApplyBar>
          <button
            onClick={() => setOpen(true)}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold transition-transform active:scale-[0.98]"
            style={{ background: 'var(--color-primary)', color: 'white', boxShadow: '0 -4px 4px rgba(0,0,0,0.02), 0 12px 28px -6px rgba(232,163,61,0.55)' }}
          >
            <Send className="h-4 w-4" />
            Postuler maintenant
          </button>
        </MobileApplyBar>
      )}

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
          onClick={e => { if (e.target === e.currentTarget && !loading) setOpen(false) }}
        >
          {/* Modal */}
          <div
            className="relative w-full max-w-xl rounded-2xl overflow-hidden"
            style={{
              background: 'var(--color-background, #fff)',
              border: '1px solid var(--color-border, rgba(0,0,0,0.1))',
              boxShadow: '0 24px 80px rgba(0,0,0,0.25)',
            }}
          >
            {done ? (
              /* ── Success state ── */
              <div className="p-10 text-center space-y-5">
                <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
                  style={{ background: 'rgba(16,185,129,0.1)' }}>
                  <CheckCircle2 className="h-8 w-8" style={{ color: '#10b981' }} />
                </div>
                <div>
                  <h3 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>
                    Candidature envoyée !
                  </h3>
                  <p className="text-sm mt-2" style={{ color: 'var(--color-text-muted)' }}>
                    Votre dossier a bien été transmis. Vous serez contacté prochainement.
                  </p>
                </div>
                <button
                  onClick={() => { setOpen(false); router.push('/candidate/dashboard') }}
                  className="px-6 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: 'var(--color-primary)', color: 'white' }}
                >
                  Voir mon espace
                </button>
              </div>
            ) : (
              /* ── Form ── */
              <>
                {/* Header */}
                <div className="px-7 pt-7 pb-5 flex items-start justify-between"
                  style={{ borderBottom: '1px solid var(--color-border, rgba(0,0,0,0.08))' }}>
                  <div>
                    <p className="text-xs font-semibold tracking-widest uppercase mb-1"
                      style={{ color: 'var(--color-primary)' }}>
                      Candidature
                    </p>
                    <h2 className="text-lg font-bold leading-tight" style={{ color: 'var(--color-text)' }}>
                      {jobTitle}
                    </h2>
                  </div>
                  <button onClick={() => !loading && setOpen(false)}
                    className="p-2 rounded-lg transition-opacity hover:opacity-60 ml-4 shrink-0"
                    style={{ color: 'var(--color-text-muted)' }}>
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {/* Body */}
                <div className="px-7 py-6 space-y-6 max-h-[70vh] overflow-y-auto">

                  {/* CV upload zone */}
                  {!hasCV ? (
                    <div>
                      <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
                        CV <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <div
                        className="relative rounded-xl border-2 border-dashed transition-all cursor-pointer"
                        style={{
                          borderColor: dragOver
                            ? 'var(--color-primary)'
                            : cvFile ? '#10b981' : 'var(--color-border, rgba(0,0,0,0.15))',
                          background: dragOver ? 'rgba(11,29,81,0.04)' : 'transparent',
                        }}
                        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={onCvDrop}
                        onClick={() => cvRef.current?.click()}
                      >
                        <input ref={cvRef} type="file" accept=".pdf,.doc,.docx" className="hidden"
                          onChange={e => setCvFile(e.target.files?.[0] ?? null)} />
                        <div className="flex flex-col items-center gap-2 py-7 px-4 text-center">
                          {cvFile ? (
                            <>
                              <FileText className="h-7 w-7" style={{ color: '#10b981' }} />
                              <p className="text-sm font-medium" style={{ color: '#10b981' }}>{cvFile.name}</p>
                              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                {(cvFile.size / 1024).toFixed(0)} Ko
                              </p>
                            </>
                          ) : (
                            <>
                              <Upload className="h-7 w-7" style={{ color: 'var(--color-text-muted)' }} />
                              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                                Glissez votre CV ici
                              </p>
                              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                PDF, DOC, DOCX — max 10 Mo
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
                      style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)' }}>
                      <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: '#10b981' }} />
                      <p className="text-sm" style={{ color: '#059669' }}>
                        CV déjà enregistré dans votre profil
                      </p>
                      <button className="ml-auto text-xs underline shrink-0"
                        style={{ color: 'var(--color-text-muted)' }}
                        onClick={e => { e.stopPropagation(); cvRef.current?.click() }}>
                        Remplacer
                      </button>
                      <input ref={cvRef} type="file" accept=".pdf,.doc,.docx" className="hidden"
                        onChange={e => setCvFile(e.target.files?.[0] ?? null)} />
                    </div>
                  )}

                  {/* Cover letter */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                        Message de motivation <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <span className="text-xs" style={{ color: remaining < 200 ? '#f59e0b' : 'var(--color-text-muted)' }}>
                        {remaining} caractères restants
                      </span>
                    </div>
                    <textarea
                      value={coverLetter}
                      onChange={e => setCoverLetter(e.target.value.slice(0, MAX_LETTER))}
                      rows={6}
                      placeholder="Présentez-vous, expliquez votre intérêt pour ce poste et ce que vous apportez à l'équipe…"
                      className="w-full rounded-xl px-4 py-3 text-sm resize-none outline-none transition-all"
                      style={{
                        background: 'var(--color-surface, #f8f9fa)',
                        border: '1.5px solid var(--color-border, rgba(0,0,0,0.12))',
                        color: 'var(--color-text)',
                        lineHeight: 1.7,
                      }}
                      onFocus={e => (e.target.style.borderColor = 'var(--color-primary)')}
                      onBlur={e => (e.target.style.borderColor = 'var(--color-border, rgba(0,0,0,0.12))')}
                    />
                  </div>

                  {/* Additional docs */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                        Documents complémentaires
                        <span className="text-xs font-normal ml-2" style={{ color: 'var(--color-text-muted)' }}>
                          (facultatif — portfolio, lettre, etc.)
                        </span>
                      </label>
                    </div>
                    <div className="space-y-2">
                      {docFiles.map((f, i) => (
                        <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                          style={{ background: 'var(--color-surface, #f8f9fa)', border: '1px solid var(--color-border)' }}>
                          <Paperclip className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--color-primary)' }} />
                          <span className="text-sm flex-1 truncate" style={{ color: 'var(--color-text)' }}>{f.name}</span>
                          <span className="text-xs shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                            {(f.size / 1024).toFixed(0)} Ko
                          </span>
                          <button onClick={() => removeDoc(i)}
                            className="p-0.5 rounded transition-opacity hover:opacity-60">
                            <X className="h-3.5 w-3.5" style={{ color: 'var(--color-text-muted)' }} />
                          </button>
                        </div>
                      ))}
                      {docFiles.length < 5 && (
                        <button
                          onClick={() => docsRef.current?.click()}
                          className="flex items-center gap-2 px-3 py-2.5 rounded-lg w-full text-sm transition-opacity hover:opacity-70"
                          style={{
                            border: '1.5px dashed var(--color-border, rgba(0,0,0,0.15))',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          <Plus className="h-4 w-4" />
                          Ajouter un document
                        </button>
                      )}
                      <input ref={docsRef} type="file" multiple accept=".pdf,.doc,.docx,.png,.jpg" className="hidden"
                        onChange={e => addDocs(e.target.files)} />
                    </div>
                  </div>

                  {/* Error */}
                  {error && (
                    <div className="px-4 py-3 rounded-xl text-sm"
                      style={{ background: 'rgba(239,68,68,0.07)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.15)' }}>
                      {error}
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="px-7 pb-7 pt-4 flex gap-3"
                  style={{ borderTop: '1px solid var(--color-border, rgba(0,0,0,0.08))' }}>
                  <button
                    onClick={() => !loading && setOpen(false)}
                    className="flex-1 py-3 rounded-xl text-sm font-medium transition-opacity hover:opacity-70"
                    style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}
                  >
                    Annuler
                  </button>
                  <button
                    onClick={submit}
                    disabled={loading}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-60"
                    style={{ background: 'var(--color-primary)', color: 'white' }}
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {loading ? 'Envoi…' : 'Envoyer ma candidature'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
