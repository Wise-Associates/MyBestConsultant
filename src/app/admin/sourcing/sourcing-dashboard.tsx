'use client'

import { useState, useEffect, useTransition } from 'react'
import {
  Radar, Sparkles, Loader2, AlertCircle, Mail, Check, X, Send, User,
} from 'lucide-react'
import {
  findMatchingCandidates, generateOutreachMessage, sendOutreachMessage,
  type SourcingJob,
} from './actions'
import type { CandidateMatch } from '@/lib/sourcing-core'

function scoreColor(score: number): string {
  if (score >= 75) return '#34d399'
  if (score >= 55) return '#f59e0b'
  return '#8a90a8'
}

// ── Outreach modal ──────────────────────────────────────────────────
function OutreachModal({ candidate, jobId, onClose, onSent }: {
  candidate: CandidateMatch
  jobId: string
  onClose: () => void
  onSent: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    generateOutreachMessage(candidate.candidateId, jobId).then(res => {
      if (res.error) setError(res.error)
      setSubject(res.subject)
      setMessage(res.message)
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function send() {
    setError('')
    startTransition(async () => {
      const res = await sendOutreachMessage(candidate.candidateId, subject, message)
      if (res.error) { setError(res.error); return }
      setSent(true)
      onSent()
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(1,4,18,0.88)', backdropFilter: 'blur(8px)' }}>
      <div style={{ width: '90vw', maxWidth: 520, borderRadius: 20, overflow: 'hidden', background: '#0c0e14', border: '1px solid rgba(255,255,255,0.09)', boxShadow: '0 40px 120px rgba(0,0,0,0.8)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg,rgba(11,29,81,0.9),rgba(22,36,102,0.9))', border: '1px solid rgba(184,134,11,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Mail size={15} color="#B8860B" />
          </div>
          <div>
            <p style={{ fontWeight: 700, fontSize: 14, color: '#fff', margin: 0 }}>Message de prise de contact</p>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', margin: 0 }}>{candidate.name} · {candidate.email}</p>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', display: 'flex' }}>
            <X size={16} />
          </button>
        </div>

        {sent ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Check size={40} color="#34d399" style={{ margin: '0 auto 16px' }} />
            <p style={{ color: '#fff', fontWeight: 700, marginBottom: 4 }}>Message envoyé</p>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Envoyé à {candidate.email}.</p>
          </div>
        ) : loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Loader2 size={28} className="animate-spin" color="#B8860B" style={{ margin: '0 auto 16px' }} />
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Rédaction du message par l&apos;IA…</p>
          </div>
        ) : (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>Objet</p>
              <input value={subject} onChange={e => setSubject(e.target.value)}
                style={{ width: '100%', height: 36, borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)', fontSize: 13, padding: '0 10px', outline: 'none' }} />
            </div>
            <div>
              <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>Message</p>
              <textarea value={message} onChange={e => setMessage(e.target.value)} rows={9}
                style={{ width: '100%', borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)', fontSize: 13, padding: 10, outline: 'none', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }} />
            </div>

            {error && (
              <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <AlertCircle size={15} color="#f87171" />
                <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{error}</p>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button onClick={onClose} style={{ padding: '10px 16px', borderRadius: 10, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 13, cursor: 'pointer' }}>
                Annuler
              </button>
              <button onClick={send} disabled={isPending}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 10, background: 'linear-gradient(135deg, #0B1D51, #162466)', border: '1px solid rgba(184,134,11,0.35)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: isPending ? 'default' : 'pointer', opacity: isPending ? 0.6 : 1 }}>
                {isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Envoyer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main dashboard ─────────────────────────────────────────────────
export function SourcingDashboard({ jobs }: { jobs: SourcingJob[] }) {
  const [jobId, setJobId] = useState('')
  const [matches, setMatches] = useState<CandidateMatch[] | null>(null)
  const [scanned, setScanned] = useState(0)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [contacting, setContacting] = useState<CandidateMatch | null>(null)
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())

  function analyze() {
    if (!jobId) return
    setError('')
    setMatches(null)
    startTransition(async () => {
      const res = await findMatchingCandidates(jobId)
      if (res.error) { setError(res.error); return }
      setMatches(res.matches)
      setScanned(res.scanned)
    })
  }

  const selectedJob = jobs.find(j => j.$id === jobId)

  return (
    <div className="min-h-full p-8 space-y-6" style={{ color: 'rgba(255,255,255,0.87)' }}>

      <div>
        <p className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: 'rgba(255,255,255,0.3)' }}>RECRUTEMENT</p>
        <h1 className="text-[28px] font-bold tracking-tight text-white">Sourcing IA</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Identifie les meilleurs candidats déjà inscrits pour une offre, et prépare un premier message.
        </p>
      </div>

      {/* Job picker */}
      <div className="rounded-2xl p-5 flex items-center gap-3 flex-wrap" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <Radar className="h-4 w-4 shrink-0" style={{ color: '#B8860B' }} />
        <select value={jobId} onChange={e => setJobId(e.target.value)}
          className="flex-1 min-w-[240px]"
          style={{ height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)', padding: '0 12px', fontSize: 13, cursor: 'pointer' }}>
          <option value="" style={{ background: '#0a0c10' }}>Choisir une offre…</option>
          {jobs.map(j => (
            <option key={j.$id} value={j.$id} style={{ background: '#0a0c10' }}>{j.title} — {j.location}</option>
          ))}
        </select>
        <button onClick={analyze} disabled={!jobId || isPending}
          className="flex items-center gap-2 font-semibold text-sm"
          style={{ padding: '10px 18px', borderRadius: 10, background: 'linear-gradient(135deg, rgba(11,29,81,0.9), rgba(22,36,102,0.9))', border: '1px solid rgba(184,134,11,0.35)', color: '#fff', cursor: !jobId || isPending ? 'default' : 'pointer', opacity: !jobId || isPending ? 0.5 : 1 }}>
          {isPending ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {isPending ? 'Analyse en cours…' : 'Analyser les candidats'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertCircle className="h-4 w-4 shrink-0" style={{ color: '#f87171' }} />
          <p className="text-sm" style={{ color: '#f87171' }}>{error}</p>
        </div>
      )}

      {matches && (
        <div className="space-y-3">
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {scanned} candidat{scanned > 1 ? 's' : ''} analysé{scanned > 1 ? 's' : ''} pour <strong style={{ color: 'rgba(255,255,255,0.6)' }}>{selectedJob?.title}</strong>
          </p>

          {matches.length === 0 ? (
            <div className="text-center py-16 rounded-2xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <User className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p style={{ color: 'rgba(255,255,255,0.3)' }}>Aucun candidat trouvé</p>
            </div>
          ) : (
            matches.map(m => {
              const color = scoreColor(m.score)
              const isSent = sentIds.has(m.candidateId)
              return (
                <div key={m.candidateId} className="rounded-xl p-4 flex items-start gap-4"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 font-bold text-sm"
                    style={{ background: `${color}18`, color }}>
                    {m.score}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-white">{m.name || 'Candidat'}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{m.email}</p>
                    <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.6)' }}>{m.reason}</p>
                  </div>
                  <button onClick={() => setContacting(m)} disabled={isSent}
                    className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-semibold shrink-0"
                    style={{
                      background: isSent ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.06)',
                      color: isSent ? '#34d399' : 'rgba(255,255,255,0.7)',
                      cursor: isSent ? 'default' : 'pointer',
                    }}>
                    {isSent ? <Check size={13} /> : <Mail size={13} />}
                    {isSent ? 'Contacté' : 'Contacter'}
                  </button>
                </div>
              )
            })
          )}
        </div>
      )}

      {contacting && (
        <OutreachModal
          candidate={contacting}
          jobId={jobId}
          onClose={() => setContacting(null)}
          onSent={() => {
            setSentIds(prev => new Set(prev).add(contacting.candidateId))
            setTimeout(() => setContacting(null), 1200)
          }}
        />
      )}
    </div>
  )
}
