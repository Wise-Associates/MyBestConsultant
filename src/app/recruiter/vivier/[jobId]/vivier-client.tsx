'use client'

import { useMemo, useRef, useState } from 'react'
import { ID } from 'appwrite'
import {
  AlertCircle, Brain, CheckCircle2, ExternalLink, FileText, Loader2, Mail, Maximize2, Phone, RefreshCw, Search, Sparkles, Trash2, Upload, Users,
} from 'lucide-react'
import { getBrowserStorage } from '@/lib/appwrite/browser-client'
import { CandidateAvatar } from '@/components/shared/candidate-avatar'
import { CandidateProfileModal } from '@/app/recruiter/cvtheque/candidate-profile-modal'
import type { CvThequeCandidate } from '@/app/recruiter/cvtheque/actions'
import { attachVivierCv, deleteVivierCv, reanalyseVivierCv, type VivierCv } from './actions'

type UploadStatus = 'uploading' | 'analysing' | 'error'
interface UploadItem { key: string; name: string; pct: number; status: UploadStatus; error?: string }

const CONCURRENCY = 3
const MAX_SIZE = 10 * 1024 * 1024

// Un CV du vivier n'a pas de compte candidat : on le présente comme une fiche de la CVthèque.
function toCandidate(cv: VivierCv): CvThequeCandidate {
  return {
    $id: cv.$id, name: cv.candidateName, email: cv.candidateEmail, phone: cv.candidatePhone, whatsapp: '', city: '', mobilityRadiusKm: null,
    skills: cv.skills, experienceSummary: cv.experienceSummary, experiences: cv.experiences, education: cv.education, languages: cv.languages,
    yearsOfExperience: cv.yearsOfExperience, cvFileId: cv.cvFileId, photoUrl: '', openToWork: false, desiredSector: [],
    desiredRoles: cv.title ? [cv.title] : [], createdAt: cv.createdAt,
  }
}

const scoreColor = (n: number) => (n >= 75 ? '#10b981' : n >= 50 ? '#f59e0b' : '#ef4444')

