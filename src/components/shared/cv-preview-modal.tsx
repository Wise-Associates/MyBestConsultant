'use client'

import { X, ExternalLink, FileText } from 'lucide-react'

export function CvPreviewModal({
  fileId, candidateName, onClose,
}: { fileId: string; candidateName: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(6,10,30,0.6)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: '100%', maxWidth: 860, height: '88vh',
        borderRadius: 24, overflow: 'hidden',
        background: 'var(--color-surface)',
        boxShadow: '0 30px 80px -20px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '1.25rem 1.5rem', background: 'var(--hero-bg)', borderBottom: '1px solid var(--hero-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(124,58,237,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <FileText style={{ width: 18, height: 18, color: '#7c3aed' }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 11, color: 'var(--hero-fg-muted)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>CV</p>
              <p style={{ color: 'var(--hero-fg)', fontWeight: 700, fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{candidateName}</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
            <a href={`/api/cv/${fileId}`} target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.22)', color: '#7c3aed', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
              <ExternalLink style={{ width: 14, height: 14 }} /> Nouvel onglet
            </a>
            <button onClick={onClose}
              style={{ padding: 8, borderRadius: 8, color: 'var(--hero-fg-muted)', background: 'var(--hero-control)', border: 'none', cursor: 'pointer' }}>
              <X style={{ width: 18, height: 18 }} />
            </button>
          </div>
        </div>

        <iframe src={`/api/cv/${fileId}`} title={`CV — ${candidateName}`}
          style={{ flex: 1, width: '100%', border: 'none', background: '#525659' }} />
      </div>
    </div>
  )
}
