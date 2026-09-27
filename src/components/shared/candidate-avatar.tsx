'use client'

interface Props {
  photoUrl?: string
  initials: string
  size?: number
  openToWork?: boolean
  // Background the ring's inner gap and outer glow sit against — pass the
  // actual surrounding background so the "cutout" reads correctly on both
  // dark headers and light cards.
  bgColor?: string
}

// LinkedIn-style "Open to Work" frame: a spinning gradient ring around the
// photo, plus a curved banner following the bottom of the circle with the
// text sitting *in* the ring rather than as a separate badge underneath.
export function CandidateAvatar({ photoUrl, initials, size = 76, openToWork, bgColor = 'var(--hero-bg)' }: Props) {
  const svg = size + 28
  const c = svg / 2
  const r = size / 2 + 7
  const arcId = `otw-arc-${size}`
  const gradId = `otw-grad-${size}`
  // Bottom half of the ring, traced left-to-right so the text reads normally
  // (not mirrored) — see mbc-otw docs in mini-cv-card history for the math.
  const bottomArc = `M ${c - r},${c} A ${r},${r} 0 0 0 ${c + r},${c}`

  return (
    <div className="relative shrink-0" style={{ width: svg, height: svg }}>
      {openToWork && (
        <>
          <svg viewBox={`0 0 ${svg} ${svg}`} width={svg} height={svg} className="absolute inset-0 mbc-otw-spin" style={{ pointerEvents: 'none' }}>
            <defs>
              <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#6ee7b7" />
                <stop offset="50%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#047857" />
              </linearGradient>
            </defs>
            <circle cx={c} cy={c} r={r} fill="none" stroke={`url(#${gradId})`} strokeWidth="3" />
          </svg>
          <div className="absolute rounded-full mbc-otw-pulse" style={{ inset: 9, pointerEvents: 'none' }} />
        </>
      )}

      <div className="absolute rounded-full overflow-hidden flex items-center justify-center font-bold"
        style={{
          inset: 14, background: 'var(--color-primary)', color: 'white',
          fontSize: size * 0.28,
          boxShadow: openToWork
            ? `0 0 0 3px ${bgColor}, 0 10px 24px rgba(0,0,0,0.3)`
            : '0 0 0 4px rgba(255,255,255,0.15), 0 10px 24px rgba(0,0,0,0.25)',
        }}>
        {photoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={photoUrl} alt="" className="w-full h-full object-cover" />
          : <span>{initials}</span>}
      </div>

      {openToWork && (
        <svg viewBox={`0 0 ${svg} ${svg}`} width={svg} height={svg} className="absolute inset-0" style={{ pointerEvents: 'none' }}>
          <defs>
            <path id={arcId} d={bottomArc} fill="none" />
          </defs>
          <path d={bottomArc} fill="none" stroke="#059669" strokeWidth={size * 0.16} strokeLinecap="round" />
          <text fontSize={size * 0.105} fontWeight="800" letterSpacing="0.6" fill="white">
            <textPath href={`#${arcId}`} startOffset="50%" textAnchor="middle">OPEN TO WORK</textPath>
          </text>
        </svg>
      )}

      <style>{`
        @keyframes mbc-otw-spin { to { transform: rotate(360deg); } }
        @keyframes mbc-otw-pulse { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,0.5); } 100% { box-shadow: 0 0 0 10px rgba(16,185,129,0); } }
        .mbc-otw-spin { animation: mbc-otw-spin 4s linear infinite; transform-origin: center; }
        .mbc-otw-pulse { animation: mbc-otw-pulse 2s ease-out infinite; }
      `}</style>
    </div>
  )
}
