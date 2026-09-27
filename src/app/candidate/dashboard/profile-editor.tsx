'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import {
  Sparkles, Check, Loader2, X, Camera, Network as Linkedin, Briefcase, Building2,
  Wand2, AlertCircle, Pencil, Phone as PhoneIcon, MapPin, Navigation,
} from 'lucide-react'
import { updateCandidateProfile, fetchLinkedinPhoto, fetchPhotoFromCV } from './actions'
import { SECTORS, SUGGESTED_MISSION_TYPES } from '@/lib/candidate-taxonomy'

const inpStyle = {
  background: 'rgba(11,29,81,0.03)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text)',
}
const inp = 'w-full px-3.5 py-2.5 rounded-xl text-sm outline-none transition-colors'

interface Props {
  initialPhone: string
  initialWhatsapp?: string
  initialCity: string
  initialMobilityRadiusKm: number | null
  initialSkills: string[]
  experienceSummary: string
  initialOpenToWork: boolean
  initialDesiredSector: string[]
  initialDesiredRoles: string[]
  initialPhotoUrl: string
  initialLinkedinUrl: string
}

async function compressImage(file: File, maxPx = 480, quality = 0.85): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > maxPx || height > maxPx) {
        if (width > height) { height = Math.round(height * maxPx / width); width = maxPx }
        else { width = Math.round(width * maxPx / height); height = maxPx }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      canvas.toBlob(blob => {
        if (!blob) { resolve(file); return }
        resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }))
      }, 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

function SectionLabel({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <Icon className="h-3.5 w-3.5" style={{ color: 'var(--color-primary)' }} />
      <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-text)' }}>{children}</span>
    </div>
  )
}

