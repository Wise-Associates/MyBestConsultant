'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

// The App Router has no global "navigation pending" signal (useLinkStatus only works inside one
// <Link>), so the bar starts on a click that <Link> turns into a client-side navigation (it calls
// preventDefault) and completes when the URL changes. Navigations started with router.push()
// show it when the caller announces them with startNavigationProgress().

const START_EVENT = 'mbc:navigation-start'

/** Avant un router.push() : la barre du haut avance jusqu'à l'arrivée de la page, comme pour un lien. */
export function startNavigationProgress(): void {
  window.dispatchEvent(new Event(START_EVENT))
}

// A navigation cancelled after the click never changes the URL: stop waiting after this delay
const MAX_WAIT_MS = 15_000
const START_PROGRESS = 8
const TRICKLE_CEILING = 90

export function NavigationProgress() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentUrl = `${pathname}?${searchParams}`
  const currentUrlRef = useRef(currentUrl)
  useEffect(() => { currentUrlRef.current = currentUrl })

  // URL the navigation started from: the bar is loading while we are still on it
  const [startedFrom, setStartedFrom] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const loading = startedFrom === currentUrl
  const finished = startedFrom !== null && !loading

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const link = (e.target as Element | null)?.closest('a[href]')
      if (!(link instanceof HTMLAnchorElement)) return
      if (link.target && link.target !== '_self') return
      const url = new URL(link.href, window.location.href)
      if (url.origin !== window.location.origin) return
      // Same page (or only the #hash changes): the URL won't change, nothing to wait for
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      start()
    }
    function start() {
      setStartedFrom(currentUrlRef.current)
      setProgress(p => (p > 0 ? p : START_PROGRESS))
    }
    // On window so it runs after React's handlers (attached to document), once <Link> has called preventDefault
    window.addEventListener('click', onClick)
    window.addEventListener(START_EVENT, start)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener(START_EVENT, start)
    }
  }, [])

  // Creep towards the ceiling while the next page loads
  useEffect(() => {
    if (!loading) return
    const trickle = setInterval(() => setProgress(p => p + (TRICKLE_CEILING - p) * 0.1), 200)
    const giveUp = setTimeout(() => { setStartedFrom(null); setProgress(0) }, MAX_WAIT_MS)
    return () => { clearInterval(trickle); clearTimeout(giveUp) }
  }, [loading])

  // Fill the bar, let it fade out (see .mbc-nav-progress), then reset
  useEffect(() => {
    if (!finished) return
    const reset = setTimeout(() => { setStartedFrom(null); setProgress(0) }, 500)
    return () => clearTimeout(reset)
  }, [finished])

  return (
    <div
      aria-hidden
      className="mbc-nav-progress"
      data-state={loading ? 'loading' : finished ? 'done' : 'idle'}
      style={{ transform: `scaleX(${(finished ? 100 : progress) / 100})` }}
    />
  )
}
