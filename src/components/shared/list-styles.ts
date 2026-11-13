import type { CSSProperties } from 'react'

// Charte des listes d'offres : « Mes offres » du tableau de bord recruteur (/recruiter/dashboard) et liste publique des
// offres (/jobs, demande du 2026-11-13 : même charte). Couleurs du thème du site seulement.

export const muted: CSSProperties = { color: 'var(--color-text-muted)' }

/** Carte d'une liste ou du rail de filtres. */
export const listCard = 'rounded-[20px]'
export const listCardStyle: CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' }
export const railCard = 'rounded-[20px] p-3.5'

/** Titre d'un groupe du rail de filtres. En style : les règles h1–h6 de globals.css l'emportent sur les classes de taille. */
export const railHeading = 'font-semibold uppercase mb-2 px-0.5'
export const railHeadingStyle: CSSProperties = { ...muted, fontSize: 11, letterSpacing: '0.06em', lineHeight: 1.4 }

/** Champ et bouton secondaire (recherche, filtres). */
export const field = 'h-11 sm:h-10 px-3 rounded-xl text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-text)'
export const fieldStyle: CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }

/** Petit badge d'une ligne (« Archivée », contrat, compétence). */
export const badge = 'inline-flex items-center gap-1 text-[11px] font-semibold rounded-md px-[7px] py-0.5'
export const neutralBadge: CSSProperties = { background: 'color-mix(in srgb, var(--color-text) 7%, transparent)', color: 'var(--color-text)' }
export const amberBadge: CSSProperties = { background: '#b4530914', color: '#b45309' }

/** En-tête des colonnes d'une liste (grand écran). */
export const columnHeaderStyle: CSSProperties = {
  ...muted, background: 'color-mix(in srgb, var(--color-text) 2.5%, transparent)', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)',
}