function TagInput({ tags, onChange, placeholder, suggestions }: {
  tags: string[]; onChange: (t: string[]) => void; placeholder: string; suggestions?: readonly string[]
}) {
  const [draft, setDraft] = useState('')

  function add(v: string) {
    const t = v.trim()
    if (t && !tags.includes(t)) onChange([...tags, t])
  }
  function commit() { add(draft); setDraft('') }

  return (
    <div>
      <div className="rounded-xl px-3.5 py-3" style={inpStyle}>
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {tags.map(t => (
            <span key={t} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold"
              style={{ background: 'rgba(184,134,11,0.12)', color: 'var(--color-primary)' }}>
              {t}
              <button type="button" onClick={() => onChange(tags.filter(x => x !== t))}>
                <X className="h-3 w-3" style={{ color: 'var(--color-text-muted)' }} />
              </button>
            </span>
          ))}
        </div>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit() }
            if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1))
          }}
          onBlur={commit}
          placeholder={tags.length ? 'Ajouter…' : placeholder}
          className="w-full bg-transparent text-sm outline-none"
          style={{ color: 'var(--color-text)' }}
        />
      </div>
      {suggestions && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {suggestions.filter(s => !tags.includes(s)).slice(0, 8).map(s => (
            <button key={s} type="button" onClick={() => add(s)}
              className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
              style={{ background: 'rgba(11,29,81,0.04)', color: 'var(--color-text-muted)', border: '1px dashed var(--color-border)' }}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SectorPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [otherDraft, setOtherDraft] = useState('')
  const customSectors = value.filter(v => !(SECTORS as readonly string[]).includes(v))

  function toggle(s: string) {
    onChange(value.includes(s) ? value.filter(x => x !== s) : [...value, s])
  }
  function addOther() {
    const t = otherDraft.trim()
    if (t && !value.includes(t)) onChange([...value, t])
    setOtherDraft('')
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {SECTORS.map(s => (
          <button key={s} type="button" onClick={() => toggle(s)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
            style={value.includes(s)
              ? { background: 'var(--color-primary)', color: 'white', boxShadow: '0 4px 10px rgba(11,29,81,0.25)' }
              : { background: 'rgba(11,29,81,0.04)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
            {s}
          </button>
        ))}
      </div>
      {customSectors.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {customSectors.map(s => (
            <span key={s} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold"
              style={{ background: 'var(--color-primary)', color: 'white' }}>
              {s}
              <button type="button" onClick={() => toggle(s)}>
                <X className="h-3 w-3" style={{ color: 'rgba(255,255,255,0.8)' }} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2 mt-2.5">
        <input value={otherDraft} onChange={e => setOtherDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOther() } }}
          onBlur={addOther}
          placeholder="Autre secteur…" className={inp} style={inpStyle} />
      </div>
    </div>
  )
}

export function ProfileEditor({
  initialPhone, initialWhatsapp = '', initialCity, initialMobilityRadiusKm, initialSkills, experienceSummary,
  initialOpenToWork, initialDesiredSector, initialDesiredRoles, initialPhotoUrl, initialLinkedinUrl,
}: Props) {
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState(initialPhone)
  const [whatsapp, setWhatsapp] = useState(initialWhatsapp)
  const [waError, setWaError] = useState<string | null>(null)
  const [city, setCity] = useState(initialCity)
  const [mobility, setMobility] = useState(initialMobilityRadiusKm !== null ? String(initialMobilityRadiusKm) : '')
  const [skills, setSkills] = useState<string[]>(initialSkills)
  const [summary, setSummary] = useState(experienceSummary)
  const [editingSummary, setEditingSummary] = useState(false)
  const [openToWork, setOpenToWork] = useState(initialOpenToWork)
  const [desiredSector, setDesiredSector] = useState(initialDesiredSector)
  const [desiredRoles, setDesiredRoles] = useState<string[]>(initialDesiredRoles)
  const [photoUrl, setPhotoUrl] = useState(initialPhotoUrl)
  const [linkedinUrl, setLinkedinUrl] = useState(initialLinkedinUrl)
  const [uploading, setUploading] = useState(false)
  const [fetchingPhoto, setFetchingPhoto] = useState(false)
  const [linkedinMsg, setLinkedinMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [fetchingCvPhoto, setFetchingCvPhoto] = useState(false)
  const [cvPhotoMsg, setCvPhotoMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const iconChipRef = useRef<HTMLDivElement>(null)
  const iconRef = useRef<SVGSVGElement>(null)
  const titleRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open])

  async function uploadPhoto(file: File) {
    if (!file.type.startsWith('image/')) return
    setUploading(true)
    try {
      const compressed = await compressImage(file)
      const fd = new FormData()
      fd.append('file', compressed)
      fd.append('bucket', 'logos')
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (res.ok) setPhotoUrl(data.url)
    } finally {
      setUploading(false)
    }
  }

  function fetchPhotoFromLinkedin() {
    if (!linkedinUrl) return
    setLinkedinMsg(null)
    setFetchingPhoto(true)
    startTransition(async () => {
      const r = await fetchLinkedinPhoto(linkedinUrl)
      if (r.photoUrl) { setPhotoUrl(r.photoUrl); setLinkedinMsg({ ok: true, text: 'Photo récupérée !' }) }
      else setLinkedinMsg({ ok: false, text: r.error ?? 'Échec de la récupération' })
      setFetchingPhoto(false)
    })
  }

  function fetchPhotoFromCv() {
    setCvPhotoMsg(null)
    setFetchingCvPhoto(true)
    startTransition(async () => {
      const r = await fetchPhotoFromCV()
      if (r.photoUrl) { setPhotoUrl(r.photoUrl); setCvPhotoMsg({ ok: true, text: 'Photo récupérée depuis votre CV !' }) }
      else setCvPhotoMsg({ ok: false, text: r.error ?? 'Échec de la récupération' })
      setFetchingCvPhoto(false)
    })
  }

  function save() {
    setSaved(false)
    setWaError(null)
    startTransition(async () => {
      const res = await updateCandidateProfile({
        phone, whatsapp, city,
        mobilityRadiusKm: mobility ? parseInt(mobility, 10) : null,
        skills, experienceSummary: summary, openToWork, desiredSector, desiredRoles, photoUrl, linkedinUrl,
      })
      if (res.error) { setWaError(res.error); return }
      setSaved(true)
      setTimeout(() => { setOpen(false); setSaved(false) }, 900)
    })
  }

  return (
    <>
      {/* Trigger */}
      <button
        onClick={() => setOpen(true)}
        onMouseEnter={() => {
          if (triggerRef.current) {
            triggerRef.current.style.background = 'rgba(184,134,11,0.06)'
            triggerRef.current.style.borderColor = 'rgba(184,134,11,0.35)'
            triggerRef.current.style.boxShadow = '0 16px 32px rgba(11,29,81,0.14), 0 0 0 1px rgba(184,134,11,0.1)'
            triggerRef.current.style.transform = 'translateY(-3px) scale(1.01)'
          }
          if (iconChipRef.current) iconChipRef.current.style.background = 'rgba(184,134,11,0.22)'
          if (iconRef.current) iconRef.current.style.transform = 'rotate(-10deg) scale(1.12)'
          if (titleRef.current) titleRef.current.style.color = 'var(--color-primary)'
        }}
        onMouseLeave={() => {
          if (triggerRef.current) {
            triggerRef.current.style.background = 'var(--color-surface)'
            triggerRef.current.style.borderColor = 'var(--color-border)'
            triggerRef.current.style.boxShadow = '0 8px 24px rgba(11,29,81,0.06)'
            triggerRef.current.style.transform = 'translateY(0) scale(1)'
          }
          if (iconChipRef.current) iconChipRef.current.style.background = 'rgba(184,134,11,0.12)'
          if (iconRef.current) iconRef.current.style.transform = 'rotate(0deg) scale(1)'
          if (titleRef.current) titleRef.current.style.color = 'var(--color-text)'
        }}
        ref={triggerRef}
        className="w-full flex items-center justify-between px-5 py-4 rounded-2xl"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 8px 24px rgba(11,29,81,0.06)',
          transform: 'translateY(0) scale(1)',
          transition: 'background 0.25s ease-out, border-color 0.25s ease-out, box-shadow 0.25s ease-out, transform 0.2s ease-out',
        }}>
        <div className="flex items-center gap-3">
          <div ref={iconChipRef} className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(184,134,11,0.12)', transition: 'background 0.25s ease-out' }}>
            <Pencil ref={iconRef} className="h-4 w-4" style={{ color: 'var(--color-primary)', transition: 'transform 0.25s ease-out' }} />
          </div>
          <div className="text-left">
            <p ref={titleRef} className="text-sm font-bold" style={{ color: 'var(--color-text)', transition: 'color 0.25s ease-out' }}>Modifier mon profil</p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Photo, compétences, mobilité…</p>
          </div>
        </div>
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center sm:p-4 overflow-y-auto"
          style={{ background: 'rgba(6,10,30,0.55)', backdropFilter: 'blur(6px)' }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="w-full sm:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[88vh] flex flex-col rounded-none sm:rounded-[28px] overflow-hidden"
            style={{ background: 'var(--color-surface)', boxShadow: '0 30px 80px -20px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)' }}>

            {/* Header */}
            <div className="px-5 sm:px-7 py-5 sm:py-6 shrink-0 relative flex items-center justify-between"
              style={{ background: 'var(--hero-bg)', paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" style={{ color: 'var(--color-accent, #B8860B)' }} />
                <p className="font-bold text-lg" style={{ color: 'white' }}>Mon profil</p>
              </div>
              <button onClick={() => setOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}>
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 sm:px-7 py-5 sm:py-6 space-y-6 overflow-y-auto overscroll-contain flex-1 min-h-0">
              {!summary && !editingSummary && (
                <button type="button" onClick={() => setEditingSummary(true)}
                  className="text-xs font-semibold -mt-1 inline-flex items-center gap-1.5 transition-opacity hover:opacity-70"
                  style={{ color: 'var(--color-primary)' }}>
                  <Pencil className="h-3 w-3" /> Ajouter une biographie
                </button>
              )}
              {(summary || editingSummary) && (
                <div className="-mt-1">
                  {editingSummary ? (
                    <textarea
                      autoFocus
                      value={summary}
                      onChange={e => setSummary(e.target.value)}
                      onBlur={() => setEditingSummary(false)}
                      rows={3}
                      className="w-full px-3 py-2 rounded-xl text-xs leading-relaxed outline-none resize-none"
                      style={inpStyle}
                      placeholder="Résumé de votre profil…"
                    />
                  ) : (
                    <p className="text-xs leading-relaxed flex items-start gap-2" style={{ color: 'var(--color-text-muted)' }}>
                      <span className="flex-1">{summary}</span>
                      <button type="button" onClick={() => setEditingSummary(true)}
                        className="shrink-0 p-1 rounded-lg transition-colors hover:opacity-70"
                        style={{ color: 'var(--color-primary)' }} title="Modifier">
                        <Pencil className="h-3 w-3" />
                      </button>
                    </p>
                  )}
                </div>
              )}

              {/* Photo + availability row */}
              <div className="flex items-center gap-5 flex-wrap">
                <div className="flex items-center gap-4">
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="relative rounded-full overflow-hidden shrink-0 flex items-center justify-center"
                    style={{ width: 72, height: 72, background: 'rgba(11,29,81,0.06)', boxShadow: '0 0 0 4px rgba(184,134,11,0.14), 0 10px 24px rgba(11,29,81,0.14)' }}>
                    {photoUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={photoUrl} alt="" className="w-full h-full object-cover" />
                      : <Camera className="h-5 w-5" style={{ color: 'var(--color-text-muted)' }} />}
                    {(uploading || fetchingPhoto) && (
                      <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
                        <Loader2 className="h-4 w-4 text-white animate-spin" />
                      </div>
                    )}
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = '' }} />
                  <div>
                    <p className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>Photo de profil</p>
                    <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Cliquez pour uploader</p>
                  </div>
                </div>

                <button type="button" onClick={() => setOpenToWork(v => !v)}
                  className="flex-1 min-w-[220px] flex items-center justify-between px-4 py-3 rounded-xl transition-all"
                  style={{
                    background: openToWork ? 'rgba(16,185,129,0.08)' : 'rgba(11,29,81,0.03)',
                    border: `1px solid ${openToWork ? 'rgba(16,185,129,0.25)' : 'var(--color-border)'}`,
                  }}>
                  <span className="text-xs font-bold" style={{ color: openToWork ? '#10b981' : 'var(--color-text-muted)' }}>
                    {openToWork ? '● En recherche de mission' : '○ Plus en recherche'}
                  </span>
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full"
                    style={{ background: openToWork ? 'rgba(16,185,129,0.15)' : 'rgba(107,114,128,0.15)', color: openToWork ? '#10b981' : '#6b7280' }}>
                    {openToWork ? 'Activé' : 'Désactivé'}
                  </span>
                </button>
              </div>

              {/* Coordonnées */}
              <div>
                <SectionLabel icon={PhoneIcon}>Coordonnées</SectionLabel>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Téléphone" className={inp} style={inpStyle} />
                  <div>
                    <div className="relative">
                      <svg viewBox="0 0 24 24" fill="#25D366" className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" aria-hidden><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
                      <input value={whatsapp} onChange={e => { setWhatsapp(e.target.value); setWaError(null) }} placeholder="Numéro WhatsApp (ex. +33 6 12 34 56 78)" inputMode="tel"
                        className={inp} style={{ ...inpStyle, paddingLeft: '32px' }} />
                    </div>
                    <p className="text-[11px] mt-1.5 leading-snug" style={{ color: waError ? '#dc2626' : 'var(--color-text-muted)' }}>{waError ?? 'Facultatif — en le renseignant, vous autorisez les recruteurs à vous contacter directement sur WhatsApp. Laissez vide pour ne pas être contacté.'}</p>
                  </div>
                  <div className="relative">
                    <Linkedin className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: 'var(--color-text-muted)' }} />
                    <input value={linkedinUrl} onChange={e => { setLinkedinUrl(e.target.value); setLinkedinMsg(null) }} placeholder="URL LinkedIn"
                      className={inp} style={{ ...inpStyle, paddingLeft: '32px' }} />
                  </div>
                </div>
                {linkedinUrl && (
                  <div className="mt-2">
                    <button type="button" onClick={fetchPhotoFromLinkedin} disabled={fetchingPhoto}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-opacity hover:opacity-80 disabled:opacity-50"
                      style={{ background: 'rgba(184,134,11,0.12)', color: 'var(--color-primary)' }}>
                      {fetchingPhoto ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                      Récupérer ma photo depuis LinkedIn
                    </button>
                    {linkedinMsg && (
                      <p className="text-[11px] mt-1.5 flex items-center gap-1" style={{ color: linkedinMsg.ok ? '#10b981' : '#ef4444' }}>
                        {!linkedinMsg.ok && <AlertCircle className="h-3 w-3" />}
                        {linkedinMsg.text}
                      </p>
                    )}
                  </div>
                )}
                <div className="mt-2">
                  <button type="button" onClick={fetchPhotoFromCv} disabled={fetchingCvPhoto}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-opacity hover:opacity-80 disabled:opacity-50"
                    style={{ background: 'rgba(184,134,11,0.12)', color: 'var(--color-primary)' }}>
                    {fetchingCvPhoto ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                    Récupérer ma photo depuis mon CV
                  </button>
                  {cvPhotoMsg && (
                    <p className="text-[11px] mt-1.5 flex items-center gap-1" style={{ color: cvPhotoMsg.ok ? '#10b981' : '#ef4444' }}>
                      {!cvPhotoMsg.ok && <AlertCircle className="h-3 w-3" />}
                      {cvPhotoMsg.text}
                    </p>
                  )}
                </div>
              </div>

              {/* Localisation */}
              <div>
                <SectionLabel icon={MapPin}>Localisation & mobilité</SectionLabel>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input value={city} onChange={e => setCity(e.target.value)} placeholder="Ville" className={inp} style={inpStyle} />
                  <div className="relative">
                    <Navigation className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: 'var(--color-text-muted)' }} />
                    <input value={mobility} onChange={e => setMobility(e.target.value.replace(/[^0-9]/g, ''))}
                      placeholder="Mobilité" className={inp} style={{ ...inpStyle, paddingLeft: '32px', paddingRight: '44px' }} />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--color-text-muted)' }}>km</span>
                  </div>
                </div>
              </div>

              {/* Secteur */}
              <div>
                <SectionLabel icon={Building2}>Secteur recherché</SectionLabel>
                <SectorPicker value={desiredSector} onChange={setDesiredSector} />
              </div>

              {/* Missions */}
              <div>
                <SectionLabel icon={Briefcase}>Missions recherchées</SectionLabel>
                <TagInput tags={desiredRoles} onChange={setDesiredRoles} placeholder="ex : Chef de projet data…" suggestions={SUGGESTED_MISSION_TYPES} />
              </div>

              {/* Compétences */}
              <div>
                <SectionLabel icon={Sparkles}>Compétences</SectionLabel>
                <TagInput tags={skills} onChange={setSkills} placeholder="ex : Python, SQL, Gestion de projet…" />
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
                  Pré-remplies automatiquement depuis votre CV — modifiez librement.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 sm:px-7 py-4 sm:py-5 shrink-0"
              style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
              <button onClick={save} disabled={isPending}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold transition-all hover:opacity-90"
                style={{
                  background: saved ? 'rgba(16,185,129,0.15)' : 'var(--color-primary)',
                  color: saved ? '#10b981' : 'white',
                  boxShadow: saved ? 'none' : '0 10px 24px rgba(11,29,81,0.25)',
                }}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
                {isPending ? 'Enregistrement…' : saved ? 'Profil enregistré !' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
