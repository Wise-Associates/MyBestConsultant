import {
  DOMAIN_CAP, MAX_REQUIRED_SKILLS, MAX_REQUIREMENTS, POINTS, ROLE_CAP, SCORE_WEIGHTS, type DomainFit, type Judgement, type LevelFit,
} from './match-scoring'

// Détail d'un score du Matching IA, en pourcentage (demande du 2026-11-05 : rendre le score transparent). Il est relu
// dans le résumé des jugements qui commence la raison enregistrée de chaque score, pour les quatre notations
// (judgementSummary, match-scoring.ts) : ce résumé détermine entièrement le score — part de chaque critère, ses points,
// le plafond. Un score enregistré avant la notation par jugements (ADR 0028) n'a pas de résumé : pas de détail.
// Pur, testé (score-breakdown.test.ts : le détail redonne exactement judgedScore).

export type CriterionKey = keyof typeof SCORE_WEIGHTS

export interface CriterionPart {
  key: CriterionKey
  label: string
  /** Part obtenue, de 0 à 100. */
  percent: number
  /** Points obtenus sur `max` (poids du critère), non arrondis. */
  points: number
  max: number
  /** Jugements du critère, tels que résumés (« Scrum Master oui, Développeur Full Stack non », « 4 sur 6, 1 partielle »). */
  detail: string
}

export interface ScoreBreakdown {
  parts: CriterionPart[]
  /** Somme des points, arrondie, avant plafond. */
  total: number
  /** Plafond appliqué quand il abaisse le total (poste non exercé ou voisin, domaine absent ou voisin), sinon null. */
  cap: { value: number; reason: string } | null
  /** Score des jugements : le total plafonné (judgedScore). */
  score: number
  /** Suite de la raison, après le résumé : la phrase de l'IA, les recommandations. */
  rest: string
}

const LABELS: Record<CriterionKey, string> = {
  poste: 'Poste', exigences: 'Exigences', competences: 'Compétences', domaine: 'Domaine', niveau: 'Niveau',
}

/**
 * Ce que mesure chaque critère, pour le recruteur (demande du 2026-11-05 : expliquer « poste », « exigences »…).
 * Reprend les consignes données à l'IA (MATCH_RULES, match-scoring.ts) : à modifier avec elles.
 */
export const CRITERION_HELP: Record<CriterionKey, string> = {
  poste: 'Le candidat a-t-il exercé le métier du titre de l’offre ? Comparé aux intitulés des postes de son CV, puis '
    + 'vérifié par une seconde question à l’IA. Oui : le même métier ; partiel : un métier voisin de la même famille, ou '
    + 'exercé peu de temps ; non : un autre métier, même exercé dans la même équipe ou avec les mêmes outils. Titre à '
    + 'plusieurs métiers : chacun est jugé, la part est leur moyenne.',
  exigences: `Les exigences de la description de l’offre (profil recherché, puis missions ; ${MAX_REQUIREMENTS} au plus, les `
    + 'mêmes pour tous les candidats), comparées une à une aux expériences du CV. « 4 sur 6, 1 partielle » : 4 remplies '
    + 'et 1 en partie, qui compte pour moitié. Sans liste dans l’offre : un jugement d’ensemble.',
  competences: `Les compétences demandées par l’offre (${MAX_REQUIRED_SKILLS} au plus). Oui : pratiquée dans une expérience `
    + 'du CV ; partiel : seulement listée dans le CV, ou voisine ; non : absente.',
  domaine: 'L’expérience du secteur ou du métier fonctionnel exigé (banque, assurance, santé, secteur public…), prouvée '
    + 'par le parcours : employeurs, clients, missions. Une compétence ou un outil ne la prouve pas. « non requis » : '
    + 'l’offre n’en exige aucun, la part est complète.',
  niveau: 'Le niveau d’expérience demandé (années, séniorité, responsabilités), compté sur les expériences du même '
    + 'métier et non sur toute la carrière. « non précisé » : l’offre n’en demande pas, la part est complète.',
}

/** Critères dans l'ordre du barème, avec leur nom, leur poids et ce qu'ils mesurent. */
export const CRITERIA = (Object.keys(SCORE_WEIGHTS) as CriterionKey[])
  .map(key => ({ key, label: LABELS[key], weight: SCORE_WEIGHTS[key], help: CRITERION_HELP[key] }))

