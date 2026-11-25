import type { CvClassification } from '@/lib/cv-classification'
import { isJobFamily } from '@/lib/job-families'

// Index de recherche des CV (Meilisearch, ADR 0044 phase 2) : documents, réglages, requêtes et pré-score. Règles pures,
// testées dans cv-search.test.ts ; les appels : meili.ts. Un document ne contient que la classification (aucun nom ni
// coordonnée) et ce qui sert à filtrer (source, organisation, propriétaire, rôle, désinscription).

/** Document d'un CV dans l'index : identifiant = celui de sa classification (cv_classifications). */
export interface CvSearchDocument {
  id: string
  kind: 'candidate' | 'vivier'
  sourceId: string
  /** Organisation qui voit le CV (vivier) ; vide pour la base candidats et les profils de chasseurs. */
  tenantId: string
  ownerId: string
  /** candidate | hunter_profile (base candidats) ; vivier pour un CV du vivier. */
  role: string
  /** Candidat désinscrit des approches : jamais proposé (revérifié dans Appwrite avant toute notation). */
  optedOut: boolean
  roles: string[]
  jobFamily: string
  seniority: string
  yearsOfExperience: number | null
  skills: string[]
  sectors: string[]
  clients: string[]
  languages: string[]
  city: string
  country: string
  dailyRate: number | null
  educationLevel: string
  certifications: string[]
  summary: string
  /** Dépôt du CV (secondes depuis 1970) : fichier du CV, import au vivier, ou dernière modification d'un profil sans fichier. */
  cvDate: number | null
  /** Mois du dépôt (« 2026-11 », UTC) : fraîcheur et tendances des statistiques ; '' si inconnu. */
  cvMonth: string
}

export function cvSearchDocument(input: {
  id: string; kind: 'candidate' | 'vivier'; sourceId: string; tenantId: string; ownerId: string; role: string; optedOut: boolean
  classification: CvClassification
  /** Date ISO du dépôt du CV ; null si inconnue. */
  cvDate?: string | null
}): CvSearchDocument {
  const c = input.classification
  const at = input.cvDate ? Date.parse(input.cvDate) : NaN
  return {
    id: input.id, kind: input.kind, sourceId: input.sourceId, tenantId: input.tenantId, ownerId: input.ownerId,
    role: input.role, optedOut: input.optedOut,
    roles: c.roles, jobFamily: c.jobFamily, seniority: c.seniority ?? 'non_precise', yearsOfExperience: c.yearsOfExperience,
    skills: c.skills, sectors: c.sectors, clients: c.clients, languages: c.languages.map(l => l.name),
    city: c.city, country: c.country, dailyRate: c.dailyRate, educationLevel: c.educationLevel,
    certifications: c.certifications, summary: c.summary,
    cvDate: Number.isFinite(at) ? Math.floor(at / 1000) : null,
    cvMonth: Number.isFinite(at) ? new Date(at).toISOString().slice(0, 7) : '',
  }
}

/** Réglages de l'index : champs cherchés par ordre d'importance, champs filtrables et comptables (statistiques). */
export const CV_INDEX_SETTINGS = {
  searchableAttributes: ['roles', 'skills', 'certifications', 'summary', 'clients'],
  // Filtrables = comptables : métiers et compétences pour les statistiques (phase 3), le reste pour les filtres.
  filterableAttributes: ['kind', 'tenantId', 'ownerId', 'role', 'optedOut', 'sourceId', 'jobFamily', 'roles', 'skills', 'seniority', 'sectors', 'languages', 'city', 'educationLevel', 'yearsOfExperience', 'dailyRate', 'cvDate', 'cvMonth'],
  sortableAttributes: ['yearsOfExperience', 'dailyRate', 'cvDate'],
  // Comptes triés par nombre : une liste coupée garde les valeurs les plus fréquentes (par défaut : ordre alphabétique).
  faceting: { maxValuesPerFacet: 100, sortFacetValuesBy: { '*': 'count' } },
  // Sigles et formes courantes des métiers et outils du conseil ; complétés selon les recherches vues en production.
  synonyms: {
    po: ['product owner'], 'product owner': ['po'],
    pmo: ['project management officer'],
    sm: ['scrum master'], 'scrum master': ['sm'],
    moa: ['maîtrise d\'ouvrage', 'amoa'], amoa: ['moa'],
    js: ['javascript'], javascript: ['js'], ts: ['typescript'], typescript: ['ts'],
    devops: ['dev ops'], ba: ['business analyst'], 'business analyst': ['ba'],
  },
  localizedAttributes: [{ attributePatterns: ['*'], locales: ['fra'] }],
} as const

const ID = /^[\w.-]{1,36}$/

/** Filtre de la base candidats : candidats (pas les profils de chasseurs), non désinscrits, hors `exclude`. */
export function poolFilter(exclude: Iterable<string>): string {
  // Identifiants Appwrite seulement : rien d'autre n'entre dans le filtre (pas d'injection de syntaxe).
  const ids = [...exclude].filter(id => ID.test(id))
  const base = 'kind = "candidate" AND role = "candidate" AND optedOut = false'
  return ids.length ? `${base} AND sourceId NOT IN [${ids.map(id => `"${id}"`).join(', ')}]` : base
}

/**
 * Offre telle que le préfiltre la lit. `classification` : famille de métier, secteurs et métiers de l'offre tirés par
 * l'IA au moment du matching (job-classify.ts, ADR 0061) ; absente (IA indisponible), le préfiltre fait comme avant.
 */
export interface OfferForSearch {
  title: string; skills: string[]; location?: string
  classification?: { jobFamily: string; sectors: string[]; roles: string[] }
}

