// Recommandations et matching : plus un candidat est recommandé sur une expertise que l'offre demande, plus son score monte.
// Pur (aucun accès base) : partagé par le screening, la page Matching et l'affichage.

export const RELATIONSHIPS = [
  { value: 'manager', label: 'Responsable hiérarchique (N+1, N+2…)' },
  { value: 'client', label: 'Client' },
  { value: 'colleague', label: 'Collègue / pair' },
  { value: 'report', label: 'Collaborateur (j’étais son manager)' },
  { value: 'partner', label: 'Partenaire / prestataire' },
  { value: 'other', label: 'Autre' },
] as const

export const RELATIONSHIP_LABEL: Record<string, string> = Object.fromEntries(RELATIONSHIPS.map(r => [r.value, r.label]))

const norm = (s: string) => ` ${s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').trim()} `

export interface ExpertiseCount { expertise: string; count: number }

/** Nombre de recommandations par expertise (une recommandation compte une fois par expertise qu'elle confirme). */
export function expertiseCounts(recs: { endorsedExpertises?: string[] }[]): ExpertiseCount[] {
  const map = new Map<string, ExpertiseCount>()
  for (const r of recs) {
    for (const e of new Set((r.endorsedExpertises ?? []).map(x => x.trim()).filter(Boolean))) {
      const key = e.toLowerCase()
      const cur = map.get(key)
      if (cur) cur.count++; else map.set(key, { expertise: e, count: 1 })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}

/** Points par expertise demandée par l'offre : 1 recommandation = +2, 2 = +3,5, 3 ou plus = +5. Plafond global : +12. */
export const BOOST_CAP = 12
const pointsFor = (count: number) => (count >= 3 ? 5 : count === 2 ? 3.5 : 2)

export function expertiseBoost(recs: { endorsedExpertises?: string[] }[], jobText: string): { points: number; matched: ExpertiseCount[] } {
  const text = norm(jobText)
  const matched = expertiseCounts(recs).filter(c => {
    const e = norm(c.expertise)
    return e.trim().length >= 2 && text.includes(e)
  })
  const points = Math.round(Math.min(BOOST_CAP, matched.reduce((s, c) => s + pointsFor(c.count), 0)))
  return { points, matched }
}

export const formatMatched = (matched: ExpertiseCount[]) => matched.map(m => `${m.expertise} ×${m.count}`).join(', ')
