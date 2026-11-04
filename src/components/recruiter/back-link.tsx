'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useSyncExternalStore, type CSSProperties } from 'react'
import { ArrowLeft } from 'lucide-react'
import { backTarget, parseTrail, recordVisit, recruiterPageLabel } from '@/lib/recruiter-trail'

// Lien « ← Retour : <page d'origine> » des pages de détail de l'espace recruteur (demande du 2026-11-04). Il ramène à
// la page visitée juste avant dans l'onglet, à son adresse exacte (filtres, onglet) ; sans page précédente (page
// ouverte directement, nouvel onglet), à la page parente donnée par la page. Le layout recruteur monte
// RecruiterTrailRecorder, qui note les pages visitées dans sessionStorage (propre à l'onglet, gardé au rechargement).
// Règles pures : src/lib/recruiter-trail.ts.

const STORAGE_KEY = 'mbc-recruiter-trail'
const EMPTY: string[] = []

/** Pages visitées dans l'onglet ; null tant qu'elles n'ont pas été relues dans le stockage. */
let trail: string[] | null = null
const listeners = new Set<() => void>()

function readTrail(): string[] {
  if (trail === null) {
    try {
      trail = parseTrail(sessionStorage.getItem(STORAGE_KEY))
    } catch {
      // Stockage bloqué (navigation privée, réglages) : historique gardé en mémoire, perdu au rechargement ; les
      // liens « Retour » mènent alors à la page parente.
      trail = []
    }
  }
  return trail
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function record(url: string) {
  const before = readTrail()
  const next = recordVisit(before, url)
  if (next === before) return
  trail = next
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Voir readTrail : l'historique reste en mémoire pour cet onglet.
  }
  listeners.forEach(listener => listener())
}

/**
 * Oublie les pages visitées dans l'onglet (déconnexion) : le compte suivant ne doit pas voir les adresses du précédent
 * (identifiants, texte recherché) dans ses liens « Retour ».
 */
export function clearRecruiterTrail() {
  trail = []
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Stockage bloqué : rien n'y a été écrit (voir readTrail).
  }
  listeners.forEach(listener => listener())
}

/** Note chaque page de l'espace recruteur affichée dans l'onglet (layout recruteur, sous un Suspense). */
export function RecruiterTrailRecorder() {
  const pathname = usePathname()
  const search = useSearchParams().toString()
  // Après l'affichage : le lien « Retour » compte déjà la page affichée (backTarget), il n'attend pas cette note.
  useEffect(() => {
    record(search ? `${pathname}?${search}` : pathname)
  }, [pathname, search])
  return null
}

interface BackLinkProps {
  /** Page parente, quand l'onglet n'a pas de page précédente. */
  fallbackHref: string
  /** Nom de la page parente, s'il est plus précis que celui de son adresse (recruiterPageLabel). */
  fallbackLabel?: string
  className?: string
  style?: CSSProperties
  iconClassName?: string
  /** Flèche seule (en-têtes compacts) : « Retour : <page> » en infobulle et pour les lecteurs d'écran. */
  iconOnly?: boolean
}

export function BackLink({ fallbackHref, fallbackLabel, className, style, iconClassName = 'h-3.5 w-3.5', iconOnly = false }: BackLinkProps) {
  const pathname = usePathname()
  const visited = useSyncExternalStore(subscribe, readTrail, () => EMPTY)
  const origin = backTarget(visited, pathname)
  const href = origin ?? fallbackHref
  const text = `Retour : ${origin ? recruiterPageLabel(origin) : fallbackLabel ?? recruiterPageLabel(fallbackHref)}`
  return (
    <Link href={href} className={className} style={style} aria-label={iconOnly ? text : undefined} title={iconOnly ? text : undefined}>
      <ArrowLeft className={iconClassName} aria-hidden />
      {!iconOnly && text}
    </Link>
  )
}
