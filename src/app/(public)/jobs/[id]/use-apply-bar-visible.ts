'use client'

import { useEffect, useState } from 'react'

const TOP_SENTINEL_ID = 'apply-top-sentinel'

// The fixed mobile "Postuler" bar should only appear once the recruiter... er, the visitor
// has scrolled past the inline CTA card at the top (no point duplicating it while it's
// already on screen), and disappear again once the footer comes into view.
export function useApplyBarVisible(): boolean {
  const [pastTop, setPastTop] = useState(false)
  const [nearFooter, setNearFooter] = useState(false)

  useEffect(() => {
    const topEl = document.getElementById(TOP_SENTINEL_ID)
    const footerEl = document.querySelector('footer')

    const topObserver = new IntersectionObserver(
      ([entry]) => setPastTop(!entry.isIntersecting),
      { threshold: 0 },
    )
    if (topEl) topObserver.observe(topEl)

    const footerObserver = new IntersectionObserver(
      ([entry]) => setNearFooter(entry.isIntersecting),
      { threshold: 0 },
    )
    if (footerEl) footerObserver.observe(footerEl)

    return () => {
      topObserver.disconnect()
      footerObserver.disconnect()
    }
  }, [])

  return pastTop && !nearFooter
}
