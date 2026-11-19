import 'server-only'
import { Query } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import type { CvSearchDocument } from './cv-search'
import { statsFilter } from './cv-stats'
import { PROFILES_PER_PAGE, selectionFilter, type StatSelection } from './cv-stats-selection'
import { MeiliError, isSearchConfigured, searchCvPage } from './meili'

// Profils derrière un nombre de « CV Thèque · Statistiques » (recruteurs, demande du 2026-11-19) : la page de CV de
// l'index qui répondent au filtre du périmètre et de la sélection, puis nom et coordonnées lus dans Appwrite. Chaque CV
// y est revérifié avec la règle du périmètre (candidat de la base ; CV du vivier de ce recruteur) : un CV que l'index
// attribue encore à tort, ou supprimé depuis, n'est pas affiché. Le périmètre vient de la session (page), jamais de
// l'adresse.

/** Base candidats, ou vivier personnel du recruteur connecté : jamais celui d'un collègue (un vivier est personnel). */
export type ProfilesScope = { kind: 'pool' } | { kind: 'vivier'; tenantId: string; ownerId: string }

export interface StatProfile {
  source: 'pool' | 'vivier'
  /** Identifiant du candidat (base) ou du CV du vivier : fiche /recruiter/candidate-preview/<source>/<id>. */
  id: string
  name: string
  email: string
  phone: string
  roles: string[]
  seniority: string
  yearsOfExperience: number | null
  city: string
  skills: string[]
  dailyRate: number | null
  /** Dépôt du CV, secondes depuis 1970 ; null si inconnu. */
  cvDate: number | null
}

export type StatProfilesResult =
  | { state: 'ok'; total: number; page: number; totalPages: number; profiles: StatProfile[]; /** CV de la page absents, sans fichier ou refusés dans Appwrite. */ hidden: number }
  | { state: 'off' }
  | { state: 'error' }

type Hit = Pick<CvSearchDocument, 'sourceId' | 'roles' | 'seniority' | 'yearsOfExperience' | 'city' | 'skills' | 'dailyRate' | 'cvDate'>
const HIT_FIELDS = ['sourceId', 'roles', 'seniority', 'yearsOfExperience', 'city', 'skills', 'dailyRate', 'cvDate'] as const

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** Nom et coordonnées des CV `ids` que le périmètre autorise (les autres manquent dans la réponse). */
async function contactsOf(scope: ProfilesScope, ids: string[]): Promise<Map<string, { name: string; email: string; phone: string }>> {
  const contacts = new Map<string, { name: string; email: string; phone: string }>()
  if (!ids.length) return contacts
  const { databases } = createAdminClient()
  if (scope.kind === 'pool') {
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [
      // Avec un CV, comme la CV Thèque : un profil saisi sans fichier est classé et compté, mais pas listé.
      Query.equal('$id', ids), Query.equal('role', 'candidate'), Query.isNotNull('cvFileId'),
      Query.select(['$id', 'firstName', 'lastName', 'email', 'phone']), Query.limit(ids.length),
    ])
    for (const d of res.documents) {
      contacts.set(d.$id, { name: `${str(d.firstName)} ${str(d.lastName)}`.trim() || 'Candidat sans nom', email: str(d.email), phone: str(d.phone) })
    }
  } else {
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.VIVIER_CVS, [
      Query.equal('$id', ids), Query.equal('tenantId', scope.tenantId), Query.equal('recruiterId', scope.ownerId),
      Query.select(['$id', 'candidateName', 'fileName', 'candidateEmail', 'candidatePhone']), Query.limit(ids.length),
    ])
    for (const d of res.documents) {
      contacts.set(d.$id, { name: str(d.candidateName) || str(d.fileName) || 'CV importé', email: str(d.candidateEmail), phone: str(d.candidatePhone) })
    }
  }
  return contacts
}

export async function loadStatProfiles(scope: ProfilesScope, selection: StatSelection, page: number, now = new Date()): Promise<StatProfilesResult> {
  if (!isSearchConfigured()) return { state: 'off' }
  const base = statsFilter(scope)
  if (!base) return { state: 'error' }
  const extra = selectionFilter(selection, now)
  const filter = extra ? `(${base}) AND (${extra})` : base
  try {
    const res = await searchCvPage<Hit>(filter, page, PROFILES_PER_PAGE, HIT_FIELDS)
    const contacts = await contactsOf(scope, res.hits.map(h => h.sourceId))
    const profiles = res.hits.flatMap((h): StatProfile[] => {
      const c = contacts.get(h.sourceId)
      if (!c) return []
      return [{
        source: scope.kind, id: h.sourceId, ...c,
        roles: h.roles ?? [], seniority: h.seniority ?? '', yearsOfExperience: h.yearsOfExperience ?? null, city: h.city ?? '',
        skills: h.skills ?? [], dailyRate: h.dailyRate ?? null, cvDate: h.cvDate ?? null,
      }]
    })
    const hidden = res.hits.length - profiles.length
    // Index en retard sur Appwrite (CV supprimé, pas encore retiré) : réglé par la synchronisation de la nuit.
    if (hidden > 0) console.warn('[statistiques] CV de l\'index absents ou refusés dans Appwrite', scope.kind, hidden)
    return { state: 'ok', total: res.totalHits, page, totalPages: res.totalPages, profiles, hidden }
  } catch (err) {
    // Index pas encore créé (aucune synchronisation) : aucun CV classé, ce n'est pas une panne.
    if (err instanceof MeiliError && err.status === 404) return { state: 'ok', total: 0, page, totalPages: 0, profiles: [], hidden: 0 }
    console.error('[statistiques] profils illisibles', scope.kind, err instanceof Error ? err.message : err)
    return { state: 'error' }
  }
}
