// Logos sweep across once per pass — no duplicated items in the DOM. The strip starts
// fully off-screen right (translateX(100%) of its own width) and ends fully off-screen
// left (translateX(-100%)), so the loop restart is invisible (both endpoints are
// off-canvas) without needing to render the list twice.
const TITLE_SIZE: Record<'sm' | 'md' | 'lg', string> = { sm: '11px', md: '15px', lg: '20px' }

export function TrustedLogosMarquee({
  logos, title, bgColor, titleSize = 'sm', titleBold = false,
}: {
  logos: string[]
  title?: string
  bgColor?: string
  titleSize?: 'sm' | 'md' | 'lg'
  titleBold?: boolean
}) {
  if (logos.length === 0) return null

  const duration = Math.max(16, logos.length * 4)

  return (
    <div style={{ background: bgColor || 'var(--color-background)', padding: '3.5rem 0', overflow: 'hidden' }}>
      <p style={{
        textAlign: 'center', fontSize: TITLE_SIZE[titleSize], fontWeight: titleBold ? 800 : 700,
        letterSpacing: titleSize === 'lg' ? '0.04em' : '0.2em',
        textTransform: titleSize === 'lg' ? 'none' : 'uppercase',
        color: titleSize === 'lg' ? 'var(--color-text)' : 'var(--color-text-muted)',
        marginBottom: '2.25rem', fontFamily: titleSize === 'lg' ? 'var(--font-heading)' : 'inherit',
      }}>
        {title || 'Ils nous ont fait confiance'}
      </p>
      <div className="tlm-track-wrap">
        <div className="tlm-track" style={{ animationDuration: `${duration}s` }}>
          {logos.map((url, i) => (
            <div key={i} className="tlm-logo-cell">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="tlm-logo" />
            </div>
          ))}
        </div>
      </div>
      <style>{`
        .tlm-track-wrap { width: 100%; overflow: hidden; }
        .tlm-track {
          display: flex; align-items: center; gap: 5rem; width: max-content;
          animation-name: tlm-sweep; animation-timing-function: linear; animation-iteration-count: infinite;
          will-change: transform;
        }
        .tlm-logo-cell {
          height: 90px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .tlm-logo {
          height: 100%; width: auto; max-width: 260px; object-fit: contain;
          transition: transform 0.2s;
        }
        .tlm-logo:hover { transform: scale(1.06); }
        @keyframes tlm-sweep {
          from { transform: translateX(100vw); }
          to   { transform: translateX(-100%); }
        }
        @media (max-width: 640px) {
          .tlm-track { gap: 2.5rem; }
          .tlm-logo-cell { height: 56px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .tlm-track { animation: none; transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
