import { isCriteriaSummary, reasonWithoutCriteria } from './criteria-scoring'
import { createHash } from 'node:crypto'
import type { SearchableCandidate } from '@/lib/cvtheque-search'
import { covers, preScore } from '@/lib/search/cv-search'
import { scoreBreakdown } from '@/lib/score-breakdown'
import type { MatchHighlights } from '@/lib/recruiter-alerts'

// Correspondances IA des nouveaux candidats (ADR 0047, phase 2 de la demande du PO du 2026-11-18) : au premier CV d'un
// candidat, son profil est comparé à toutes les offres actives ; une offre notée AUTO_MATCH_MIN_SCORE ou plus l'y
// associe (ligne `job_matches` « proposée par l'IA ») et prévient le recruteur de l'offre. Règles pures, testées dans
// ai-matches.test.ts ; lecture, écriture et appels à l'IA : ai-matches-store.ts.

/** Score à partir duquel le candidat est associé à l'offre (demande du PO : 70). */
export const AUTO_MATCH_MIN_SCORE = 70
/**
 * Offres notées par l'IA au plus pour un candidat, une par appel comme « Rafraîchir » (cvScorer) : la notation par lots
 * de 5 offres du vivier général jugeait plus sévèrement (60 contre 75 pour un même CV et une même offre, essai du
 * 2026-11-19), et un candidat aurait eu deux scores pour la même offre (ADR 0029, une seule notation).
 */
export const AUTO_MATCH_MAX_OFFERS = 10
/**
 * Pré-score minimal (preScore, de 0 à 1) pour qu'une offre passe à l'IA : une offre dont ni le métier ni les
 * compétences ne recoupent le profil n'a aucune chance d'atteindre 70. 0,2 = un mot du titre sur trois, ou une
 * compétence demandée sur trois, plus la ville inconnue.
 */
export const AUTO_MATCH_MIN_PRESCORE = 0.2
/** Candidats analysés par jour (UTC) pour toute la plateforme : l'IA est à ses frais et l'inscription est libre. */
export const AUTO_MATCH_DAILY_LIMIT = 300
/** Essais d'un candidat dont l'analyse a échoué (IA indisponible, CV illisible…) ; ensuite, abandon journalisé. */
export const AUTO_MATCH_MAX_ATTEMPTS = 3
/** Durée d'un passage tenu par un serveur : au-delà, un passage interrompu est repris par le cron. */
export const AUTO_MATCH_LEASE_MS = 15 * 60_000
/** Un candidat non analysé dans ce délai (quota plein plusieurs jours, pannes) est abandonné. */
export const AUTO_MATCH_WINDOW_MS = 72 * 3_600_000

/** Offre telle que le préfiltre la lit. */
export interface OfferForPrefilter {
  $id: string
  title: string
  skills: string[]
  location: string
}

const unique = (values: string[]) => [...new Set(values.map(v => v.trim()).filter(Boolean))]

/**
 * Offres à faire noter par l'IA pour ce candidat : celles que le code juge assez proches de son profil (postes exercés
 * et visés, compétences, ville ; preScore, le même que le préfiltre de la base candidats), les plus proches d'abord,
 * AUTO_MATCH_MAX_OFFERS au plus. `exclude` : offres déjà liées au candidat (candidature, correspondance existante).
 */
export function pickOffersForCandidate<T extends OfferForPrefilter>(candidate: SearchableCandidate, offers: T[], exclude: Set<string>): T[] {
  const hit = {
    id: '', sourceId: '',
    roles: unique([...candidate.experiences.map(e => e.title), ...candidate.desiredRoles]),
    skills: unique(candidate.skills),
    city: candidate.city,
  }
  // Profil vide (extraction du CV en échec) : rien ne permet de choisir, aucune offre plutôt que des appels au hasard.
  if (hit.roles.length === 0 && hit.skills.length === 0) return []
  return offers
    .filter(o => !exclude.has(o.$id))
    .map(offer => ({ offer, score: preScore({ title: offer.title, skills: offer.skills, location: offer.location }, hit) }))
    .filter(o => o.score >= AUTO_MATCH_MIN_PRESCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, AUTO_MATCH_MAX_OFFERS)
    .map(o => o.offer)
}

