'use client'

import { useMemo, useState } from 'react'
import { Search, Mic, Bot, User } from 'lucide-react'
import type { RecordingRow } from './actions'
import { AudioPlayer } from '@/components/shared/audio-player'

export function RecordingsClient({ rows }: { rows: RecordingRow[] }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      r.candidateName.toLowerCase().includes(q) || r.jobTitle.toLowerCase().includes(q),
    )
  }, [rows, query])

  return (
    <div style={{ padding: '2rem', maxWidth: 1100 }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#2C2C2E' }}>Enregistrements des entretiens</h1>
        <p style={{ fontSize: 13, color: 'rgba(44,44,46,0.55)', marginTop: '0.35rem' }}>
          {rows.length} enregistrement{rows.length > 1 ? 's' : ''} — un audio continu par entretien vocal, tous
          entretiens confondus. Stockage sécurisé, accès réservé aux administrateurs.
        </p>
      </div>

      <div style={{ position: 'relative', marginBottom: '1.25rem', maxWidth: 360 }}>
        <Search style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: 'rgba(44,44,46,0.35)' }} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Rechercher un candidat ou un poste…"
          style={{
            width: '100%', padding: '0.6rem 0.9rem 0.6rem 2.1rem', borderRadius: 10,
            border: '1px solid rgba(44,44,46,0.15)', fontSize: 13, color: '#2C2C2E', outline: 'none',
          }}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'rgba(44,44,46,0.35)', background: 'white', borderRadius: 16, border: '1px solid rgba(44,44,46,0.1)' }}>
          <Mic style={{ width: 32, height: 32, margin: '0 auto 0.75rem', opacity: 0.4 }} />
          <p style={{ fontSize: 13 }}>Aucun enregistrement pour l&apos;instant.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filtered.map((r, i) => {
            const isInterviewer = r.role === 'interviewer'
            return (
              <div key={`${r.fileId}-${i}`}
                style={{ background: 'white', borderRadius: 16, border: '1px solid rgba(44,44,46,0.1)', boxShadow: '0 1px 4px rgba(44,44,46,0.05)', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                  background: isInterviewer ? 'rgba(96,165,250,0.12)' : 'rgba(232,163,61,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isInterviewer
                    ? <Bot style={{ width: 16, height: 16, color: '#3b82f6' }} />
                    : <User style={{ width: 16, height: 16, color: '#E8A33D' }} />}
                </div>

                <div style={{ minWidth: 0, width: 190, flexShrink: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#2C2C2E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.candidateName}
                  </p>
                  <p style={{ fontSize: 11, color: 'rgba(44,44,46,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.jobTitle} · {new Date(r.createdAt).toLocaleDateString('fr-FR')}
                  </p>
                </div>

                {r.mediaType === 'video' ? (
                  <video controls src={r.url} style={{ height: 90, width: 160, flexShrink: 0, borderRadius: 6, background: '#000' }} />
                ) : (
                  <div style={{ flex: 1, minWidth: 260 }}>
                    <AudioPlayer
                      src={r.url}
                      label={isInterviewer ? 'Alex (recruteur IA)' : r.isFullTrack ? 'Entretien complet' : 'Réponse du candidat'}
                      sublabel={r.questionText || undefined}
                      accentColor={isInterviewer ? '#3b82f6' : '#E8A33D'}
                      downloadName={`${r.candidateName.replace(/\s+/g, '_')}-${r.role}.webm`}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
