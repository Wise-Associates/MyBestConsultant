'use client'

import { WhatsAppContact } from '@/components/recruiter/whatsapp-contact'
import { useEffect, useRef, useState, useTransition } from 'react'
import {
  X, Mail, Phone, MapPin, Building2, ExternalLink, Send, Loader2, CheckCircle2,
  Briefcase, GraduationCap, Languages as LanguagesIcon, Star, Quote,
} from 'lucide-react'
import type { CvThequeCandidate } from './actions'
import { sendCvthequeCandidateMessage, getCandidateRecommendationsAction } from './actions'
import { CandidateAvatar } from '@/components/shared/candidate-avatar'
import { RELATIONSHIP_LABEL } from '@/lib/recommendation-boost'
import type { Recommendation } from '@/types'

// Vue complète d'un profil CVthèque — synthèse ET détail exhaustif (expériences
// chronologiques, formation, langues) dans une seule fenêtre scrollable, plutôt que de
// naviguer ailleurs. Complète l'affichage synthétique déjà présent sur la carte candidat.
export function CandidateProfileModal({ candidate: c, onClose, vivier = false, matchScore = null }: { candidate: CvThequeCandidate; onClose: () => void; vivier?: boolean; matchScore?: number | null }) {
  const [showContactForm, setShowContactForm] = useState(false)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [isPending, startTransition] = useTransition()
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const contactFormRef = useRef<HTMLDivElement>(null)
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (vivier) return // un CV du vivier n'a pas de compte candidat, donc pas de recommandations
    getCandidateRecommendationsAction(c.$id).then(setRecommendations).catch(() => {})
  }, [c.$id, vivier])

  // Le bouton "Contacter" ouvre le formulaire tout en bas de la fenêtre scrollable —
  // sans ça, il reste invisible tant qu'on n'a pas pensé à scroller soi-même.
  useEffect(() => {
    if (showContactForm) contactFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [showContactForm])

  function send() {
    setError('')
    startTransition(async () => {
      const res = await sendCvthequeCandidateMessage({ candidateEmail: c.email, subject, message })
      if (res.error) setError(res.error)
      else setSent(true)
    })
  }

  const hasDetail = c.experiences.length > 0 || c.education.length > 0 || c.languages.length > 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 mbc-modal-backdrop"
      style={{ background: 'rgba(6,10,30,0.65)', backdropFilter: 'blur(8px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="mbc-modal-panel" style={{
        width: '100%', maxWidth: 640, maxHeight: '88vh',
        borderRadius: 28, overflow: 'hidden',
        background: 'var(--color-background)',
        boxShadow: '0 50px 120px -24px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Accent bar */}
        <div style={{ height: 4, background: 'linear-gradient(90deg, #E8A33D, #7c3aed)', flexShrink: 0 }} />

        {/* Header */}
        <div style={{ background: 'var(--hero-bg)', padding: '1.75rem 2rem', flexShrink: 0 }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <CandidateAvatar photoUrl={c.photoUrl} initials={(c.name || c.email)[0]?.toUpperCase() ?? '?'} size={56} openToWork={c.openToWork} bgColor="var(--hero-bg)" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 style={{ color: 'white', fontWeight: 300, fontSize: '1.4rem' }}>{c.name || '—'}</h2>
                  {!vivier && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0"
                    style={{ background: c.openToWork ? 'rgba(16,185,129,0.18)' : 'rgba(107,114,128,0.18)', color: c.openToWork ? '#34d399' : '#9ca3af' }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.openToWork ? '#34d399' : '#9ca3af' }} />
                    {c.openToWork ? 'En recherche' : 'Non disponible'}
                  </span>
                  )}
                </div>
                {c.desiredRoles.length > 0 && (
                  <p className="text-sm font-semibold mt-0.5" style={{ color: '#fdba74' }}>{c.desiredRoles.join(' · ')}</p>
                )}
              </div>
            </div>
            <button onClick={onClose}
              className="p-2.5 rounded-xl shrink-0 transition-all hover:opacity-80"
              style={{ background: 'rgba(124,58,237,0.18)', border: '1px solid rgba(124,58,237,0.4)', color: '#c4b5fd' }}>
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex items-center gap-4 flex-wrap text-xs mt-4" style={{ color: 'rgba(255,255,255,0.55)' }}>
            {c.email && <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{c.email}</span>}
            {c.phone && <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{c.phone}</span>}
            {c.city && <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{c.city}{c.mobilityRadiusKm != null ? ` (± ${c.mobilityRadiusKm} km)` : ''}</span>}
            {c.desiredSector.length > 0 && <span className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />{c.desiredSector.join(', ')}</span>}
            {matchScore != null && (
              <span className="flex items-center gap-1.5 font-bold" style={{ color: '#c4b5fd' }}>Matching IA : {matchScore}/100</span>
            )}
            {c.yearsOfExperience != null && (
              <span className="flex items-center gap-1.5 font-semibold" style={{ color: '#fbd090' }}>
                {c.yearsOfExperience} an{c.yearsOfExperience > 1 ? 's' : ''} d&apos;expérience
              </span>
            )}
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-7 py-6 space-y-6">
          {c.skills.length > 0 && (
            <div>
              <SectionLabel label="Compétences" />
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {c.skills.map(s => (
                  <span key={s} className="px-2.5 py-1 rounded-full text-[11px] font-semibold"
                    style={{ background: 'rgba(232,163,61,0.1)', color: 'var(--color-primary)' }}>
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {c.experienceSummary && (
            <div>
              <SectionLabel label="Synthèse" />
              <p className="mt-2.5 text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{c.experienceSummary}</p>
            </div>
          )}

          {c.experiences.length > 0 && (
            <div>
              <SectionLabel icon={Briefcase} label="Expériences professionnelles" />
              <div className="mt-2.5 space-y-4 pl-4" style={{ borderLeft: '2px solid var(--color-border)' }}>
                {c.experiences.map((exp, i) => (
                  <div key={i} className="relative">
                    <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-primary)' }} />
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                      <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{exp.title}</p>
                      {exp.period && <span className="text-xs font-medium shrink-0" style={{ color: 'var(--color-text-muted)' }}>{exp.period}</span>}
                    </div>
                    {exp.company && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{exp.company}</p>}
                    {exp.missions.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {exp.missions.map((m, j) => (
                          <li key={j} className="text-xs leading-relaxed flex items-start gap-1.5" style={{ color: 'var(--color-text)' }}>
                            <span style={{ color: 'var(--color-primary)' }}>·</span>{m}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {c.education.length > 0 && (
            <div>
              <SectionLabel icon={GraduationCap} label="Formation" />
              <div className="mt-2.5 space-y-2">
                {c.education.map((ed, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-2 flex-wrap text-sm">
                    <span style={{ color: 'var(--color-text)' }}>
                      <strong>{ed.degree}</strong>{ed.school ? ` — ${ed.school}` : ''}
                    </span>
                    {ed.year && <span className="text-xs shrink-0" style={{ color: 'var(--color-text-muted)' }}>{ed.year}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {c.languages.length > 0 && (
            <div>
              <SectionLabel icon={LanguagesIcon} label="Langues" />
              <div className="mt-2.5 flex flex-wrap gap-2">
                {c.languages.map((l, i) => (
                  <span key={i} className="px-3 py-1 rounded-full text-xs font-semibold"
                    style={{ background: 'rgba(11,29,81,0.05)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                    {l.name}{l.level ? ` · ${l.level}` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {recommendations.length > 0 && (
            <div>
              <SectionLabel icon={Star} label="Recommandations" />
              <div className="mt-2.5 space-y-3">
                {recommendations.map(r => (
                  <div key={r.$id} className="relative overflow-hidden p-4 rounded-2xl" style={{
                    background: 'linear-gradient(135deg, rgba(232,163,61,0.12), rgba(232,163,61,0.03))',
                    border: '1px solid rgba(232,163,61,0.35)',
                    boxShadow: '0 10px 28px -8px rgba(232,163,61,0.25)',
                  }}>
                    <Quote className="absolute -top-2 -right-2 h-16 w-16 pointer-events-none" style={{ color: 'rgba(232,163,61,0.14)' }} strokeWidth={1.5} />
                    <div className="relative flex items-center justify-between gap-2 flex-wrap mb-1.5">
                      <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                        {r.recipientName}{r.recipientCompany ? ` — ${r.recipientCompany}` : ''}
                      </span>
                      <span className="flex items-center gap-0.5 shrink-0">
                        {[1, 2, 3, 4, 5].map(n => (
                          <Star key={n} className="h-3.5 w-3.5" color="#E8A33D" fill={(r.rating ?? 0) >= n ? '#E8A33D' : 'none'} />
                        ))}
                      </span>
                    </div>
                    {(r.recipientRole || r.relationship || r.period || r.experience) && (
                      <p className="relative text-[11px] mb-2" style={{ color: '#8a6a1f' }}>
                        {[r.recipientRole, r.relationship ? RELATIONSHIP_LABEL[r.relationship] : '', r.period].filter(Boolean).join(' · ')}
                        {r.experience ? <><br />{r.experience}</> : null}
                      </p>
                    )}
                    {(r.endorsedExpertises ?? []).length > 0 && (
                      <div className="relative flex flex-wrap gap-1 mb-2">
                        {(r.endorsedExpertises ?? []).map(e => <span key={e} className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: 'rgba(232,163,61,0.22)', color: '#8a6a1f' }}>{e}</span>)}
                      </div>
                    )}
                    {r.comment && (
                      <p className="relative text-xs leading-relaxed italic" style={{ color: 'var(--color-text)' }}>&laquo; {r.comment} &raquo;</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!hasDetail && !c.experienceSummary && c.skills.length === 0 && (
            <p className="text-sm text-center py-10" style={{ color: 'var(--color-text-muted)' }}>
              Aucune information extraite du CV pour ce profil.
            </p>
          )}

          {showContactForm && (
            <div ref={contactFormRef} className="rounded-2xl p-5" style={{ background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.18)' }}>
              {sent ? (
                <div className="flex items-center gap-2 py-2" style={{ color: '#10b981' }}>
                  <CheckCircle2 className="h-5 w-5" />
                  <p className="text-sm font-semibold">Message envoyé à {c.name || c.email} !</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1.5 mb-3">
                    <Mail className="h-3.5 w-3.5" style={{ color: '#7c3aed' }} />
                    <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#7c3aed' }}>
                      Contacter {c.name || 'le candidat'}
                    </p>
                  </div>
                  <div className="space-y-3">
                    <input
                      value={subject}
                      onChange={e => setSubject(e.target.value)}
                      placeholder="Objet du message"
                      className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
                      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                    />
                    <textarea
                      value={message}
                      onChange={e => setMessage(e.target.value)}
                      placeholder="Votre message…"
                      rows={6}
                      className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none resize-none"
                      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                    />
                    {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}
                    <div className="flex items-center gap-2">
                      <button onClick={send} disabled={isPending || !subject.trim() || !message.trim()} type="button"
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
                        style={{ background: 'linear-gradient(135deg, #E8A33D, #7c3aed)', color: 'white', boxShadow: '0 8px 20px -6px rgba(124,58,237,0.4)' }}>
                        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                        {isPending ? 'Envoi…' : 'Envoyer'}
                      </button>
                      <button onClick={() => setShowContactForm(false)} type="button"
                        className="px-4 py-2.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-70"
                        style={{ color: 'var(--color-text-muted)' }}>
                        Annuler
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap gap-3 px-7 py-5 shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
          {c.cvFileId && (
            <a href={`${vivier ? '/api/vivier-cv' : '/api/cv'}/${c.cvFileId}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold no-underline transition-opacity hover:opacity-90"
              style={{ background: 'var(--color-primary)', color: 'white', boxShadow: '0 8px 20px rgba(11,29,81,0.25)' }}>
              <ExternalLink className="h-3.5 w-3.5" /> Voir le CV
            </a>
          )}
          {c.email && vivier && (
            <a href={`mailto:${c.email}`}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold no-underline transition-opacity hover:opacity-80"
              style={{ background: 'rgba(59,130,246,0.08)', color: '#2563eb', border: '1px solid rgba(59,130,246,0.15)' }}>
              <Mail className="h-3.5 w-3.5" /> Contacter
            </a>
          )}
          {c.email && !vivier && !sent && (
            <button onClick={() => setShowContactForm(v => !v)} type="button"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
              style={{ background: 'rgba(59,130,246,0.08)', color: '#2563eb', border: '1px solid rgba(59,130,246,0.15)' }}>
              <Mail className="h-3.5 w-3.5" /> {showContactForm ? 'Fermer le message' : 'Contacter'}
            </button>
          )}
          {c.phone && (
            <a href={`tel:${c.phone}`}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold no-underline transition-opacity hover:opacity-80"
              style={{ background: 'rgba(16,185,129,0.08)', color: '#10b981', border: '1px solid rgba(16,185,129,0.15)' }}>
              <Phone className="h-3.5 w-3.5" /> {c.phone}
            </a>
          )}
          {c.whatsapp && <WhatsAppContact name={c.name} number={c.whatsapp} />}
        </div>
      </div>

      <style>{`
        @keyframes mbc-modal-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes mbc-modal-rise { from { opacity: 0; transform: translateY(12px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .mbc-modal-backdrop { animation: mbc-modal-fade 0.2s ease both; }
        .mbc-modal-panel { animation: mbc-modal-rise 0.25s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>
    </div>
  )
}

function SectionLabel({ icon: Icon, label }: { icon?: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {Icon && <Icon className="h-3.5 w-3.5" style={{ color: 'var(--color-text-muted)' }} />}
      <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
    </div>
  )
}
