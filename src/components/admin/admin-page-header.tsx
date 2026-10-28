'use client'

import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

const SLOT_ID = 'admin-page-header'

/** Emplacement de l'en-tête de la page, dans la barre du haut du layout admin (src/app/admin/layout.tsx). */
export function AdminPageHeaderSlot() {
  return <div id={SLOT_ID} className="flex-1 min-w-0 flex items-center" />
}

// L'emplacement appartient au layout : il existe déjà quand une page s'affiche et ne change plus ensuite.
const noSubscription = () => () => {}

/**
 * En-tête d'une page admin (titre, sous-titre, actions) affiché dans la barre du haut du layout plutôt que
 * dans la page : une seule barre, sans bande vide au-dessus du contenu. Les actions restent des éléments de la
 * page (état, Server Actions) : le portail ne déplace que leur affichage. Rendu après l'hydratation (le serveur
 * ne connaît pas l'emplacement). Texte clair : la barre est sur le fond bleu du back-office, y compris au-dessus
 * des pages claires (.admin-light), dont les tokens --admin-* n'existent pas dans la barre.
 */
export function AdminPageHeader({ title, description, back, actions }: {
  title: string
  /** Une ligne, coupée si elle est trop longue (texte complet au survol). */
  description?: string
  /** Retour à la page parente, à gauche du titre (sous-pages). */
  back?: { href: string; label: string }
  actions?: React.ReactNode
}) {
  const slot = useSyncExternalStore(noSubscription, () => document.getElementById(SLOT_ID), () => null)
  if (!slot) return null

  return createPortal(
    <div className="flex-1 min-w-0 flex items-center gap-3">
      {back && (
        <Link href={back.href} aria-label={`Retour : ${back.label}`} title={back.label}
          className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center transition-colors hover:bg-white/10"
          style={{ color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.12)' }}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
      )}
      <div className="flex-1 min-w-0">
        {/* Taille en style : la règle globale de h1 (globals.css, hors couche) l'emporte sur les classes Tailwind. */}
        <h1 className="truncate" style={{ color: 'white', fontSize: '1.0625rem', fontWeight: 600, lineHeight: 1.35, letterSpacing: '-0.01em' }}>
          {title}
        </h1>
        {description && (
          <p className="text-xs truncate" title={description} style={{ color: 'rgba(255,255,255,0.6)' }}>{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>,
    slot,
  )
}
