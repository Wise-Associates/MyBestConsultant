// Compatibilité entre un profil du vivier d'un chasseur et une offre (Module 14) — pur, sans base ni IA :
// recouvrement des compétences demandées + proximité du titre. Sert à TRIER les suggestions ; le chasseur
// reste seul juge du profil qu'il propose.

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9+#.]+/g, ' ').trim()
const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'un', 'une', 'et', 'en', 'pour', 'chez', 'the', 'and', 'of', 'h', 'f'])

const tokens = (s: string) => norm(s).split(' ').filter(t => t.length > 1 && !STOP.has(t))

export interface MatchResult { score: number; matchedSkills: string[] }

export function matchProfileToJob(
  profile: { skills: string[]; title: string; summary?: string },
  job: { title: string; skills: string[]; description?: string },
): MatchResult {
  const jobSkills = job.skills.map(norm).filter(Boolean)
  const haystack = ` ${[...profile.skills, profile.title, profile.summary ?? ''].map(norm).join(' ')} `
  const mine = new Set(profile.skills.map(norm))

  const matched = job.skills.filter(s => {
    const n = norm(s)
    return n && (mine.has(n) || haystack.includes(` ${n} `))
  })
  const skillScore = jobSkills.length > 0 ? matched.length / jobSkills.length : 0

  const jt = new Set(tokens(job.title))
  const pt = tokens(profile.title)
  const titleScore = jt.size > 0 && pt.length > 0 ? pt.filter(t => jt.has(t)).length / Math.min(jt.size, pt.length) : 0

  // Sans compétence listée sur l'offre, seul le titre parle ; sinon les compétences pèsent 80 %.
  const score = jobSkills.length > 0 ? skillScore * 0.8 + Math.min(titleScore, 1) * 0.2 : Math.min(titleScore, 1) * 0.6
  return { score: Math.round(Math.min(score, 1) * 100), matchedSkills: matched }
}

/** Statut d'une proposition vu par le chasseur (le statut brut du pipeline du recruteur, en langage clair). */
export function proposalStatus(status: string): { label: string; color: string } {
  switch (status) {
    case 'pending': return { label: 'Reçu par le recruteur', color: '#6b7280' }
    case 'screening': return { label: 'Profil en analyse', color: '#8b5cf6' }
    case 'interview': return { label: 'Entretien en cours', color: '#3b82f6' }
    case 'accepted': return { label: 'Retenu ✓', color: '#10b981' }
    case 'on_hold': return { label: 'Gardé en vivier', color: '#f59e0b' }
    case 'rejected': return { label: 'Non retenu', color: '#ef4444' }
    default: return { label: 'En cours de traitement', color: '#6366f1' }
  }
}
