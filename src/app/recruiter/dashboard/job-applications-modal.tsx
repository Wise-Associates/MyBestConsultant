'use client'

import { X, MapPin, Calendar, Users, Clock, MessageSquare, CheckCircle2 } from 'lucide-react'
import { CandidateCard, type CandidateApp } from './applications-panel'

const CONTRACT_LABELS: Record<string, string> = {
  cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission',
}

interface JobInfo {
  title: string
  location: string
  contractType?: string
  createdAt: string
}

export function JobApplicationsModal({
  job, apps, onClose,
}: { job: JobInfo; apps: CandidateApp[]; onClose: () => void }) {
  const close = onClose

  const toTreat = apps.filter(a => a.status === 'pending' || a.status === 'screening').length
  const inInterview = apps.filter(a => a.status === 'interview').length
  const accepted = apps.filter(a => a.status === 'accepted').length
  const scored = apps.filter(a => a.aiScore !== undefined)
  const avgScore = scored.length > 0 ? Math.round(scored.reduce((s, a) => s + (a.aiScore ?? 0), 0) / scored.length) : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(6,10,30,0.65)', backdropFilter: 'blur(8px)' }}
      onClick={e => { if (e.target === e.currentTarget) close() }}
    >
      <div style={{
        width: '100%', maxWidth: 900, maxHeight: '90vh',
        borderRadius: 28, overflow: 'hidden',
        background: 'var(--color-background)',
        boxShadow: '0 40px 100px -20px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ background: 'var(--hero-bg)', padding: '1.75rem 2rem', flexShrink: 0 }}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Candidatures
              </p>
              <h2 style={{ color: 'white', fontWeight: 300, fontSize: '1.6rem' }}>{job.title}</h2>
              <div className="flex items-center gap-4 mt-2 flex-wrap">
                <span className="text-sm flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  <MapPin className="h-3.5 w-3.5" />{job.location}
                </span>
                {job.contractType && (
                  <span className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    {CONTRACT_LABELS[job.contractType] ?? job.contractType}
                  </span>
                )}
                <span className="text-sm flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  <Calendar className="h-3.5 w-3.5" />
                  Publiée le {new Date(job.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              </div>
            </div>
            <button onClick={close}
              className="p-2.5 rounded-xl shrink-0 transition-all"
              style={{ background: 'rgba(124,58,237,0.18)', border: '1px solid rgba(124,58,237,0.4)', color: '#c4b5fd' }}>
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Funnel stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
            {[
              { label: 'Candidatures', value: apps.length, icon: Users, color: '#c4b5fd' },
              { label: 'À traiter', value: toTreat, icon: Clock, color: '#fbbf24' },
              { label: 'En entretien', value: inInterview, icon: MessageSquare, color: '#60a5fa' },
              { label: 'Retenus', value: accepted, icon: CheckCircle2, color: '#34d399' },
            ].map(s => (
              <div key={s.label} className="p-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>{s.label}</span>
                  <s.icon className="h-3.5 w-3.5" style={{ color: s.color }} />
                </div>
                <p className="text-xl font-bold" style={{ color: 'white' }}>{s.value}</p>
              </div>
            ))}
          </div>
          {avgScore !== null && (
            <p className="text-xs mt-3" style={{ color: '#c4b5fd' }}>Score IA moyen : <span className="font-bold">{avgScore}/100</span></p>
          )}
        </div>

        {/* Body — scrollable candidate list */}
        <div className="flex-1 overflow-y-auto" style={{ background: 'var(--color-background)' }}>
          {apps.length === 0 ? (
            <div className="py-20 text-center px-6">
              <Users className="h-10 w-10 mx-auto mb-3" style={{ color: 'var(--color-text-muted)', opacity: 0.3 }} />
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Aucune candidature pour cette offre.</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto p-6">
              <div className="rounded-3xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 10px 30px -10px rgba(11,29,81,0.14)' }}>
                {apps.map(app => <CandidateCard key={app.appId} app={app} />)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