const SUMMARY = /^Poste : (.+?) · Exigences : (.+?) · Compétences : (.+?) · Domaine : (oui|partiel|non requis|non) · Niveau : (oui|partiel|non précisé|non)(?= — |$)/
const JUDGEMENTS: Judgement[] = ['oui', 'partiel', 'non']
const isJudgement = (v: string): v is Judgement => (JUDGEMENTS as string[]).includes(v)

/** Métiers du titre (« Scrum Master oui, Développeur Full Stack non », ou « oui » sans intitulé) : leurs jugements. */
function roleFits(text: string): Judgement[] | null {
  if (isJudgement(text)) return [text]
  const fits: Judgement[] = []
  let consumed = 0
  for (const m of text.matchAll(/(.+?) (oui|partiel|non)(?:, |$)/g)) {
    if (m.index !== consumed) return null
    fits.push(m[2] as Judgement)
    consumed += m[0].length
  }
  return consumed === text.length && fits.length > 0 ? fits : null
}

/** Part d'une liste résumée (« 4 sur 6, 1 partielle ») ou d'un jugement d'ensemble (« partiel »). */
function listRatio(text: string): number | null {
  if (isJudgement(text)) return POINTS[text]
  const m = text.match(/^(\d+) sur (\d+)(?:, (\d+) partielles?)?$/)
  if (!m) return null
  const [yes, count, partial] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)]
  if (count === 0 || yes + partial > count) return null
  return (yes * POINTS.oui + partial * POINTS.partiel) / count
}

/** Détail du score résumé au début de `reason` ; null si la raison n'a pas de résumé (score d'avant, texte coupé). */
export function scoreBreakdown(reason: string): ScoreBreakdown | null {
  const m = reason.match(SUMMARY)
  if (!m) return null
  const fits = roleFits(m[1])
  const requirements = listRatio(m[2])
  const skills = listRatio(m[3])
  if (!fits || requirements === null || skills === null) return null
  const domain = m[4] as DomainFit
  const level = m[5] as LevelFit

  // Mêmes opérations que judgedScore : la moyenne des métiers, puis chaque critère pondéré, dans le même ordre.
  const ratios: Record<CriterionKey, number> = {
    poste: fits.reduce((sum, f) => sum + POINTS[f], 0) / fits.length,
    exigences: requirements,
    competences: skills,
    domaine: POINTS[domain],
    niveau: POINTS[level],
  }
  const details: Record<CriterionKey, string> = { poste: m[1], exigences: m[2], competences: m[3], domaine: m[4], niveau: m[5] }
  const keys = Object.keys(SCORE_WEIGHTS) as CriterionKey[]
  const parts = keys.map(key => ({
    key, label: LABELS[key], percent: Math.round(ratios[key] * 100),
    points: SCORE_WEIGHTS[key] * ratios[key], max: SCORE_WEIGHTS[key], detail: details[key],
  }))
  const total = Math.round(parts.reduce((sum, p) => sum + p.points, 0))

  // Plafonds de capFor, le plus bas l'emporte.
  const caps: { value: number; reason: string }[] = []
  if (fits.includes('non')) caps.push({ value: ROLE_CAP.non, reason: 'un métier du titre de l’offre n’a pas été exercé' })
  else if (fits.includes('partiel')) caps.push({ value: ROLE_CAP.partiel, reason: 'métier du titre seulement voisin' })
  if (domain === 'non') caps.push({ value: DOMAIN_CAP.non, reason: 'domaine exigé absent du parcours' })
  else if (domain === 'partiel') caps.push({ value: DOMAIN_CAP.partiel, reason: 'domaine exigé seulement voisin' })
  const lowest = caps.sort((a, b) => a.value - b.value)[0]
  const cap = lowest && lowest.value < total ? lowest : null

  return { parts, total, cap, score: cap ? cap.value : total, rest: reason.slice(m[0].length).replace(/^ — /, '') }
}

/**
 * Écart entre le score affiché et celui des jugements. Base candidats et candidatures : les recommandations reçues
 * (bonus, ou mélange avec leur note). Ailleurs, ou sans recommandation pour la base : score enregistré par une version
 * précédente de la notation, que le détail n'explique pas entièrement.
 */
export function scoreAdjustment(
  source: 'application' | 'pool' | 'vivier', shown: number, computed: number, hasRecommendation: boolean,
): { label: string; value: number } | null {
  const value = shown - computed
  if (value === 0) return null
  if (source === 'application' || (source === 'pool' && hasRecommendation)) return { label: 'Recommandations', value }
  return { label: 'Écart avec une version précédente de la notation', value }
}