export function VivierClient({ jobId, bucketId, initialCvs, loadError, isAdmin, currentUserId }: {
  jobId: string
  bucketId: string
  initialCvs: VivierCv[]
  loadError?: string
  isAdmin: boolean
  currentUserId: string
}) {
  const [cvs, setCvs] = useState(initialCvs)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [doneCount, setDoneCount] = useState(0)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'recent' | 'score'>('recent')
  const [openCv, setOpenCv] = useState<VivierCv | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const patchUpload = (key: string, p: Partial<UploadItem>) => setUploads(u => u.map(x => (x.key === key ? { ...x, ...p } : x)))

  async function importOne(file: File, key: string) {
    if (file.size > MAX_SIZE) { patchUpload(key, { status: 'error', error: 'Fichier trop volumineux (10 Mo maximum)' }); return }
    try {
      const uploaded = await getBrowserStorage().createFile(bucketId, ID.unique(), file, undefined, p => patchUpload(key, { pct: Math.round(p.progress) }))
      patchUpload(key, { status: 'analysing', pct: 100 })
      const res = await attachVivierCv(jobId, uploaded.$id, file.name)
      if (res.error || !res.cv) { patchUpload(key, { status: 'error', error: res.error ?? 'Import impossible' }); return }
      setUploads(u => u.filter(x => x.key !== key))
      setCvs(prev => [res.cv!, ...prev.filter(c => c.$id !== res.cv!.$id)])
      setDoneCount(n => n + 1)
    } catch (e) {
      patchUpload(key, { status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  // Envoi de plusieurs CV : 3 à la fois (chaque CV est envoyé, puis son profil est créé automatiquement).
  async function handleFiles(files: FileList | File[] | null) {
    const list = files ? Array.from(files) : []
    if (list.length === 0) return
    setNotice(''); setDoneCount(0)
    const items = list.map((f, i) => ({ file: f, key: `${Date.now()}-${i}-${f.name}` }))
    setUploads(u => [...u, ...items.map(({ file, key }) => ({ key, name: file.name, pct: 0, status: 'uploading' as const }))])
    let next = 0
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) { const it = items[next++]; await importOne(it.file, it.key) }
    }))
  }

  async function remove(cv: VivierCv) {
    if (!window.confirm(`Supprimer le CV de ${cv.candidateName || cv.fileName} du vivier ?`)) return
    setBusyId(cv.$id)
    const res = await deleteVivierCv(jobId, cv.$id)
    setBusyId(null)
    if (res.error) setNotice(res.error); else setCvs(prev => prev.filter(c => c.$id !== cv.$id))
  }

  async function reanalyse(cv: VivierCv) {
    setBusyId(cv.$id); setNotice('')
    const res = await reanalyseVivierCv(jobId, cv.$id)
    setBusyId(null)
    if (res.error || !res.cv) setNotice(res.error ?? 'Analyse impossible'); else setCvs(prev => prev.map(c => (c.$id === cv.$id ? res.cv! : c)))
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? cvs.filter(c => `${c.candidateName} ${c.title} ${c.candidateEmail} ${c.skills.join(' ')} ${c.experienceSummary}`.toLowerCase().includes(q)) : cvs
    return sort === 'score' ? [...list].sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1)) : list
  }, [cvs, query, sort])

  const busyUploads = uploads.filter(u => u.status !== 'error').length

  return (
    <div className="space-y-6">
      {/* Zone d'import */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className="rounded-3xl p-8 text-center cursor-pointer transition-all hover:-translate-y-0.5"
        style={{ background: dragging ? 'rgba(232,163,61,0.08)' : 'var(--color-surface)', border: `2px dashed ${dragging ? '#E8A33D' : 'var(--color-border)'}` }}>
        <input ref={inputRef} type="file" multiple accept=".pdf,.doc,.docx" className="hidden" onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: 'rgba(232,163,61,0.14)' }}><Upload className="h-6 w-6" style={{ color: '#E8A33D' }} /></div>
        <p className="font-bold" style={{ color: 'var(--color-text)' }}>Glissez vos CV ici, ou cliquez pour parcourir</p>
        <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-muted)' }}>PDF, DOC, DOCX — plusieurs fichiers à la fois, 10 Mo max chacun</p>
        <p className="text-xs mt-1 flex items-center justify-center gap-1.5" style={{ color: '#b8862f' }}><Sparkles className="h-3.5 w-3.5" />Le profil du candidat est créé automatiquement à partir de chaque CV</p>
      </div>

      {/* Progression des imports en cours */}
      {(uploads.length > 0 || doneCount > 0) && (
        <div className="space-y-2">
          {busyUploads === 0 && doneCount > 0 && uploads.length === 0 && (
            <div className="flex items-center gap-2.5 p-3.5 rounded-2xl text-sm" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', color: '#047857' }}>
              <CheckCircle2 className="h-4 w-4 shrink-0" />{doneCount} profil{doneCount > 1 ? 's' : ''} créé{doneCount > 1 ? 's' : ''} et ajouté{doneCount > 1 ? 's' : ''} au vivier.
            </div>
          )}
          {uploads.map(u => (
            <div key={u.key} className="p-3.5 rounded-2xl flex items-center gap-3" style={{ background: 'var(--color-surface)', border: `1px solid ${u.status === 'error' ? 'rgba(239,68,68,0.3)' : 'var(--color-border)'}` }}>
              {u.status === 'error' ? <AlertCircle className="h-4 w-4 shrink-0" style={{ color: '#ef4444' }} /> : <Loader2 className="h-4 w-4 animate-spin shrink-0" style={{ color: '#E8A33D' }} />}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: 'var(--color-text)' }}>{u.name}</p>
                {u.status === 'uploading' && (
                  <>
                    <div className="h-1.5 rounded-full mt-1.5" style={{ background: 'rgba(0,0,0,0.08)' }}><div className="h-full rounded-full transition-all" style={{ width: `${u.pct}%`, background: '#E8A33D' }} /></div>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>Envoi du CV… {u.pct} %</p>
                  </>
                )}
                {u.status === 'analysing' && <p className="text-[11px] mt-0.5 flex items-center gap-1" style={{ color: '#b8862f' }}><Sparkles className="h-3 w-3" />Création du profil par l’IA…</p>}
                {u.status === 'error' && <p className="text-xs mt-0.5" style={{ color: '#dc2626' }}>{u.error}</p>}
              </div>
              {u.status === 'error' && <button type="button" onClick={() => setUploads(x => x.filter(i => i.key !== u.key))} className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Fermer</button>}
            </div>
          ))}
        </div>
      )}

      {(loadError || notice) && (
        <div className="flex items-center gap-3 p-4 rounded-2xl" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
          <AlertCircle className="h-4 w-4 shrink-0" style={{ color: '#ef4444' }} /><p className="text-sm" style={{ color: '#dc2626' }}>{loadError || notice}</p>
        </div>
      )}

      {/* Barre d'outils */}
      {cvs.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}><Users className="h-4 w-4" style={{ color: '#E8A33D' }} />{cvs.length} profil{cvs.length > 1 ? 's' : ''} dans le vivier</p>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <Search className="h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nom, compétence, poste…" className="bg-transparent outline-none text-sm w-44" style={{ color: 'var(--color-text)' }} />
            </div>
            <select value={sort} onChange={e => setSort(e.target.value as 'recent' | 'score')} className="rounded-xl px-3 py-2 text-sm outline-none" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              <option value="recent">Plus récents</option><option value="score">Meilleur matching</option>
            </select>
          </div>
        </div>
      )}

      {/* Cartes de profils */}
      {cvs.length === 0 && uploads.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" style={{ color: 'var(--color-text)' }} />
          <p style={{ color: 'var(--color-text-muted)' }}>Aucun CV importé pour l&apos;instant. Déposez un CV : son profil apparaît ici.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {shown.map(cv => {
            const working = busyId === cv.$id
            return (
              <div key={cv.$id} onClick={() => cv.profileReady && setOpenCv(cv)}
                className="rounded-3xl p-5 flex flex-col gap-3 transition-all duration-300 hover:-translate-y-1"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 10px 30px -10px rgba(11,29,81,0.14)', cursor: cv.profileReady ? 'pointer' : 'default' }}>
                <div className="flex items-start gap-3.5">
                  <CandidateAvatar initials={(cv.candidateName || '?')[0]?.toUpperCase() ?? '?'} size={52} bgColor="var(--color-surface)" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-base truncate" style={{ color: 'var(--color-text)' }}>{cv.candidateName || '—'}</p>
                      {cv.matchScore != null && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${scoreColor(cv.matchScore)}18`, color: scoreColor(cv.matchScore) }}><Brain className="h-3 w-3" />{cv.matchScore}/100</span>
                      )}
                    </div>
                    {cv.title && <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-primary)' }}>{cv.title}</p>}
                    <div className="flex items-center gap-3 flex-wrap text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                      {cv.yearsOfExperience != null && <span className="font-semibold" style={{ color: '#b8862f' }}>{cv.yearsOfExperience} an{cv.yearsOfExperience > 1 ? 's' : ''} d&apos;expérience</span>}
                      {cv.candidateEmail && <span className="flex items-center gap-1 min-w-0"><Mail className="h-3 w-3 shrink-0" /><span className="truncate">{cv.candidateEmail}</span></span>}
                      {cv.candidatePhone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{cv.candidatePhone}</span>}
                    </div>
                  </div>
                </div>

                {isAdmin && cv.recruiterId !== currentUserId && (
                  <span className="self-start px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>Importé par un autre recruteur</span>
                )}

                {cv.profileReady ? (
                  <>
                    {cv.experienceSummary && <p className="text-sm leading-relaxed line-clamp-3" style={{ color: 'var(--color-text)' }}>{cv.experienceSummary}</p>}
                    {cv.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {cv.skills.slice(0, 8).map(s => <span key={s} className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: 'rgba(232,163,61,0.1)', color: 'var(--color-primary)' }}>{s}</span>)}
                        {cv.skills.length > 8 && <span className="px-2 py-1 text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>+{cv.skills.length - 8}</span>}
                      </div>
                    )}
                    {cv.matchReason && <p className="text-xs italic line-clamp-2" style={{ color: 'var(--color-text-muted)' }}>« {cv.matchReason} »</p>}
                  </>
                ) : (
                  <div className="rounded-xl p-3 text-xs flex items-start gap-2" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#92400e' }}>
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Le profil n’a pas pu être créé automatiquement.</p>
                      <p className="mt-0.5">Le CV est bien enregistré. Relancez l’analyse pour créer la fiche.</p>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap mt-auto pt-1" onClick={e => e.stopPropagation()}>
                  {cv.profileReady && (
                    <button type="button" onClick={() => setOpenCv(cv)} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-opacity hover:opacity-90" style={{ background: 'linear-gradient(135deg, #E8A33D, #7c3aed)', color: 'white', boxShadow: '0 8px 20px -6px rgba(124,58,237,0.4)' }}><Maximize2 className="h-3.5 w-3.5" />Profil complet</button>
                  )}
                  {!cv.profileReady && (
                    <button type="button" onClick={() => reanalyse(cv)} disabled={working} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold disabled:opacity-60" style={{ background: 'var(--color-primary)', color: 'white' }}>
                      {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Analyser à nouveau
                    </button>
                  )}
                  {cv.cvFileId && (
                    <a href={`/api/vivier-cv/${cv.cvFileId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold no-underline transition-opacity hover:opacity-90" style={{ background: 'rgba(11,29,81,0.06)', color: 'var(--color-primary)' }}><ExternalLink className="h-3.5 w-3.5" />Voir le CV</a>
                  )}
                  {cv.candidateEmail && <a href={`mailto:${cv.candidateEmail}`} aria-label="Écrire au candidat" className="p-2 rounded-xl" style={{ background: 'rgba(59,130,246,0.08)', color: '#2563eb' }}><Mail className="h-4 w-4" /></a>}
                  {cv.candidatePhone && <a href={`tel:${cv.candidatePhone}`} aria-label="Appeler le candidat" className="p-2 rounded-xl" style={{ background: 'rgba(16,185,129,0.08)', color: '#10b981' }}><Phone className="h-4 w-4" /></a>}
                  <button type="button" onClick={() => remove(cv)} disabled={working} aria-label="Supprimer" className="ml-auto p-2 rounded-xl disabled:opacity-40" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            )
          })}
          {shown.length === 0 && <p className="text-sm py-8 text-center md:col-span-2" style={{ color: 'var(--color-text-muted)' }}>Aucun profil ne correspond à « {query} ».</p>}
        </div>
      )}

      {openCv && <CandidateProfileModal candidate={toCandidate(openCv)} vivier matchScore={openCv.matchScore} onClose={() => setOpenCv(null)} />}
    </div>
  )
}
