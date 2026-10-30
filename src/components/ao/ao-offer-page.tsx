'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import type { AoDashboardActions, AoDashboardCopy, AoDashboardPaths, AoOfferNeighbours } from '@/lib/ao/dashboard-types'
import type { AoOfferRow } from '@/lib/ao/filters'
import { trackingSteps, type TrackingStep } from '@/lib/ao/tracking'
import { secondaryButton } from '@/app/admin/candidats/labels'
import { Banner } from './ao-banner'
import { AoOfferDetail } from './ao-offer-detail'
import { useAoPublications } from './offer-publications'

// Page d'une offre AO (/admin/candidats/<id>, /recruiter/parametres/boites-ao/<id>) : son détail, et la navigation vers
// la liste et vers les offres précédente et suivante de la liste filtrée (filtres gardés dans l'adresse, même ordre que
// le tableau). Flèches ← et → du clavier hors des champs de saisie.

interface Props {
  row: AoOfferRow
  /** Suivi de l'offre publiée lu par le serveur (tracking-store.ts) ; absent : calculé ici d'après l'offre. */
  tracking?: TrackingStep[]
  trackingError?: string
  neighbours: AoOfferNeighbours
  /** Filtres de la liste (forme canonique), gardés d'une offre à l'autre et au retour à la liste. */
  query: string
  actions: Pick<AoDashboardActions, 'setStatus' | 'sourcing' | 'stopTasks'>
  paths: Pick<AoDashboardPaths, 'list' | 'originalApi' | 'jobs'>
  copy: Pick<AoDashboardCopy, 'title' | 'publishNote' | 'social'>
  /** Hauteur des barres fixes de l'espace au-dessus du contenu, où se colle la barre du haut de l'offre. */
  stickyTop: number
  /** Espace admin : titre dans la barre du haut du layout (AdminPageHeader). */
  titleInAdminBar?: boolean
}

const navButton: CSSProperties = { ...secondaryButton, padding: '8px 12px' }

/** Champ de saisie qui a le focus : les flèches y déplacent le curseur, pas l'offre affichée. */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

export function AoOfferPage({ row, tracking, trackingError, neighbours, query, actions, paths, copy, stickyTop, titleInAdminBar }: Props) {
  const router = useRouter()
  const publications = useAoPublications()
  const { setOpenOffer } = publications
  const suffix = query ? `?${query}` : ''
  const listHref = `${paths.list}${suffix}`
  const offerHref = (id: string | null) => (id ? `${paths.list}/${encodeURIComponent(id)}${suffix}` : null)
  const previousHref = offerHref(neighbours.previous)
  const nextHref = offerHref(neighbours.next)
  const steps = tracking ?? trackingSteps(row)

  // La fin d'une préparation ou d'une publication de cette offre se lit ici ; celle des autres offres fait un message.
  useEffect(() => {
    setOpenOffer(row.$id)
    return () => setOpenOffer(null)
  }, [row.$id, setOpenOffer])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || isTyping(e.target)) return
      const href = e.key === 'ArrowLeft' ? previousHref : e.key === 'ArrowRight' ? nextHref : null
      if (href) router.push(href)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previousHref, nextHref, router])

  // Diffusion et sourcing avancent en arrière-plan après une publication : tant qu'une étape est en cours, la page est
  // relue toutes les 15 s, 15 min au plus (comme le tableau).
  const workingKey = steps.filter(s => s.tone === 'working').map(s => `${s.key}:${s.text}`).join('|')
  useEffect(() => {
    if (!workingKey) return
    let refreshes = 0
    const timer = setInterval(() => { if (++refreshes > 60) clearInterval(timer); else router.refresh() }, 15_000)
    return () => clearInterval(timer)
  }, [workingKey, router])

  const position = neighbours.position === null
    ? 'Hors de la liste filtrée'
    : `${neighbours.position.toLocaleString('fr-FR')} sur ${neighbours.total.toLocaleString('fr-FR')}`
  const navigation: ReactNode = (
    <nav aria-label="Navigation entre les offres" className="flex items-center gap-2 flex-wrap">
      <Link href={listHref} style={navButton}><ArrowLeft size={15} aria-hidden />Liste</Link>
      <span className="text-xs tabular-nums px-1" style={{ color: 'var(--admin-fg-muted)' }}>{position}</span>
      <NavLink href={previousHref} label="Précédente" shortcut="←" icon={<ChevronLeft size={15} aria-hidden />} />
      <NavLink href={nextHref} label="Suivante" shortcut="→" icon={<ChevronRight size={15} aria-hidden />} iconAfter />
    </nav>
  )

  return (
    <div className="admin-light min-h-full px-4 sm:px-8 pb-8">
      {titleInAdminBar && <AdminPageHeader title={copy.title} description={row.title} />}
      <div className="mx-auto max-w-6xl space-y-4">
        {publications.notice && <div className="pt-4"><Banner tone={publications.notice.tone} text={publications.notice.text} onClose={publications.clearNotice} /></div>}
        {trackingError && <div className="pt-4"><Banner tone="error" text={trackingError} /></div>}
        <AoOfferDetail row={row} actions={actions} paths={paths} publishNote={copy.publishNote}
          tracking={steps} social={copy.social}
          publication={publications.of(row.$id)}
          onPrepare={mode => publications.prepare(row.$id, row.title, mode)}
          onStopPreparing={() => publications.stopPreparing(row.$id)}
          onPublish={(draft, skillsText) => publications.publish(row.$id, row.title, draft, skillsText)}
          onEdit={patch => publications.edit(row.$id, patch)}
          onCancel={() => publications.cancel(row.$id)}
          navigation={navigation} stickyTop={stickyTop} />
      </div>
    </div>
  )
}

/** Offre précédente ou suivante ; grisée en bout de liste. */
function NavLink({ href, label, shortcut, icon, iconAfter }: { href: string | null; label: string; shortcut: string; icon: ReactNode; iconAfter?: boolean }) {
  const content = iconAfter ? <>{label}{icon}</> : <>{icon}{label}</>
  if (!href) return <span aria-disabled="true" style={{ ...navButton, opacity: 0.45, cursor: 'not-allowed' }}>{content}</span>
  return <Link href={href} title={`${label} (touche ${shortcut})`} style={navButton}>{content}</Link>
}
