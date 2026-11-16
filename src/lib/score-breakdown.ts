import type { RecruiterWeights } from './scoring-weights'
import {
  DOMAIN_CAP, LIST_MISSING_BELOW, MAX_REQUIRED_SKILLS, MAX_REQUIREMENTS, MISSING_CAP, NEUTRAL, POINTS, ROLE_CAP, SCALES, fitLevel,
  labelOf, listLevel, meanPoints, scaleKeys, scoreOf, worstJudgement,
  type ActiveScale, type CriterionKey, type CriterionResult, type Fit, type Judgement, type ScaleName,
} from './match-scoring'

// Détail d'un score du Matching IA, en pourcentage (demande du 2026-11-05 : rendre le score transparent). Il est relu
// dans le résumé des jugements qui commence la raison enregistrée de chaque score (judgementSummary, match-scoring.ts) :
// ce résumé détermine entièrement le score — part de chaque critère, ses points, le plafond. Trois barèmes (ADR 0036) :
// matching, score final, et celui d'avant le 2026-11-15 pour les scores encore enregistrés avec lui, reconnus aux noms
// de leurs critères. Un score enregistré avant la notation par jugements (ADR 0028) n'a pas de résumé : pas de détail.
// Pur, testé (score-breakdown.test.ts : le détail redonne exactement judgedScore).

export type { CriterionKey }

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
  scale: ScaleName
  parts: CriterionPart[]
  /** Somme des points, arrondie, avant plafond. */
  total: number
  /** Plafond appliqué quand il abaisse le total (critère rouge qui manque ou seulement voisin), sinon null. */
  cap: { value: number; reason: string } | null
  /** Score des jugements : le total plafonné (judgedScore). */
  score: number
  /** Suite de la raison, après le résumé : la phrase de l'IA, les recommandations. */
  rest: string
}

/** Ce qui fait jouer le plafond d'un critère rouge, pour le recruteur. */
const CAP_REASONS: Partial<Record<CriterionKey, { non: string; partiel?: string }>> = {
  poste: { non: 'un métier du titre de l’offre n’a pas été exercé', partiel: 'métier du titre seulement voisin' },
  competences: { non: 'moins d’un tiers des technologies et outils demandés' },
  client: { non: 'aucune expérience de l’environnement du client' },
  localisation: { non: 'lieu éloigné, sans mobilité indiquée' },
  niveau: { non: 'séniorité demandée non atteinte' },
  formation: { non: 'diplôme ou certification exigés absents' },
  domaine: { non: 'secteur exigé absent du parcours', partiel: 'secteur exigé seulement voisin' },
  langue: { non: 'langue exigée absente' },
}

/**
 * Ce que mesure chaque critère, pour le recruteur (demande du 2026-11-05 : expliquer « poste », « exigences »…).
 * Reprend les consignes données à l'IA (RULES, match-scoring.ts) : à modifier avec elles.
 */
export const CRITERION_HELP: Record<CriterionKey, string> = {
  poste: 'Le candidat a-t-il exercé le métier du titre de l’offre ? Comparé aux intitulés des postes de son CV, puis '
    + 'vérifié par une seconde question à l’IA. Oui : le même métier ; partiel : un métier voisin de la même famille, ou '
    + 'exercé peu de temps ; non : un autre métier, même exercé dans la même équipe ou avec les mêmes outils. Titre à '
    + 'plusieurs métiers : chacun est jugé, la part est leur moyenne.',
  exigences: `Le contexte et la description de l’offre : ses exigences (profil recherché, puis missions ; ${MAX_REQUIREMENTS} au `
    + 'plus, les mêmes pour tous les candidats), comparées une à une aux expériences du CV. « 4 sur 6, 1 partielle » : 4 '
    + 'remplies et 1 en partie, qui compte pour moitié. Sans liste dans l’offre : un jugement d’ensemble.',
  projet: 'Le type de projet décrit par l’offre (création ou refonte, migration, intégration d’un progiciel, maintenance, '
    + 'exploitation, transformation…) : le candidat a-t-il mené des projets de ce type ? « non précisé » : l’offre ne le '
    + 'décrit pas, la part est complète.',
  competences: `Les technologies, outils et expertises demandés par l’offre (${MAX_REQUIRED_SKILLS} au plus). Oui : pratiqué dans `
    + 'une expérience du CV ; partiel : seulement listé dans le CV, ou voisin ; non : absent.',
  client: 'L’environnement du client de l’offre (pour un AO, le client et les clients cités par l’appel d’offres). Oui : '
    + 'le candidat a travaillé pour ce client ou son groupe ; partiel : pour un client comparable du même secteur ; non : '
    + 'jamais dans ce type d’environnement. « non précisé » : aucun client connu, la part est complète.',
  localisation: 'Le lieu de l’offre (télétravail compris) comparé à celui du candidat (ville du CV, mobilité indiquée). '
    + '« non précisé » : l’offre ou le CV ne donne pas de lieu, la part est complète.',
  niveau: 'La séniorité demandée (années, niveau, responsabilités), comptée sur les expériences du même métier et non sur '
    + 'toute la carrière. « non précisé » : l’offre n’en demande pas, la part est complète.',
  formation: 'Les diplômes et certifications que l’offre exige. « non requis » : l’offre n’en exige aucun, la part est '
    + 'complète. Seulement pour le matching : le score final juge l’expérience, jamais les diplômes.',
  domaine: 'L’expérience du secteur ou du métier fonctionnel exigé (banque, assurance, santé, secteur public…), prouvée '
    + 'par le parcours : employeurs, clients, missions. Une compétence ou un outil ne la prouve pas. « non requis » : '
    + 'l’offre n’en exige aucun, la part est complète.',
  langue: 'Les langues que l’offre exige et leur niveau. « non requis » : l’offre n’en exige aucune, la part est complète.',
  tjm: 'Le TJM ou la rémunération de l’offre comparé à celui que le CV indique. « non précisé » : l’un des deux ne le dit '
    + 'pas, la part est complète.',
}

