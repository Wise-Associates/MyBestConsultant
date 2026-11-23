import type { SearchableCandidate } from '@/lib/cvtheque-search'
import type { JobFamily } from '@/lib/job-families'

// Ce que la recherche de la CV Thèque lit d'un document `users` de candidat, pour les recherches enregistrées (comptes et
// alertes, ADR 0046). Mêmes champs et mêmes valeurs par défaut que la liste de la page (getRecruiterCvthequeCandidates,
// src/app/recruiter/cvtheque/actions.ts), à garder alignés : un nouveau candidat est comparé à une recherche comme la
// liste l'aurait affiché. Plus tolérant qu'elle (un profil illisible ne fait pas échouer une alerte). Pur, testé.

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const objects = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [])
const list = (v: unknown) => str(v).split(',').map(s => s.trim()).filter(Boolean)

/** Profil extrait du CV (`cvProfileJson`) ; JSON illisible : profil vide, le candidat reste trouvable par son nom et sa ville. */
function profileOf(json: unknown): Record<string, unknown> {
  if (typeof json !== 'string' || !json) return {}
  try {
    const parsed: unknown = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** `jobFamily` : famille lue dans la classification du CV (candidateJobFamilies) ; null : pas classé ou pas lue. */
export function searchableCandidateOf(doc: Record<string, unknown>, jobFamily: JobFamily | null = null): SearchableCandidate {
  const p = profileOf(doc.cvProfileJson)
  return {
    name: `${str(doc.firstName)} ${str(doc.lastName)}`.trim(),
    city: str(doc.city),
    mobilityRadiusKm: typeof doc.mobilityRadiusKm === 'number' ? doc.mobilityRadiusKm : null,
    skills: strings(p.skills),
    experienceSummary: str(p.experienceSummary),
    experiences: objects(p.experiences).map(e => ({ title: str(e.title), company: str(e.company), missions: strings(e.missions) })),
    education: objects(p.education).map(e => ({ degree: str(e.degree), school: str(e.school) })),
    languages: objects(p.languages).map(l => ({ name: str(l.name) })),
    yearsOfExperience: typeof p.yearsOfExperience === 'number' ? p.yearsOfExperience : null,
    openToWork: typeof doc.openToWork === 'boolean' ? doc.openToWork : true,
    desiredSector: list(doc.desiredSector),
    desiredRoles: list(doc.desiredRoles),
    createdAt: str(doc.$createdAt),
    jobFamily,
  }
}

/** Champs `users` à lire pour la recherche (Query.select). */
export const SEARCHABLE_FIELDS = [
  '$id', '$createdAt', 'role', 'firstName', 'lastName', 'city', 'mobilityRadiusKm', 'cvFileId', 'cvProfileJson', 'openToWork', 'desiredSector', 'desiredRoles',
] as const
