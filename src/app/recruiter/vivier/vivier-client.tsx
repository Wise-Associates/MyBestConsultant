'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ID } from 'appwrite'
import {
  AlertCircle, Brain, CheckCircle2, ExternalLink, FileDown, FileText, Loader2, Mail, Maximize2, Phone, RefreshCw, Search, Sparkles, Trash2, Upload, Users,
} from 'lucide-react'
import { getBrowserStorage } from '@/lib/appwrite/browser-client'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { secondaryButton } from '@/app/admin/candidats/labels'
import { CandidateAvatar } from '@/components/shared/candidate-avatar'
import { CandidateProfileModal } from '@/app/recruiter/cvtheque/candidate-profile-modal'
import type { CvThequeCandidate } from '@/app/recruiter/cvtheque/actions'
import { VIVIER_MATCH_MIN_SCORE, matchingOffers, newOffersFor } from '@/lib/vivier-matching'
import { EsnExportDialog } from '@/components/cv-export/esn-export-dialog'
import type { CvExportAccess } from '@/lib/cv-export/recruiter'
import { attachVivierCv, deleteVivierCv, getVivierCvExportVersions, reanalyseVivierCv, type VivierCv } from './actions'
import { UnmatchedCvs } from './unmatched-cvs'

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

type OpenOffer = { $id: string; title: string }
const NO_OFFERS: OpenOffer[] = []

/** Score et raison affichés : ceux de l'offre du vivier ; au vivier général, ceux de l'offre filtrée, sinon de la meilleure. */
function displayedMatch(cv: VivierCv, offerFilter: string, openIds: Set<string>): { score: number | null; reason: string } {
  if (cv.jobId !== null) return { score: cv.matchScore, reason: cv.matchReason }
  const s = offerFilter ? cv.offerScores.find(x => x.jobId === offerFilter) : matchingOffers(cv.offerScores, openIds)[0]
  return { score: s?.score ?? null, reason: s?.reason ?? '' }
}

