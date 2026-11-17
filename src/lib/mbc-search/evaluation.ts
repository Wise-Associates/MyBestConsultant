import {
  SCALES, criterionResults, labelOf, offerCriteria, scaleKeys, scoreOf, type CriterionKey, type MatchJudgements, type OfferCriteria,
  type OfferToJudge, type Scale, type ScoringNotes,
} from '@/lib/match-scoring'
import type { ScaleWeights } from '@/lib/scoring-weights'
import { CRITERIA_LIMITS, SENIORITIES, requiredSkillsOf, type MbcCriteria, type MbcRevealed } from './rules'

// « Évaluer » un profil révélé de MBC Search (ADR 0037, phase 2, décision du 2026-11-16 : le barème du matching, avec
// les poids du recruteur). Le besoin du recruteur tient lieu d'offre, le profil Apollo de CV. Apollo ne donne jamais ni
// formation, ni langues, ni rémunération : ces critères sont « Non disponible », hors du score (les poids des autres
// sont ramenés à 100). Il ne liste pas non plus de compétences : une compétence qu'il ne montre pas est « non visible »,
// sans points mais sans plafonner le score — ne pas la voir ne prouve pas qu'elle manque. Règles pures, testées.

/** Critères que les données d'Apollo ne contiennent jamais. */
export const APOLLO_UNAVAILABLE: readonly CriterionKey[] = ['formation', 'langue', 'tjm']
/** Critère jugé sur ce qu'Apollo montre : un « non » y veut dire « non visible », il ne plafonne pas le score. */
const APOLLO_UNCAPPED: readonly CriterionKey[] = ['competences']

/** Poids du recruteur (barème du matching) sans les critères indisponibles, les autres ramenés à 100. */
export function apolloWeights(weights: ScaleWeights): Partial<Record<CriterionKey, number>> {
  const kept = scaleKeys('matching').filter(k => !APOLLO_UNAVAILABLE.includes(k))
  const sum = kept.reduce((s, k) => s + (weights[k] ?? 0), 0)
  // Poids tous nuls sur les critères gardés (réglage extrême d'un recruteur) : ceux du barème, pour garder un score.
  const base = sum > 0 ? weights : SCALES.matching.weights
  const total = sum > 0 ? sum : kept.reduce((s, k) => s + (SCALES.matching.weights[k] ?? 0), 0)
  return Object.fromEntries(scaleKeys('matching').map(k => [k, kept.includes(k) ? ((base[k] ?? 0) * 100) / total : 0]))
}

/** Plafonds du barème du matching, sans ceux des critères indisponibles ni des compétences (non visibles ≠ absentes). */
export const APOLLO_CAPS: Scale['caps'] = Object.fromEntries(
  Object.entries(SCALES.matching.caps).filter(([k]) => !APOLLO_UNAVAILABLE.includes(k as CriterionKey) && !APOLLO_UNCAPPED.includes(k as CriterionKey)),
)

const period = (e: MbcRevealed['experiences'][number]) => [e.start, e.current ? 'aujourd\'hui' : e.end].filter(Boolean).join(' – ')

/**
 * Profil Apollo révélé tel que l'IA le lit, comme un CV : ni nom, ni e-mail, ni lien (inutiles pour juger). Ses lignes
 * sont celles que l'IA peut citer en preuve.
 */
export function profileText(p: MbcRevealed): string {
  const lines = [
    'Profil Apollo.io (données partielles : ni compétences listées, ni formation, ni langues, ni rémunération).',
    p.headline && `Titre du profil : ${p.headline}`,
    (p.title || p.company) && `Poste actuel : ${[p.title, p.company].filter(Boolean).join(' chez ')}`,
    p.industry && `Secteur de l'employeur actuel : ${p.industry}`,
    p.seniority && `Séniorité selon Apollo : ${p.seniority}`,
    p.location && `Lieu : ${p.location}`,
    p.experiences.length > 0 && 'Expériences :',
    ...p.experiences.flatMap(e => [
      `- ${[e.title, e.company].filter(Boolean).join(' chez ')}${period(e) ? ` (${period(e)})` : ''}`,
      ...(e.description ? [`  ${e.description}`] : []),
    ]),
  ]
  return lines.filter((l): l is string => typeof l === 'string' && l !== '').join('\n')
}