/**
 * Critères d'un barème, dans son ordre, avec leur nom, leur poids (ceux du recruteur s'il en a, `weights`), leur plafond
 * éventuel et ce qu'ils mesurent.
 */
export const criteriaOf = (scale: ActiveScale, weights?: RecruiterWeights) => scaleKeys(scale).map(key => ({
  key, label: labelOf(scale, key), weight: (weights?.[scale] ?? SCALES[scale].weights)[key] ?? 0, capped: key in SCALES[scale].caps,
  help: CRITERION_HELP[key],
}))

/** Plafonds, en clair (guide « Comment le score est calculé »). */
export const CAP_RULES = {
  role: ROLE_CAP, domain: DOMAIN_CAP, missing: MISSING_CAP, listMissingPercent: Math.round(LIST_MISSING_BELOW * 100),
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Résumé de chaque barème : « Poste : (…) · Contexte : (…) · … », suivi de la raison (« — … ») ou de rien. */
const SUMMARIES = (Object.keys(SCALES) as ScaleName[]).map(scale => ({
  scale,
  pattern: new RegExp(`^${scaleKeys(scale).map(key => `${escapeRegExp(labelOf(scale, key))} : (.+?)`).join(' · ')}(?= — |$)`),
}))

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

/** Critère relu dans son résumé, comme criterionResults (match-scoring.ts) le calcule ; null si illisible. */
function resultOf(key: CriterionKey, detail: string): CriterionResult | null {
  if (key === 'poste') {
    const fits = roleFits(detail)
    return fits && { key, ratio: meanPoints(fits), level: worstJudgement(fits), detail }
  }
  if (key === 'exigences' || key === 'competences') {
    const ratio = listRatio(detail)
    return ratio === null ? null : { key, ratio, level: listLevel(ratio), detail }
  }
  if (!isJudgement(detail) && detail !== NEUTRAL[key]) return null
  const fit = detail as Fit
  return { key, ratio: POINTS[fit], level: fitLevel(fit), detail }
}

/**
 * Détail du score résumé au début de `reason` ; null si la raison n'a pas de résumé lisible (score d'avant, texte coupé).
 * `custom` : poids d'un recruteur (scoring-weights.ts), pour les barèmes actuels ; le barème d'avant garde les siens.
 */
export function scoreBreakdown(reason: string, custom?: RecruiterWeights): ScoreBreakdown | null {
  for (const { scale, pattern } of SUMMARIES) {
    const m = reason.match(pattern)
    if (!m) continue
    const keys = scaleKeys(scale)
    const results = keys.map((key, i) => resultOf(key, m[i + 1]))
    if (results.some(r => r === null)) return null
    const read = results as CriterionResult[]
    const weights = (scale !== 'legacy' && custom?.[scale]) || SCALES[scale].weights
    const { total, cap, score } = scoreOf(scale, read, weights)
    const parts = read.map(r => {
      const max = weights[r.key] ?? 0
      return { key: r.key, label: labelOf(scale, r.key), percent: Math.round(r.ratio * 100), points: max * r.ratio, max, detail: r.detail }
    })
    const capReason = cap && CAP_REASONS[cap.key]?.[cap.level === 'non' ? 'non' : 'partiel']
    return {
      scale, parts, total, score,
      cap: cap ? { value: cap.value, reason: capReason ?? labelOf(scale, cap.key) } : null,
      rest: reason.slice(m[0].length).replace(/^ — /, ''),
    }
  }
  return null
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
