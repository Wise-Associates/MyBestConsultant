'use client'

export function PageLoader({ message = 'Chargement…', fullScreen = true }: { message?: string; fullScreen?: boolean }) {
  return (
    <div
      className={fullScreen ? 'fixed inset-0 z-[9999] flex flex-col items-center justify-center' : 'flex flex-col items-center justify-center py-24'}
      style={{ background: fullScreen ? 'rgba(11,10,25,0.7)' : 'transparent', backdropFilter: fullScreen ? 'blur(10px)' : undefined }}
    >
      <div className="relative w-60 h-60" style={{ perspective: '800px' }}>
        <div className="absolute inset-0" style={{ transformStyle: 'preserve-3d', transform: 'rotateX(55deg)' }}>
          {/* Outer ring — tilted in 3D, rotates one way */}
          <div className="absolute inset-0 rounded-full animate-spin" style={{ animationDuration: '1.4s' }}>
            <div className="w-full h-full rounded-full" style={{
              background: 'conic-gradient(from 0deg, transparent 0%, transparent 55%, #7c3aed 85%, #c4b5fd 100%)',
              boxShadow: '0 0 36px rgba(124,58,237,0.55)',
            }} />
          </div>
          {/* Mid ring — counter-rotates, gold accent for depth */}
          <div className="absolute inset-[18px] rounded-full animate-spin" style={{ animationDuration: '2s', animationDirection: 'reverse' }}>
            <div className="w-full h-full rounded-full" style={{
              background: 'conic-gradient(from 90deg, transparent 0%, transparent 70%, #FB923C 92%, #f3d576 100%)',
              opacity: 0.8,
            }} />
          </div>
          {/* Inner disc */}
          <div className="absolute inset-[38px] rounded-full" style={{ background: '#2C2C2E', boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.5)' }} />
        </div>

        {/* Logo — big, dead-centered, spinning on its own axis for a tech feel */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="animate-spin" style={{ animationDuration: '2.4s' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" className="w-40 h-40 object-contain drop-shadow-[0_6px_16px_rgba(0,0,0,0.55)]"
              onError={e => { e.currentTarget.style.display = 'none' }} />
          </div>
        </div>
      </div>

      <div className="mt-8 text-center">
        <p className="text-sm font-semibold tracking-wide" style={{ color: fullScreen ? 'white' : 'var(--color-text)' }}>
          {message}
        </p>
      </div>

      <div className="flex gap-1.5 mt-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce"
            style={{ background: '#7c3aed', animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  )
}