/**
 * Besoin tiré d'un profil révélé pour « Profils similaires » : son poste, son titre, le secteur de son employeur, son
 * lieu et ses derniers postes — jamais son nom ni ses coordonnées. Lu par l'IA comme un brief de recruteur, pour cet
 * appel seulement : il décrit une personne, il ne va ni au navigateur ni dans l'historique (voir similarNeed).
 */
export function similarBrief(p: MbcRevealed): string {
  const recent = p.experiences.slice(0, 3).map(e => [e.title, e.company].filter(Boolean).join(' chez ')).filter(Boolean)
  return [
    'Je cherche des profils proches de cette personne (même métier, niveau et environnement comparables) :',
    (p.title || p.company) && `- Poste actuel : ${[p.title, p.company].filter(Boolean).join(' chez ')}`,
    p.headline && `- Titre du profil : ${p.headline}`,
    p.industry && `- Secteur de l'employeur : ${p.industry}`,
    p.seniority && `- Séniorité : ${p.seniority}`,
    p.location && `- Lieu : ${p.location}`,
    recent.length > 0 && `- Postes récents : ${recent.join(' ; ')}`,
  ].filter((l): l is string => typeof l === 'string' && l !== '').join('\n').slice(0, CRITERIA_LIMITS.brief)
}

/**
 * Besoin gardé d'une recherche de profils similaires (conversation, historique des recherches) : tiré des critères seuls.
 * Le parcours de la personne de départ (similarBrief) est une donnée personnelle d'un tiers, gardée 90 jours au plus avec
 * son profil révélé : il ne doit pas survivre dans l'historique, gardé sans limite (revue de sécurité du 2026-11-16).
 */
export function similarNeed(criteria: MbcCriteria): string {
  return `Profils proches d'un profil révélé : ${[...criteria.titles, ...criteria.skills].slice(0, 6).join(', ')}`.slice(0, CRITERIA_LIMITS.brief)
}

/**
 * Le besoin du recruteur comme une offre pour la notation : premier intitulé comme poste (plusieurs seraient lus comme
 * plusieurs métiers à exercer tous), les autres comme intitulés acceptés ; lieu, séniorité et secteur en précisions ;
 * compétences obligatoires (★) d'abord dans la liste jugée.
 */
export function needAsOffer(brief: string, criteria: MbcCriteria): { offer: OfferToJudge; judged: OfferCriteria } {
  const required = requiredSkillsOf(criteria)
  const skills = [...required, ...criteria.skills.filter(s => !required.includes(s))]
  const title = criteria.titles[0] ?? `Profil ${skills.slice(0, 3).join(', ')}`
  const description = [
    brief.trim(),
    criteria.titles.length > 1 && `Intitulés acceptés : ${criteria.titles.join(', ')}`,
    required.length > 0 && `Compétences indispensables : ${required.join(', ')}`,
  ].filter((l): l is string => typeof l === 'string' && l !== '').join('\n')
  const details = [
    criteria.locations.length > 0 && `Lieu : ${criteria.locations.join(', ')}`,
    criteria.seniorities.length > 0 && `Séniorité : ${criteria.seniorities.map(s => SENIORITIES[s]).join(', ')}`,
    (criteria.sectors ?? []).length > 0 && `Secteur de l'employeur : ${(criteria.sectors ?? []).join(', ')}`,
  ].filter((l): l is string => typeof l === 'string')
  return { offer: { title, description: description || title, details }, judged: offerCriteria(skills, description) }
}

/** Consigne ajoutée à celle de la notation des CV : ce qu'est un profil Apollo, et deux listes de plus. */
export const APOLLO_EVALUATION_ADDENDUM = `Le « CV » est un profil Apollo.io : intitulés, employeurs, dates, parfois une description par poste. Il ne liste ni compétences, ni formation, ni langues, ni rémunération : juge seulement sur ce qu'il montre, une compétence qu'il ne nomme pas vaut "non" (non visible), sans rien supposer.
Ajoute au même objet JSON : "questions_entretien":["…"] (3 questions au plus, pour vérifier ce que le profil ne montre pas), "prochaines_etapes":["…"] (2 au plus).`

