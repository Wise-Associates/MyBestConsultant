import { JOB_FAMILIES, SECTORS } from '@/lib/cv-classification'
import { EDUCATION_LABELS, FRESHNESS, RISING_RECENT_MONTHS, SENIORITY_LABELS, monthLabel, recentCut } from './cv-stats'

// Profils derrière un nombre de « CV Thèque · Statistiques » (demande du 2026-11-19) : chaque ligne, colonne ou chiffre
// clé de la page ouvre la liste des CV qu'il compte. La sélection voyage dans l'adresse de la liste (?champ=&valeur=),
// elle est donc relue ici comme une saisie : champ connu, valeur bornée, et toujours écrite entre guillemets échappés
// dans le filtre Meilisearch (une valeur ne peut pas élargir le filtre du périmètre ; vérifié sur Meilisearch 1.56).
// Les filtres reprennent exactement les comptes de cv-stats.ts (mêmes champs, mêmes tranches de fraîcheur).

/** Champs comptés par la page, nom de l'adresse → attribut de l'index et nom affiché. */
export const VALUE_FIELDS = {
  famille: { attr: 'jobFamily', name: 'Famille de métiers' },
  metier: { attr: 'roles', name: 'Métier' },
  competence: { attr: 'skills', name: 'Compétence' },
  seniorite: { attr: 'seniority', name: 'Séniorité' },
  secteur: { attr: 'sectors', name: 'Secteur' },
  langue: { attr: 'languages', name: 'Langue' },
  ville: { attr: 'city', name: 'Ville' },
  etudes: { attr: 'educationLevel', name: 'Niveau d’études' },
} as const
type ValueField = keyof typeof VALUE_FIELDS

export type FreshnessKey = (typeof FRESHNESS)[number]['key'] | 'inconnue'

export type StatSelection =
  | { field: ValueField; value: string }
  /** Mois de dépôt, « 2026-11 ». */
  | { field: 'mois'; value: string }
  | { field: 'fraicheur'; value: FreshnessKey }
  /** Compétence en hausse : les CV récents qui la citent, ceux que sa part « des CV récents » compte. */
  | { field: 'recente'; value: string }
  /** Chiffres clés : tous les CV classés, seniors et experts, déposés depuis un an. */
  | { field: 'tous' } | { field: 'seniors' } | { field: 'annee' }

/** Les valeurs viennent des comptes de l'index (métiers de 80 caractères au plus) : au-delà, ce n'est pas une ligne de la page. */
const MAX_VALUE = 120
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const FRESHNESS_KEYS: readonly string[] = [...FRESHNESS.map(b => b.key), 'inconnue']

/** Sélection lue dans l'adresse ; null si elle n'est pas une ligne possible de la page. */
export function parseSelection(params: { champ?: unknown; valeur?: unknown }): StatSelection | null {
  const { champ, valeur } = params
  if (champ === 'tous' || champ === 'seniors' || champ === 'annee') return { field: champ }
  if (typeof champ !== 'string' || typeof valeur !== 'string') return null
  if (champ === 'mois') return MONTH.test(valeur) ? { field: 'mois', value: valeur } : null
  if (champ === 'fraicheur') return FRESHNESS_KEYS.includes(valeur) ? { field: 'fraicheur', value: valeur as FreshnessKey } : null
  if (champ !== 'recente' && !Object.hasOwn(VALUE_FIELDS, champ)) return null
  const value = valeur.trim()
  // Caractères de contrôle refusés : aucune valeur de l'index n'en contient.
  if (!value || value.length > MAX_VALUE || [...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null
  return champ === 'recente' ? { field: 'recente', value } : { field: champ as ValueField, value }
}

/** Paramètres d'adresse de la sélection (inverse de parseSelection). */
export function selectionParams(selection: StatSelection): Record<string, string> {
  return 'value' in selection ? { champ: selection.field, valeur: selection.value } : { champ: selection.field }
}

/** Liste des profils d'une sélection, page des recruteurs : base candidats, ou vivier du recruteur connecté. */
export function statProfilesHref(perimetre: 'pool' | 'vivier', selection: StatSelection, page = 1): string {
  const params = new URLSearchParams({
    ...(perimetre === 'vivier' ? { perimetre: 'vivier' } : {}),
    ...selectionParams(selection),
    ...(page > 1 ? { page: String(page) } : {}),
  })
  return `/recruiter/cvtheque/statistiques/profils?${params}`
}

/** Chaîne Meilisearch : entre guillemets, `\` et `"` échappés. */
export function meiliString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Début du mois `back` mois avant celui de `now` (UTC, secondes depuis 1970), comme `cvMonth` dans l'index. */
const monthStart = (now: Date, back: number) => Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1) / 1000)

/**
 * Dates de dépôt d'une tranche de fraîcheur : `from` compris, `to` exclu (secondes). Même découpage que la page, qui
 * classe chaque mois de dépôt par son âge en mois (un mois à venir compte comme récent : pas de borne haute à la
 * première tranche). null pour « Date inconnue ».
 */
