import type { Job } from '@/types'

// Liste publique des offres (/jobs, refonte du 2026-11-13 d'après la maquette) : nombre d'offres par type de contrat et
// par télétravail, offre « Nouveau », date relative, compétences montrées sur une ligne. Règles pures, testées dans
// job-listing.test.ts.

/** Offres par page (maquette : « Offres 1 à 25 sur 51 »). */
export const JOBS_PAGE_SIZE = 25

export const CONTRACT_TYPES = ['mission', 'freelance', 'cdi', 'cdd'] as const
export const REMOTE_MODES = ['remote', 'hybrid', 'onsite'] as const

export interface JobFacets {
  /** Offres qui répondent à tous les filtres, contrat et télétravail compris. */
  results: Job[]
  /** Par type de contrat : offres qui répondent aux autres filtres (télétravail compris), quel que soit le contrat choisi. */
  contractCounts: Record<string, number>
  /** Par télétravail : offres qui répondent aux autres filtres (contrat compris), quel que soit le télétravail choisi. */
  remoteCounts: Record<string, number>
  /**
   * Nombre affiché à côté de « Tous » : toutes les offres des autres filtres, y compris celles sans type de contrat (ou
   * sans télétravail renseigné), que la somme des nombres par choix ne compterait pas.
   */
  contractTotal: number
  remoteTotal: number
}

/**
 * Filtres du contrat et du télétravail appliqués à `jobs` (déjà filtrées par mots-clés, lieu et séniorité), et nombres
 * affichés à côté de chaque choix : ce que donnerait ce choix, les autres filtres gardés.
 */
export function jobFacets(jobs: Job[], filters: { contract?: string; remote?: string }): JobFacets {
  const contract = filters.contract || ''
  const remote = filters.remote || ''
  const byRemote = remote ? jobs.filter(j => j.remote === remote) : jobs
  const byContract = contract ? jobs.filter(j => j.contractType === contract) : jobs
  const count = (list: Job[], key: (j: Job) => string | undefined) => {
    const counts: Record<string, number> = {}
    for (const j of list) {
      const k = key(j)
      if (k) counts[k] = (counts[k] ?? 0) + 1
    }
    return counts
  }
  return {
    results: contract ? byRemote.filter(j => j.contractType === contract) : byRemote,
    contractCounts: count(byRemote, j => j.contractType),
    remoteCounts: count(byContract, j => j.remote),
    contractTotal: byRemote.length,
    remoteTotal: byContract.length,
  }
}

/** Offre publiée depuis moins de 3 jours : badge « Nouveau ». */
export function isNewJob(createdAt: string, nowMs: number): boolean {
  const created = Date.parse(createdAt)
  return Number.isFinite(created) && nowMs - created < 3 * 86_400_000
}

/** « Publiée il y a 2 h », « il y a 3 j », « il y a 2 sem. », « il y a 3 mois ». */
export function publishedAgo(createdAt: string, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - Date.parse(createdAt)) / 1000))
  if (!Number.isFinite(s)) return ''
  if (s < 3600) return 'il y a moins d’une heure'
  if (s < 86_400) return `il y a ${Math.floor(s / 3600)} h`
  const days = Math.floor(s / 86_400)
  if (days < 7) return `il y a ${days} j`
  if (days < 30) return `il y a ${Math.floor(days / 7)} sem.`
  return `il y a ${Math.floor(days / 30)} mois`
}

/**
 * Compétences montrées sur une ligne du tableau et nombre des autres (« +2 ») : 3 au plus, tant qu'elles tiennent dans
 * environ 28 caractères (largeur de la colonne, badges de 11 px ; les compétences réelles sont souvent longues : « Architecture
 * client/serveur »), au moins une.
 */
export function skillsPreview(skills: string[], max = 3, budget = 28): { shown: string[]; more: number } {
  const clean = skills.map(s => s.trim()).filter(Boolean)
  const shown: string[] = []
  let used = 0
  for (const s of clean) {
    if (shown.length >= max || (shown.length > 0 && used + s.length > budget)) break
    shown.push(s)
    used += s.length
  }
  return { shown, more: clean.length - shown.length }
}
