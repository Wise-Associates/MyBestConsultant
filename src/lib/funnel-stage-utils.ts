export interface StageLite { slug: string; label: string; color: string; order: number; autoAction?: string | null }

// Libellés/couleurs des étapes standard — servent quand une candidature porte un statut que le
// funnel personnalisé du recruteur ne contient plus (étape supprimée/renommée). Le Kanban
// affiche alors une colonne dédiée ; les rapports font pareil au lieu d'afficher le slug brut.
const LEGACY: Record<string, { label: string; color: string }> = {
  pending: { label: 'Candidats sélectionnés', color: '#6b7280' },
  screening: { label: 'Screening IA', color: '#8b5cf6' },
  interview: { label: 'Entretien', color: '#3b82f6' },
  accepted: { label: 'Accepté', color: '#10b981' },
  on_hold: { label: 'Vivier', color: '#f59e0b' },
  rejected: { label: 'Refusé', color: '#ef4444' },
}

const humanize = (slug: string) => {
  const t = slug.replace(/[_-]+/g, ' ').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Autre'
}

/**
 * Rattache un statut « ancien » (ex. `screening`) à l'étape actuelle du funnel qui le remplace
 * (même action automatique ou même libellé) — évite qu'une étape recréée sous un autre
 * identifiant technique n'apparaisse en double dans les rapports.
 */
export function resolveStatus(stages: StageLite[], status: string): string {
  if (stages.some(s => s.slug === status)) return status
  const legacy = LEGACY[status]
  const match = stages.find(s => s.autoAction === status || (legacy && s.label.trim().toLowerCase() === legacy.label.toLowerCase()))
  return match?.slug ?? status
}

/** Étapes du funnel + une étape « orpheline » par statut inconnu, placées à la suite. */
export function withOrphanStages(stages: StageLite[], statuses: string[]): StageLite[] {
  const sorted = [...stages].sort((a, b) => a.order - b.order)
  const known = new Set(sorted.map(s => s.slug))
  let order = (sorted[sorted.length - 1]?.order ?? -1) + 1
  const extra: StageLite[] = []
  for (const slug of new Set(statuses)) {
    if (known.has(slug)) continue
    const legacy = LEGACY[slug]
    extra.push({ slug, label: legacy?.label ?? humanize(slug), color: legacy?.color ?? '#9ca3af', order: order++ })
  }
  return [...sorted, ...extra]
}