// ── Tâche persistante d'un candidat (document de AO_STATE) ───────────────────────────────────────────────────────

/** En file, en cours (tenue jusqu'à `leaseUntil`), faite, en échec (réessayée), abandonnée. */
export type AutoMatchState = 'pending' | 'running' | 'done' | 'failed' | 'abandoned'
export const AUTO_MATCH_STATES: AutoMatchState[] = ['pending', 'running', 'done', 'failed', 'abandoned']
export const parseAutoMatchState = (value: unknown): AutoMatchState => AUTO_MATCH_STATES.find(s => s === value) ?? 'pending'

export interface AutoMatchTask {
  state: AutoMatchState
  attempts: number
  /** Mise en file (ISO). */
  createdAt: string
  /** Fin de la tenue d'un passage en cours (ISO) ; '' sinon. */
  leaseUntil: string
}

/** Identifiant fixe de la tâche d'un candidat : la mettre en file une seconde fois échoue (409), jamais deux tâches. */
export function autoMatchTaskId(candidateId: string): string {
  return `aim${createHash('sha256').update(`automatch:${candidateId}`).digest('hex').slice(0, 33)}`
}

/**
 * Que faire de la tâche maintenant : la lancer, l'abandonner (trop d'essais ou trop ancienne), ou rien. Un passage
 * encore tenu n'est jamais abandonné sous lui (il finit son dernier essai, puis la tâche est jugée).
 */
export function autoMatchDecision(task: AutoMatchTask, now: Date): 'run' | 'abandon' | 'wait' {
  if (task.state === 'done' || task.state === 'abandoned') return 'wait'
  if (task.state === 'running' && new Date(task.leaseUntil).getTime() > now.getTime()) return 'wait'
  const age = now.getTime() - new Date(task.createdAt).getTime()
  if (task.attempts >= AUTO_MATCH_MAX_ATTEMPTS || !(age <= AUTO_MATCH_WINDOW_MS)) return 'abandon'
  return 'run'
}

/**
 * Candidat à comparer aux offres : un candidat avec un CV, qui n'a pas demandé à ne plus être sollicité
 * (`optedOutOfOutreach`, page de désabonnement ; même règle que la base candidats, isScorable).
 */
export function isAutoMatchable(doc: { role?: unknown; cvFileId?: unknown; optedOutOfOutreach?: unknown } | null): boolean {
  return !!doc && doc.role === 'candidate' && typeof doc.cvFileId === 'string' && doc.cvFileId !== '' && !doc.optedOutOfOutreach
}

// ── Ce que dit l'e-mail au recruteur ─────────────────────────────────────────────────────────────────────────────

const JUDGEMENT_GAP = 50

/**
 * Points saillants d'une correspondance pour l'e-mail : compétences demandées que le candidat a, phrase de l'IA, et
 * critères faibles (moins de la moitié des points) à vérifier — lus dans le résumé des jugements qui commence la
 * raison (scoreBreakdown) ; une raison sans résumé lisible ne donne que les compétences.
 */
export function matchHighlights(reason: string, candidateSkills: string[], offerSkills: string[]): MatchHighlights {
  const skills = unique(offerSkills).filter(s => covers(candidateSkills, s)).slice(0, 8)
  const breakdown = scoreBreakdown(reason)
  // Score noté sur les critères de l'offre (ADR 0061) : la phrase de l'IA ; les critères faibles demandent les critères
  // de l'offre, que l'e-mail ne lit pas.
  if (!breakdown) return { why: isCriteriaSummary(reason) ? reasonWithoutCriteria(reason).trim() : '', skills, gaps: [] }
  return {
    why: breakdown.rest.trim(),
    skills,
    gaps: breakdown.parts.filter(p => p.max > 0 && p.percent < JUDGEMENT_GAP).map(p => (p.detail ? `${p.label} : ${p.detail}` : p.label)).slice(0, 5),
  }
}