/**
 * Requêtes d'une offre, réunies ensuite : son titre, les métiers de son classement (le titre d'un AO en est souvent
 * loin : « Lot 2. Expert… »), une par compétence demandée (12 au plus), et le titre parmi les CV de la même famille de
 * métier (ADR 0061).
 */
export function offerSearchQueries(offer: OfferForSearch, filter: string, indexUid: string): { indexUid: string; q: string; filter: string; limit: number; attributesToRetrieve: string[]; matchingStrategy: 'last' }[] {
  const attributesToRetrieve = ['id', 'sourceId', 'roles', 'skills', 'city', 'jobFamily', 'seniority', 'sectors']
  // Termes distincts (sans tenir compte de la casse) : le titre, les métiers, puis 12 compétences au plus.
  const seen = new Set<string>()
  const distinct = (values: string[]) => values.map(s => s.trim()).filter(s => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
  const title = cleanTitle(offer.title)
  const [head, ...roles] = distinct([title, ...(offer.classification?.roles ?? [])])
  const skills = distinct(offer.skills).slice(0, 12)
  const query = (q: string, limit: number, f = filter) => ({ indexUid, q, filter: f, limit, attributesToRetrieve, matchingStrategy: 'last' as const })
  const queries = [...(head ? [query(head, 100)] : []), ...roles.map(r => query(r, 50)), ...skills.map(s => query(s, 50))]
  // Famille de la liste fermée seulement : rien d'autre n'entre dans le filtre (pas d'injection de syntaxe).
  const family = offer.classification?.jobFamily
  if (family && isJobFamily(family) && family !== 'autre' && head) queries.push(query(head, 100, `${filter} AND jobFamily = "${family}"`))
  return queries
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
// Mots vides des titres d'offres (« Chef de projet H/F », « Développeur (F/H) – Lyon »).
const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'au', 'aux', 'a', 'pour', 'sur', 'un', 'une', 'h', 'f', 'hf', 'fh', 'cdi', 'cdd', 'freelance', 'mission', 'senior', 'junior', 'confirme', 'expert'])
const words = (s: string) => fold(s).split(/[^a-z0-9+#]+/).filter(w => w.length > 1 && !STOP.has(w))
/** Titre d'offre sans genre, lieu ni contrat : « Chef de projet MOA (H/F) – Paris » → « Chef de projet MOA ». */
export const cleanTitle = (title: string) => title.replace(/\(([hf]\s*\/\s*[hf])\)|\b[hf]\s*\/\s*[hf]\b/gi, '').split(/\s[–—-]\s/)[0].trim()

/** CV trouvé par la recherche, avec ses champs classés. */
export interface SearchHit { id: string; sourceId: string; roles?: string[]; skills?: string[]; city?: string; jobFamily?: string; sectors?: string[] }

/** Une compétence de l'offre est couverte : même nom, ou l'un contient l'autre en mots entiers (« SAP » / « SAP FI »). */
export function covers(candidate: string[], wanted: string): boolean {
  const w = words(wanted).join(' ')
  if (!w) return false
  return candidate.some(c => {
    const have = words(c).join(' ')
    return have === w || ` ${have} `.includes(` ${w} `) || ` ${w} `.includes(` ${have} `)
  })
}

/** Bonus du pré-score (ADR 0061) : CV de la même famille de métier que l'offre, CV d'un secteur du client de l'offre. */
export const CLASSIFICATION_BONUS = { family: 0.1, sector: 0.05 } as const

/**
 * Pré-score d'un CV pour une offre, calculé par le code sur les champs classés, pour choisir les CV notés par l'IA :
 * métier (titre de l'offre, ou l'un des métiers de son classement, retrouvé dans les métiers exercés) 45 %, compétences
 * demandées couvertes 45 %, même ville 10 % ; mêmes poids que les deux critères forts du barème « matching » (poste,
 * techno). Offre classée (ADR 0061) : plus CLASSIFICATION_BONUS, jusqu'à 1,15. Jamais affiché.
 */
export function preScore(offer: OfferForSearch, hit: SearchHit): number {
  const wantedRoles = [cleanTitle(offer.title), ...(offer.classification?.roles ?? [])].map(words).filter(w => w.length > 0)
  const overlap = (wanted: string[]) => Math.max(0, ...(hit.roles ?? []).map(r => { const have = new Set(words(r)); return wanted.filter(w => have.has(w)).length / wanted.length }))
  const role = wantedRoles.length ? Math.max(...wantedRoles.map(overlap)) : 0.5
  const wanted = offer.skills.filter(s => words(s).length > 0)
  const skills = wanted.length ? wanted.filter(s => covers(hit.skills ?? [], s)).length / wanted.length : 0.5
  const city = offer.location && hit.city ? (words(offer.location)[0] === words(hit.city)[0] ? 1 : 0) : 0.5
  const c = offer.classification
  const family = c && c.jobFamily !== 'autre' && hit.jobFamily === c.jobFamily ? CLASSIFICATION_BONUS.family : 0
  const sector = c && (hit.sectors ?? []).some(s => c.sectors.includes(s)) ? CLASSIFICATION_BONUS.sector : 0
  return 0.45 * role + 0.45 * skills + 0.1 * city + family + sector
}

/** Résultats de toutes les requêtes réunis (un CV une fois), classés par pré-score : les `keep` premiers identifiants de source. */
export function rankHits(offer: OfferForSearch, hitLists: SearchHit[][], keep: number): string[] {
  const byId = new Map<string, SearchHit>()
  for (const list of hitLists) for (const hit of list) if (!byId.has(hit.sourceId)) byId.set(hit.sourceId, hit)
  return [...byId.values()]
    .map(hit => ({ id: hit.sourceId, score: preScore(offer, hit) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, keep)
    .map(h => h.id)
}