export function freshnessRange(key: FreshnessKey, now: Date): { from?: number; to?: number } | null {
  const i = FRESHNESS.findIndex(b => b.key === key)
  if (i < 0) return null
  const below = FRESHNESS[i].below
  const above = i === 0 ? 0 : FRESHNESS[i - 1].below
  return {
    ...(below === Infinity ? {} : { from: monthStart(now, below - 1) }),
    ...(above === 0 ? {} : { to: monthStart(now, above - 1) }),
  }
}

/** Filtre ajouté à celui du périmètre ; '' pour tous les CV classés. `now` injecté (tranches de dates). */
export function selectionFilter(selection: StatSelection, now: Date): string {
  switch (selection.field) {
    case 'tous': return ''
    case 'seniors': return 'seniority IN ["senior", "expert"]'
    // « Déposés depuis un an » : mois de dépôt de moins de 12 mois, mois en cours compris.
    case 'annee': return `cvDate >= ${monthStart(now, 11)}`
    case 'mois': return `cvMonth = ${meiliString(selection.value)}`
    // Même coupure, au jour près, que le compte des CV récents de « Compétences en hausse » (sinceFilter, cv-stats.ts).
    case 'recente': return `skills = ${meiliString(selection.value)} AND cvDate >= ${recentCut(RISING_RECENT_MONTHS, now)}`
    case 'fraicheur': {
      const range = freshnessRange(selection.value, now)
      if (!range) return 'cvDate IS NULL OR cvDate NOT EXISTS'
      return [range.from !== undefined && `cvDate >= ${range.from}`, range.to !== undefined && `cvDate < ${range.to}`].filter(Boolean).join(' AND ')
    }
    default: return `${VALUE_FIELDS[selection.field].attr} = ${meiliString(selection.value)}`
  }
}

/** Titre de la liste : « Compétence : Python », « Séniorité : Senior (8 à 14 ans) »… */
export function selectionTitle(selection: StatSelection): string {
  switch (selection.field) {
    case 'tous': return 'Tous les CV classés'
    case 'seniors': return 'Seniors et experts'
    case 'annee': return 'CV déposés depuis un an'
    case 'mois': {
      const [y, m] = selection.value.split('-').map(Number)
      return `CV déposés en ${monthLabel.format(new Date(Date.UTC(y, m - 1, 1)))}`
    }
    case 'fraicheur': return `Fraîcheur : ${FRESHNESS.find(b => b.key === selection.value)?.label ?? 'Date inconnue'}`
    case 'recente': return `Compétence en hausse : ${selection.value}, CV de moins de ${RISING_RECENT_MONTHS} mois`
    case 'famille': return `${VALUE_FIELDS.famille.name} : ${JOB_FAMILIES[selection.value as keyof typeof JOB_FAMILIES] ?? selection.value}`
    case 'secteur': return `${VALUE_FIELDS.secteur.name} : ${SECTORS[selection.value as keyof typeof SECTORS] ?? selection.value}`
    case 'seniorite': return `${VALUE_FIELDS.seniorite.name} : ${SENIORITY_LABELS[selection.value] ?? selection.value}`
    case 'etudes': return `${VALUE_FIELDS.etudes.name} : ${EDUCATION_LABELS[selection.value] ?? selection.value}`
    default: return `${VALUE_FIELDS[selection.field].name} : ${selection.value}`
  }
}

/**
 * Pages de profils par jour (UTC) : par organisation (100 pages, 5 000 profils), et pour toute la plateforme. La liste
 * donne nom, e-mail et téléphone de la base candidats et l'inscription d'un recruteur est libre : sans plafond, un
 * compte pourrait en exporter toute la base page après page (la CV Thèque n'en montre que les 500 plus récents).
 */
export const STATS_PROFILES_DAILY_LIMITS = { perOrganisation: 100, allOrganisations: 2000 } as const

export const STATS_PROFILES_REFUSAL = {
  unverified: 'Vérifiez votre adresse e-mail (lien reçu à l’inscription) pour voir la liste des profils.',
  organisation: (limit: number) => `Limite de ${limit} pages de profils par jour atteinte pour votre organisation : réessayez demain.`,
  platform: 'Trop de pages de profils consultées aujourd’hui sur la plateforme : réessayez demain.',
} as const

/** Profils listés par page, et pages au plus : Meilisearch ne compte ni ne décale au-delà de 1 000 résultats (réglage par défaut). */
export const PROFILES_PER_PAGE = 50
export const MAX_LISTED = 1000
export const MAX_PAGE = MAX_LISTED / PROFILES_PER_PAGE

/** Numéro de page lu dans l'adresse : 1 par défaut ou s'il n'est pas un entier de 1 à MAX_PAGE. */
export function pageFromParam(value: unknown): number {
  const n = typeof value === 'string' && /^\d{1,3}$/.test(value) ? Number(value) : 1
  return n >= 1 && n <= MAX_PAGE ? n : 1
}
