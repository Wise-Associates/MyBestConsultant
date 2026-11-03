import { parseDescription, type DescriptionSection, type SectionKind } from './description-sections'
import { SOURCING_MIN_SCORE } from './sourcing-rules'

// Règles communes aux quatre notations d'un candidat pour une offre : candidature reçue (screening), base candidats
// (sourcing-core.ts), vivier de l'offre et vivier général (matching-core.ts, vivier-matching.ts). Demande du
// 2026-11-03 : un candidat noté 95/100 n'avait pas l'expérience du domaine demandé. Causes : le barème ne parlait que de
// compétences (« 85-100 = toutes compétences clés présentes »), la description de l'offre était coupée avant le profil
// recherché, et les CV du vivier n'étaient envoyés qu'avec compétences et intitulés. L'IA dit maintenant si le domaine
// exigé figure dans le parcours, et le code plafonne le score quand il n'y figure pas. Pur, testé (match-scoring.test.ts).

export type DomainFit = 'oui' | 'partiel' | 'non' | 'non requis'

/** Score maximal quand le domaine exigé est absent (sous le seuil « correspond », 65) ou seulement voisin. */
export const DOMAIN_CAP = { non: 60, partiel: 80 } as const

/** Champ demandé à l'IA dans chaque réponse. */
export const DOMAIN_FIELD = '"domaine":"oui"|"partiel"|"non"|"non requis"'

export const MATCH_RULES = `Règles de notation, dans cet ordre :
1. Expérience du domaine : le secteur, le métier ou le fonctionnel que l'offre exige (par exemple banque de détail, assurance, finance de marché, paie, supply chain, secteur public, santé). Elle doit figurer dans le parcours du candidat (employeur, client, secteur, missions) : une compétence ou un outil ne la prouve pas, ne la déduis jamais d'un mot-clé. "domaine" vaut "oui" si le parcours la montre, "partiel" si elle est voisine ou courte, "non" si elle est absente, "non requis" si l'offre n'exige aucun domaine.
2. Compétences, outils et méthodes demandés par l'offre.
3. Niveau d'expérience (années, séniorité) et, quand l'offre les exige, langues et lieu.
Barème : 85-100 seulement si le domaine exigé et les compétences clés sont présents ; 70-84 bon profil, lacunes mineures ; 55-69 lacunes notables ; 40-54 trop de manques ; 0-39 hors sujet. Domaine exigé absent : ${DOMAIN_CAP.non} au plus, quelles que soient les compétences. La raison cite le domaine quand il manque.`

const normalized = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim()

const DOMAIN_ANSWERS: Record<string, DomainFit> = {
  'oui': 'oui', 'yes': 'oui',
  'partiel': 'partiel', 'partielle': 'partiel', 'partial': 'partiel',
  'non': 'non', 'no': 'non',
  'non requis': 'non requis', 'not required': 'non requis',
}

/** Réponse de l'IA (donnée non fiable) ; null si absente ou illisible, le score n'est alors pas plafonné. */
export function parseDomainFit(value: unknown): DomainFit | null {
  return typeof value === 'string' ? DOMAIN_ANSWERS[normalized(value)] ?? null : null
}

/** Score plafonné quand le domaine exigé est absent ou seulement voisin. */
export function cappedScore(score: number, domain: DomainFit | null): number {
  if (domain === 'non') return Math.min(score, DOMAIN_CAP.non)
  if (domain === 'partiel') return Math.min(score, DOMAIN_CAP.partiel)
  return score
}

/**
 * Score de l'IA plus un bonus (points des recommandations, ou écart du mélange avec leur note) : un candidat que l'IA a
 * noté sous le seuil « correspond » y reste, le bonus ne fait que l'en rapprocher. Un bonus négatif s'applique tel quel.
 */
export function withBonus(score: number, bonus: number): number {
  const total = Math.max(0, Math.min(100, score + bonus))
  return score < SOURCING_MIN_SCORE ? Math.min(total, SOURCING_MIN_SCORE - 1) : total
}

// Profil recherché d'abord : c'est là que l'offre dit le domaine exigé, souvent après une longue liste de missions.
const SECTION_ORDER: SectionKind[] = ['profile', 'tasks', 'context', 'other', 'terms']
const TITLE_OF: Record<SectionKind, string> = { profile: 'Profil', tasks: 'Missions', context: 'Contexte', other: 'Informations', terms: 'Modalités' }

const sectionText = (s: DescriptionSection) => [
  `### ${s.title || TITLE_OF[s.kind]}`,
  ...s.blocks.map(b => (b.type === 'paragraph' ? b.text : b.items.map(item => `- ${item}`).join('\n'))),
].join('\n')

/** Description envoyée à l'IA, `max` caractères au plus : sections réordonnées (profil d'abord), sinon le texte tel quel. */
export function offerTextForAi(description: string, max: number): string {
  const sections = parseDescription(description)
  if (sections.length <= 1) return description.slice(0, max)
  const ordered = SECTION_ORDER.flatMap(kind => sections.filter(s => s.kind === kind))
  return ordered.map(sectionText).join('\n\n').slice(0, max)
}

export type Recommendation = 'top' | 'good' | 'average' | 'weak' | 'reject'

/** Recommandation du barème pour un score (85, 70, 55, 40) : celle de l'IA ne suit pas un score plafonné par le code. */
export function recommendationFor(score: number): Recommendation {
  return score >= 85 ? 'top' : score >= 70 ? 'good' : score >= 55 ? 'average' : score >= 40 ? 'weak' : 'reject'
}
