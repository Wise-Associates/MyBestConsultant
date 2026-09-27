'use client'

import { useApplyBarVisible } from './use-apply-bar-visible'

// Mobile-only (lg:hidden) — slides up/fades in once the top CTA card scrolls out of view,
// slides back down once the footer appears, so it never floats uselessly over either.
export function MobileApplyBar({ children }: { children: React.ReactNode }) {
  const visible = useApplyBarVisible()

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 lg:hidden transition-all duration-300 ease-out"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(20px)',
        pointerEvents: visible ? 'auto' : 'none',
      }}
      aria-hidden={!visible}
    >
      <div className="h-6" style={{ background: 'linear-gradient(to top, var(--color-background), transparent)' }} />
      <div style={{
        background: 'var(--color-background)', borderTop: '1px solid var(--color-border)',
        padding: '0.625rem 1rem', paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom))',
      }}>
        {children}
      </div>
    </div>
  )
}