const itemList = (value: unknown, count: number) => (Array.isArray(value)
  ? value.flatMap(v => (typeof v === 'string' && v.trim() ? [v.trim().slice(0, 300)] : [])).slice(0, count)
  : [])

/** Questions d'entretien et prochaines étapes de la réponse de l'IA (donnée non fiable), bornées ; absentes : vides. */
export function parseEvaluationExtras(raw: unknown): { questions: string[]; nextSteps: string[] } {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return { questions: itemList(r.questions_entretien, 3), nextSteps: itemList(r.prochaines_etapes, 2) }
}

/** Part d'un critère dans l'évaluation : points sur son poids (ramené à 100), ou « Non disponible ». */
export interface EvaluationPart {
  key: CriterionKey
  label: string
  max: number
  points: number
  detail: string
  unavailable: boolean
}

/** Évaluation d'un profil, affichée dans son panneau (analyse de l'IA, distincte des données d'Apollo). */
export interface MbcEvaluation {
  score: number
  parts: EvaluationPart[]
  /** Critère qui plafonne le score, avec son plafond. */
  cap: { label: string; value: number } | null
  reason: string
  summary: string
  strengths: string[]
  concerns: string[]
  /** Exigences et compétences du besoin que le profil ne montre pas. */
  missing: string[]
  questions: string[]
  nextSteps: string[]
}

const round = (n: number) => Math.round(n * 10) / 10

/**
 * Évaluation calculée par le code à partir des jugements de l'IA (vérifiés : parseJudgements, title-check) : barème du
 * matching aux poids du recruteur (`weights`), critères indisponibles hors du score, compétences non visibles sans
 * plafond. `judged` : exigences et compétences jugées, dans l'ordre des jugements.
 */
export function evaluationOf(
  j: MatchJudgements, judged: OfferCriteria, weights: ScaleWeights, notes: ScoringNotes, extras: { questions: string[]; nextSteps: string[] },
  { titleAsked = true }: { titleAsked?: boolean } = {},
): MbcEvaluation {
  // Les critères indisponibles ne sont pas jugés : neutres, ils n'ont ni points (poids nul) ni plafond. Besoin sans
  // intitulé (compétences seules) : le poste ne départage personne, comme dans le classement (scoreProfile).
  const neutral: MatchJudgements = {
    ...j,
    roles: titleAsked ? j.roles : [{ title: '', fit: 'oui' }],
    fits: { ...j.fits, formation: 'non requis', langue: 'non requis', tjm: 'non précisé' },
  }
  const results = criterionResults(neutral)
  const w = apolloWeights(weights)
  const scored = scoreOf('matching', results, w, APOLLO_CAPS)
  const notSeen = (items: string[], values: MatchJudgements['skills'], listed: boolean) =>
    (listed ? items.filter((_, i) => values[i] !== 'oui') : [])
  return {
    score: scored.score,
    parts: results.map(r => {
      const unavailable = APOLLO_UNAVAILABLE.includes(r.key)
      const detail = unavailable ? 'Non disponible' : r.key === 'poste' && !titleAsked ? 'Non demandé' : r.detail
      return { key: r.key, label: labelOf('matching', r.key), max: round(w[r.key] ?? 0), points: round((w[r.key] ?? 0) * r.ratio), detail, unavailable }
    }),
    cap: scored.cap ? { label: labelOf('matching', scored.cap.key), value: scored.cap.value } : null,
    reason: notes.reason,
    summary: notes.summary,
    strengths: notes.strengths,
    concerns: notes.concerns,
    missing: [...notSeen(judged.requirements, j.requirements, j.requirementsListed), ...notSeen(judged.skills, j.skills, j.skillsListed)].slice(0, 8),
    questions: extras.questions,
    nextSteps: extras.nextSteps,
  }
}