/** Vivier d'une offre (`jobId`), ou vivier général (`jobId` null) : CV comparés aux `openOffers` de l'organisation. */
export function VivierClient({ jobId, bucketId, initialCvs, loadError, isAdmin, currentUserId, openOffers = NO_OFFERS, cvExport = null, cvExportError }: {
  jobId: string | null
  bucketId: string
  initialCvs: VivierCv[]
  loadError?: string
  isAdmin: boolean
  currentUserId: string
  /** Vivier général : offres ouvertes de l'organisation, la plus récente d'abord. */
  openOffers?: OpenOffer[]
  /** « Format ESN » dans le modèle de l'organisation, comme dans la CV Thèque (ADR 0016) ; null : pas de bouton. */
  cvExport?: CvExportAccess | null
  cvExportError?: string
}) {
  const general = jobId === null
  const [cvs, setCvs] = useState(initialCvs)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [doneCount, setDoneCount] = useState(0)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'recent' | 'score'>('recent')
  const [openCv, setOpenCv] = useState<VivierCv | null>(null)
  const [exportFor, setExportFor] = useState<VivierCv | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState('')
  // Vivier général : CV importé mais pas comparé aux offres (adresse non vérifiée, quota du jour, IA indisponible).
  const [matchNotice, setMatchNotice] = useState('')
  const [offerFilter, setOfferFilter] = useState('')
  // Vivier général : l'import est dans une fenêtre, pour laisser la liste des offres visible sous le vivier.
  const [importOpen, setImportOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const patchUpload = (key: string, p: Partial<UploadItem>) => setUploads(u => u.map(x => (x.key === key ? { ...x, ...p } : x)))

  async function importOne(file: File, key: string) {
    if (file.size > MAX_SIZE) { patchUpload(key, { status: 'error', error: 'Fichier trop volumineux (10 Mo maximum)' }); return }
    try {
      const uploaded = await getBrowserStorage().createFile(bucketId, ID.unique(), file, undefined, p => patchUpload(key, { pct: Math.round(p.progress) }))
      patchUpload(key, { status: 'analysing', pct: 100 })
      const res = await attachVivierCv(jobId, uploaded.$id, file.name)
      if (res.error || !res.cv) { patchUpload(key, { status: 'error', error: res.error ?? 'Import impossible' }); return }
      if (res.notice) setMatchNotice(res.notice)
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
    setNotice(''); setMatchNotice(''); setDoneCount(0)
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
    if (res.error || !res.cv) { setNotice(res.error ?? 'Analyse impossible'); return }
    const updated = res.cv
    setCvs(prev => prev.map(c => (c.$id === cv.$id ? updated : c)))
    if (res.notice) setMatchNotice(res.notice)
  }

  const replaceCv = (updated: VivierCv) => setCvs(prev => prev.map(c => (c.$id === updated.$id ? updated : c)))

  const openIds = useMemo(() => new Set(openOffers.map(o => o.$id)), [openOffers])
  const offerTitles = useMemo(() => new Map(openOffers.map(o => [o.$id, o.title])), [openOffers])
  // Nombre de CV du vivier général correspondant à chaque offre (filtre par offre).
  const matchCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const cv of cvs) for (const m of matchingOffers(cv.offerScores, openIds)) counts.set(m.jobId, (counts.get(m.jobId) ?? 0) + 1)
    return counts
  }, [cvs, openIds])
  const unmatched = useMemo(
    () => (general ? cvs.filter(cv => cv.profileReady && matchingOffers(cv.offerScores, openIds).length === 0) : []),
    [general, cvs, openIds],
  )

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = q ? cvs.filter(c => `${c.candidateName} ${c.title} ${c.candidateEmail} ${c.skills.join(' ')} ${c.experienceSummary}`.toLowerCase().includes(q)) : cvs
    if (offerFilter) list = list.filter(c => c.offerScores.some(s => s.jobId === offerFilter && s.score >= VIVIER_MATCH_MIN_SCORE))
    const score = (c: VivierCv) => displayedMatch(c, offerFilter, openIds).score ?? -1
    return sort === 'score' || offerFilter ? [...list].sort((a, b) => score(b) - score(a)) : list
  }, [cvs, query, sort, offerFilter, openIds])

  const busyUploads = uploads.filter(u => u.status !== 'error').length

  // Zone d'import et progression : en haut du vivier d'une offre, dans la fenêtre d'import au vivier général.
  const importPanel = (
    <>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        role="button" tabIndex={0} aria-label="Choisir des CV à importer"
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
        className="rounded-3xl p-8 text-center cursor-pointer transition-all hover:-translate-y-0.5"
        style={{ background: dragging ? 'rgba(232,163,61,0.08)' : 'var(--color-surface)', border: `2px dashed ${dragging ? '#E8A33D' : 'var(--color-border)'}` }}>
        <input ref={inputRef} type="file" multiple accept=".pdf,.doc,.docx" className="hidden" onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: 'rgba(232,163,61,0.14)' }}><Upload className="h-6 w-6" style={{ color: '#E8A33D' }} /></div>
        <p className="font-bold" style={{ color: 'var(--color-text)' }}>Glissez vos CV ici, ou cliquez pour parcourir</p>
        <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-muted)' }}>PDF, DOC, DOCX — plusieurs fichiers à la fois, 10 Mo max chacun</p>
        <p className="text-xs mt-1 flex items-center justify-center gap-1.5" style={{ color: '#b8862f' }}>
          <Sparkles className="h-3.5 w-3.5" />
          {general ? 'Le profil est créé à partir de chaque CV, puis comparé par l’IA à vos offres ouvertes' : 'Le profil du candidat est créé automatiquement à partir de chaque CV'}
        </p>
      </div>

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
    </>
  )

  const matchNoticeBox = matchNotice ? (
    <div role="status" className="flex items-start gap-3 p-4 rounded-2xl" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: '#b45309' }} /><p className="text-sm" style={{ color: '#92400e' }}>{matchNotice}</p>
    </div>
  ) : null

  return (
    <div className="space-y-6">
      {!general && importPanel}

      {matchNoticeBox}

      {cvExportError && (
        <div role="status" className="flex items-center gap-3 p-4 rounded-2xl" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
          <AlertCircle className="h-4 w-4 shrink-0" style={{ color: '#b45309' }} /><p className="text-sm" style={{ color: '#b45309' }}>{cvExportError}</p>
        </div>
      )}

      {(loadError || notice) && (
        <div className="flex items-center gap-3 p-4 rounded-2xl" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
          <AlertCircle className="h-4 w-4 shrink-0" style={{ color: '#ef4444' }} /><p className="text-sm" style={{ color: '#dc2626' }}>{loadError || notice}</p>
        </div>
      )}

      {/* Barre d'outils */}
      {(cvs.length > 0 || general) && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}><Users className="h-4 w-4" style={{ color: '#E8A33D' }} />{cvs.length} profil{cvs.length > 1 ? 's' : ''} dans le vivier</p>
          <div className="flex items-center gap-2 flex-wrap">
            {general && (
              <button type="button" onClick={() => setImportOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
                style={{ background: 'var(--color-primary)', color: 'var(--color-primary-fg)' }}>
                {busyUploads > 0 ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
                {busyUploads > 0 ? `Import en cours (${busyUploads})` : 'Importer des CV'}
              </button>
            )}
            {general && cvs.length > 0 && <UnmatchedCvs cvs={unmatched} openOffers={openOffers} onUpdated={replaceCv} />}
            {general && cvs.length > 0 && openOffers.length > 0 && (
              <select value={offerFilter} onChange={e => setOfferFilter(e.target.value)} aria-label="Filtrer par offre" className="rounded-xl px-3 py-2 text-sm outline-none max-w-[240px]" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                <option value="">Toutes les offres</option>
                {openOffers.map(o => <option key={o.$id} value={o.$id}>{o.title} ({matchCounts.get(o.$id) ?? 0})</option>)}
              </select>
            )}
            {cvs.length > 0 && (<>
            <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <Search className="h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nom, compétence, poste…" className="bg-transparent outline-none text-sm w-44" style={{ color: 'var(--color-text)' }} />
            </div>
            <select value={sort} onChange={e => setSort(e.target.value as 'recent' | 'score')} className="rounded-xl px-3 py-2 text-sm outline-none" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              <option value="recent">Plus récents</option><option value="score">Meilleur matching</option>
            </select>
            </>)}
          </div>
        </div>
      )}

      {/* Cartes de profils */}
      {cvs.length === 0 && uploads.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" style={{ color: 'var(--color-text)' }} />
          <p style={{ color: 'var(--color-text-muted)' }}>
            {general ? 'Aucun CV dans le vivier général. « Importer des CV » : chacun est comparé à vos offres ouvertes.' : 'Aucun CV importé pour l’instant. Déposez un CV : son profil apparaît ici.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {shown.map(cv => {
            const working = busyId === cv.$id
            const match = displayedMatch(cv, offerFilter, openIds)
            const matches = general ? matchingOffers(cv.offerScores, openIds) : []
            const notCompared = general ? newOffersFor(cv.offerScores, openOffers).length : 0
            return (
              <div key={cv.$id} onClick={() => cv.profileReady && setOpenCv(cv)}
                className="rounded-3xl p-5 flex flex-col gap-3 transition-all duration-300 hover:-translate-y-1"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 10px 30px -10px rgba(11,29,81,0.14)', cursor: cv.profileReady ? 'pointer' : 'default' }}>
                <div className="flex items-start gap-3.5">
                  <CandidateAvatar initials={(cv.candidateName || '?')[0]?.toUpperCase() ?? '?'} size={52} bgColor="var(--color-surface)" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-base truncate" style={{ color: 'var(--color-text)' }}>{cv.candidateName || '—'}</p>
                      {match.score != null && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${scoreColor(match.score)}18`, color: scoreColor(match.score) }}><Brain className="h-3 w-3" />{match.score}/100</span>
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
                    {general && (matches.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>Correspond à</span>
                        {matches.slice(0, 3).map(m => (
                          // Ouvre l'offre (sa page dans l'espace recruteur) sans ouvrir le profil de la carte.
                          <Link key={m.jobId} href={`/recruiter/pipeline/${m.jobId}`} onClick={e => e.stopPropagation()} title={`Voir l’offre « ${offerTitles.get(m.jobId)} »`}
                            className="inline-flex items-center gap-1 max-w-full px-2.5 py-1 rounded-full text-[11px] font-semibold no-underline transition-opacity hover:opacity-80 hover:underline"
                            style={{ background: `${scoreColor(m.score)}18`, color: scoreColor(m.score) }}>
                            <span className="truncate max-w-[180px]">{offerTitles.get(m.jobId)}</span>· {m.score}
                          </Link>
                        ))}
                        {matches.length > 3 && <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>+{matches.length - 3}</span>}
                      </div>
                    ) : (
                      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {notCompared > 0
                          ? `Pas encore comparé à ${notCompared} offre${notCompared > 1 ? 's' : ''} : synchronisez depuis « Sans offre correspondante ».`
                          : 'Aucune offre ouverte ne correspond à ce profil pour l’instant.'}
                      </p>
                    ))}
                    {match.reason && <p className="text-xs italic line-clamp-2" style={{ color: 'var(--color-text-muted)' }}>« {match.reason} »</p>}
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
                  {/* Profil créé seulement : son nom sert au contrôle d'anonymisation de l'export. */}
                  {cvExport?.template && cv.cvFileId && cv.profileReady && (
                    <button type="button" onClick={() => setExportFor(cv)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-opacity hover:opacity-90"
                      style={{
                        background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)', color: 'var(--color-primary)',
                        border: '1px solid color-mix(in srgb, var(--color-primary) 25%, transparent)',
                      }}>
                      <FileDown className="h-3.5 w-3.5" />CV format cabinet
                    </button>
                  )}
                  {cv.candidateEmail && <a href={`mailto:${cv.candidateEmail}`} aria-label="Écrire au candidat" className="p-2 rounded-xl" style={{ background: 'rgba(59,130,246,0.08)', color: '#2563eb' }}><Mail className="h-4 w-4" /></a>}
                  {cv.candidatePhone && <a href={`tel:${cv.candidatePhone}`} aria-label="Appeler le candidat" className="p-2 rounded-xl" style={{ background: 'rgba(16,185,129,0.08)', color: '#10b981' }}><Phone className="h-4 w-4" /></a>}
                  <button type="button" onClick={() => remove(cv)} disabled={working} aria-label="Supprimer" className="ml-auto p-2 rounded-xl disabled:opacity-40" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            )
          })}
          {shown.length === 0 && (
            <p className="text-sm py-8 text-center md:col-span-2" style={{ color: 'var(--color-text-muted)' }}>
              {query.trim() ? `Aucun profil ne correspond à « ${query} ».` : 'Aucun CV du vivier ne correspond à cette offre.'}
            </p>
          )}
        </div>
      )}

      {general && (
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogContent className="admin-light sm:max-w-130 max-h-[90vh] overflow-y-auto" style={{ background: 'var(--admin-panel)' }}>
            <DialogHeader>
              <DialogTitle className="text-admin-fg" style={{ fontSize: '1.05rem' }}>Importer des CV</DialogTitle>
              <DialogDescription style={{ color: 'var(--admin-fg-muted)' }}>
                Sans choisir d&apos;offre : chaque CV devient un profil, puis l&apos;IA le compare à vos offres ouvertes. Vous pouvez fermer
                cette fenêtre, l&apos;import continue.
              </DialogDescription>
            </DialogHeader>
            {importPanel}
            {matchNoticeBox}
            <DialogFooter>
              <button type="button" onClick={() => setImportOpen(false)} style={{ ...secondaryButton, justifyContent: 'center' }}>Fermer</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {cvExport?.template && (
        // key : choix et compte rendu remis à zéro pour chaque CV
        <EsnExportDialog key={exportFor?.$id ?? 'none'} candidate={exportFor && { id: exportFor.$id, name: exportFor.candidateName || exportFor.fileName }}
          onClose={() => setExportFor(null)} endpoint="/api/recruiter/vivier/cv-export" loadVersions={getVivierCvExportVersions}
          esn={cvExport.template.esn} generationDenied={cvExport.generationDenied} quotaLimited />
      )}

      {openCv && <CandidateProfileModal candidate={toCandidate(openCv)} vivier matchScore={displayedMatch(openCv, offerFilter, openIds).score} onClose={() => setOpenCv(null)} />}
    </div>
  )
}
