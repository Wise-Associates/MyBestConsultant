import React from 'react'

// Parses structured job description text into rich visual segments
type Segment =
  | { type: 'heading'; text: string }
  | { type: 'bullet'; items: string[] }
  | { type: 'paragraph'; text: string }
  | { type: 'spacer' }

function parseSegments(text: string): Segment[] {
  if (!text) return []
  const lines = text.split('\n')
  const segments: Segment[] = []
  let bulletBuffer: string[] = []

  function flushBullets() {
    if (bulletBuffer.length > 0) {
      segments.push({ type: 'bullet', items: [...bulletBuffer] })
      bulletBuffer = []
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    // Explicit section heading (### prefix from our HTML converter)
    if (line.startsWith('### ')) {
      flushBullets()
      const text = line.slice(4).trim()
      if (text) segments.push({ type: 'heading', text })
      continue
    }

    // Bullet point
    if (line.startsWith('• ') || line.startsWith('- ') || line.startsWith('* ')) {
      const text = line.slice(2).trim()
      if (text) bulletBuffer.push(text)
      continue
    }

    // Empty line → spacer or flush bullets
    if (!line.trim()) {
      flushBullets()
      // Only add spacer if last segment wasn't already a spacer
      if (segments.length > 0 && segments[segments.length - 1].type !== 'spacer') {
        segments.push({ type: 'spacer' })
      }
      continue
    }

    // Line that STARTS with an emoji → treat as a visual heading
    const startsWithEmoji = /^\p{Emoji}/u.test(line.trim())
    if (startsWithEmoji && line.trim().length < 120) {
      flushBullets()
      segments.push({ type: 'heading', text: line.trim() })
      continue
    }

    // Regular paragraph line
    flushBullets()
    // Merge into previous paragraph if last segment is a paragraph
    const last = segments[segments.length - 1]
    if (last?.type === 'paragraph') {
      last.text += ' ' + line.trim()
    } else {
      segments.push({ type: 'paragraph', text: line.trim() })
    }
  }

  flushBullets()
  // Remove trailing spacer
  if (segments[segments.length - 1]?.type === 'spacer') segments.pop()
  return segments
}

// ── Public (light theme) renderer ────────────────────────────────────────────

export function JobDescription({ description }: { description: string }) {
  const segments = parseSegments(description)

  if (segments.length === 0) {
    return (
      <p style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: '0.9rem' }}>
        Description non disponible.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      {segments.map((seg, i) => {
        if (seg.type === 'spacer') {
          return <div key={i} style={{ height: '0.75rem' }} />
        }
        if (seg.type === 'heading') {
          return (
            <div key={i} style={{ marginTop: i === 0 ? 0 : '1.25rem', marginBottom: '0.5rem' }}>
              <p style={{
                fontSize: '0.875rem',
                fontWeight: 700,
                color: 'var(--color-text)',
                letterSpacing: '0.01em',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}>
                <span style={{ display: 'inline-block', width: 3, height: 16, borderRadius: 2, background: 'var(--color-primary)', flexShrink: 0 }} />
                {seg.text}
              </p>
            </div>
          )
        }
        if (seg.type === 'bullet') {
          return (
            <ul key={i} style={{ listStyle: 'none', padding: 0, margin: '0.25rem 0', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              {seg.items.map((item, j) => (
                <li key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', fontSize: '0.9rem', color: 'var(--color-text)', lineHeight: 1.65 }}>
                  <span style={{ color: 'var(--color-primary)', fontWeight: 700, marginTop: '0.2em', flexShrink: 0, fontSize: '0.65rem' }}>◆</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )
        }
        // paragraph
        return (
          <p key={i} style={{ fontSize: '0.9rem', color: 'var(--color-text)', lineHeight: 1.75, margin: 0 }}>
            {seg.text}
          </p>
        )
      })}
    </div>
  )
}

// ── Dark (admin) renderer ─────────────────────────────────────────────────────

export function JobDescriptionDark({ description }: { description: string }) {
  const segments = parseSegments(description)

  if (segments.length === 0) {
    return (
      <p style={{ color: 'rgba(255,255,255,0.25)', fontStyle: 'italic', fontSize: 12 }}>
        Description non récupérée — relancez un scraping pour obtenir le contenu complet.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
      {segments.map((seg, i) => {
        if (seg.type === 'spacer') {
          return <div key={i} style={{ height: '0.6rem' }} />
        }
        if (seg.type === 'heading') {
          return (
            <div key={i} style={{ marginTop: i === 0 ? 0 : '1rem', marginBottom: '0.375rem' }}>
              <p style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'rgba(255,255,255,0.85)',
                letterSpacing: '0.02em',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                margin: 0,
              }}>
                <span style={{ display: 'inline-block', width: 3, height: 14, borderRadius: 2, background: '#0a66c2', flexShrink: 0 }} />
                {seg.text}
              </p>
            </div>
          )
        }
        if (seg.type === 'bullet') {
          return (
            <ul key={i} style={{ listStyle: 'none', padding: 0, margin: '0.2rem 0', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {seg.items.map((item, j) => (
                <li key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.65 }}>
                  <span style={{ color: '#60a5fa', fontWeight: 700, marginTop: '0.15em', flexShrink: 0, fontSize: 8 }}>◆</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i} style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.8, margin: 0 }}>
            {seg.text}
          </p>
        )
      })}
    </div>
  )
}
