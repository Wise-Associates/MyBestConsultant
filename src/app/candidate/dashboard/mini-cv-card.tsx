'use client'

import { useRef } from 'react'
import { MapPin, Navigation, Building2, Mail, Phone, Network as Linkedin } from 'lucide-react'
import { CandidateAvatar } from '@/components/shared/candidate-avatar'
import { CvDetailExpander } from '@/components/shared/cv-detail-expander'
import type { CvExperience, CvEducation, CvLanguage } from '@/lib/cv-profile-extract'

interface Props {
  firstName: string
  lastName: string
  email: string
  phone?: string
  city?: string
  mobilityRadiusKm?: number
  photoUrl?: string
  linkedinUrl?: string
  openToWork?: boolean
  desiredSector: string[]
  desiredRoles: string[]
  skills: string[]
  experienceSummary?: string
  experiences?: CvExperience[]
  education?: CvEducation[]
  languages?: CvLanguage[]
}

const REST_SHADOW = '0 20px 50px -12px rgba(11,29,81,0.18)'
const HOVER_SHADOW = '0 32px 64px -12px rgba(11,29,81,0.32), 0 0 0 1px rgba(184,134,11,0.12)'
const REST_TRANSFORM = 'perspective(1200px) rotateX(0deg) rotateY(0deg) scale(1)'

export function MiniCvCard({
  firstName, lastName, email, phone, city, mobilityRadiusKm, photoUrl, linkedinUrl,
  openToWork, desiredSector, desiredRoles, skills, experienceSummary,
  experiences = [], education = [], languages = [],
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)

  // Direct DOM writes (no setState) — a tilt effect driven by React state re-renders
  // the whole card on every pixel of mouse movement, which is what caused scroll jank
  // last time. Writing style.transform straight to the ref bypasses React entirely,
  // so this is as cheap as a CSS :hover and never touches the render tree.
  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const card = cardRef.current
    if (!card) return
    const rect = card.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    const rotateX = (0.5 - py) * 8
    const rotateY = (px - 0.5) * 8
    card.style.transform = `perspective(1200px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.012)`
    card.style.boxShadow = HOVER_SHADOW
    if (glowRef.current) {
      glowRef.current.style.opacity = '1'
      glowRef.current.style.background = `radial-gradient(600px circle at ${px * 100}% ${py * 100}%, rgba(255,255,255,0.14), transparent 45%)`
    }
  }

  function onMouseLeave() {
    const card = cardRef.current
    if (card) { card.style.transform = REST_TRANSFORM; card.style.boxShadow = REST_SHADOW }
    if (glowRef.current) glowRef.current.style.opacity = '0'
  }

  return (
    <div
      ref={cardRef}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className="rounded-3xl overflow-hidden relative"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: REST_SHADOW,
        transform: REST_TRANSFORM,
        transition: 'transform 0.12s ease-out, box-shadow 0.3s ease-out',
        willChange: 'auto',
      }}>
      {/* Cursor-following light sheen */}
      <div ref={glowRef} className="absolute inset-0 pointer-events-none"
        style={{ opacity: 0, transition: 'opacity 0.3s ease-out' }} />

      {/* Header band */}
      <div className="px-7 pt-7 pb-6 relative" style={{ background: 'var(--hero-bg)' }}>
        {openToWork !== undefined && (
          <span className="absolute top-5 right-5 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-extrabold tracking-wide"
            style={openToWork
              ? { background: 'linear-gradient(135deg, #10b981, #059669)', color: 'white', boxShadow: '0 6px 16px -4px rgba(16,185,129,0.6)' }
              : { background: 'rgba(107,114,128,0.18)', color: '#9ca3af', boxShadow: '0 0 0 1px rgba(156,163,175,0.2)' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: openToWork ? 'white' : '#9ca3af' }} />
            {openToWork ? 'En recherche de mission' : 'Non disponible'}
          </span>
        )}
        <div className="flex items-center gap-4">
          <CandidateAvatar photoUrl={photoUrl} initials={`${firstName[0]}${lastName[0]}`} openToWork={openToWork} bgColor="var(--hero-bg)" />
          <div className="min-w-0">
            <p className="font-bold text-xl truncate" style={{ color: 'white' }}>{firstName} {lastName}</p>
            {desiredRoles.length > 0 && (
              <p className="text-sm font-medium truncate mt-0.5" style={{ color: 'rgba(255,255,255,0.7)' }}>{desiredRoles[0]}</p>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-7 py-6 space-y-4">
        {experienceSummary && (
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{experienceSummary}</p>
        )}

        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{email}</span>
          {phone && <span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{phone}</span>}
          {city && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />{city}{mobilityRadiusKm ? ` (± ${mobilityRadiusKm} km)` : ''}
            </span>
          )}
          {linkedinUrl && (
            <a href={linkedinUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-semibold transition-opacity hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
              <Linkedin className="h-3.5 w-3.5" />LinkedIn
            </a>
          )}
        </div>

        {desiredSector.length > 0 && (
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            <Building2 className="h-3.5 w-3.5" />
            Secteur souhaité : <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{desiredSector.join(', ')}</span>
          </div>
        )}

        {desiredRoles.length > 1 && (
          <div className="flex items-center gap-2 text-xs flex-wrap" style={{ color: 'var(--color-text-muted)' }}>
            <Navigation className="h-3.5 w-3.5 shrink-0" />
            Missions : {desiredRoles.join(' · ')}
          </div>
        )}

        {skills.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {skills.map(s => (
              <span key={s} className="px-3 py-1.5 rounded-full text-xs font-bold"
                style={{ background: 'rgba(184,134,11,0.12)', color: 'var(--color-primary)', boxShadow: '0 1px 2px rgba(184,134,11,0.08)' }}>
                {s}
              </span>
            ))}
          </div>
        )}

        {(experiences.length > 0 || education.length > 0 || languages.length > 0) && (
          <div className="pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
            <CvDetailExpander experiences={experiences} education={education} languages={languages} />
          </div>
        )}
      </div>
    </div>
  )
}
