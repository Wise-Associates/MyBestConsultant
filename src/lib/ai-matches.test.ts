import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { SearchableCandidate } from './cvtheque-search'
import { judgementSummary, type MatchJudgements } from './match-scoring'
import {
  AUTO_MATCH_MAX_ATTEMPTS, AUTO_MATCH_MAX_OFFERS, AUTO_MATCH_WINDOW_MS, autoMatchDecision, autoMatchTaskId, isAutoMatchable, matchHighlights,
  pickOffersForCandidate, type AutoMatchTask,
} from './ai-matches'
import { parseMatchOrigin, parseReviewStatus } from './match-review'

// Données fictives.
const now = new Date('2026-11-18T12:00:00.000Z')
const candidate: SearchableCandidate = {
  name: 'John Exemple', city: 'Lyon', mobilityRadiusKm: null, skills: ['Node.js', 'NestJS', 'PostgreSQL', 'AWS', 'Microservices'],
  experienceSummary: '', experiences: [{ title: 'Développeur Backend Node.js', company: 'Société Fictive', missions: [] }],
  education: [], languages: [], yearsOfExperience: 7, openToWork: true, desiredSector: [], desiredRoles: ['Backend Software Engineer'],
  createdAt: '2026-11-18T10:00:00.000Z', jobFamily: null,
}
const offer = (id: string, title: string, skills: string[], location = 'Lyon') => ({ $id: id, title, skills, location })

describe('correspondances IA : offres comparées à un nouveau candidat', () => {
  const offers = [
    offer('backend', 'Senior Backend Developer (H/F)', ['Node.js', 'NestJS', 'PostgreSQL']),
    offer('node', 'Développeur Node.js', ['Node.js', 'AWS'], 'Paris'),
    offer('front', 'Développeur Frontend', ['React', 'CSS']),
    offer('compta', 'Comptable confirmé', ['Sage', 'Excel'], 'Marseille'),
  ]

  it('garde les offres proches du profil, les plus proches d’abord, et écarte celles sans aucun recoupement', () => {
    const ids = pickOffersForCandidate(candidate, offers, new Set()).map(o => o.$id)
    assert.deepEqual(ids.slice(0, 2).sort(), ['backend', 'node'])
    assert.ok(!ids.includes('compta'))
  })

  it('n’en garde pas plus de 20', () => {
    const many = Array.from({ length: 30 }, (_, i) => offer(`o${i}`, 'Développeur Backend Node.js', ['Node.js']))
    assert.equal(pickOffersForCandidate(candidate, many, new Set()).length, AUTO_MATCH_MAX_OFFERS)
  })

  it('écarte les offres déjà liées au candidat (candidature, correspondance existante)', () => {
    const ids = pickOffersForCandidate(candidate, offers, new Set(['backend'])).map(o => o.$id)
    assert.ok(!ids.includes('backend'))
    assert.ok(ids.includes('node'))
  })

  it('ne compare jamais un candidat désinscrit des sollicitations, sans CV ou d’un autre rôle', () => {
    assert.equal(isAutoMatchable({ role: 'candidate', cvFileId: 'f1' }), true)
    assert.equal(isAutoMatchable({ role: 'candidate', cvFileId: 'f1', optedOutOfOutreach: true }), false)
    assert.equal(isAutoMatchable({ role: 'candidate', cvFileId: '' }), false)
    assert.equal(isAutoMatchable({ role: 'hunter_profile', cvFileId: 'f1' }), false)
    assert.equal(isAutoMatchable(null), false)
  })

  it('ne propose rien pour un profil vide (extraction du CV en échec) plutôt que des appels au hasard', () => {
    const empty = { ...candidate, skills: [], experiences: [], desiredRoles: [] }
    assert.deepEqual(pickOffersForCandidate(empty, offers, new Set()), [])
  })
})

describe('correspondances IA : revue et origine', () => {
  it('lit le statut de revue, « nouveau » par défaut', () => {
    assert.equal(parseReviewStatus('retenu'), 'retenu')
    assert.equal(parseReviewStatus('ecarte'), 'ecarte')
    assert.equal(parseReviewStatus(undefined), 'nouveau')
    assert.equal(parseReviewStatus('supprime'), 'nouveau')
  })

  it('distingue une correspondance trouvée au premier CV de celles du Matching IA', () => {
    assert.equal(parseMatchOrigin('auto'), 'auto')
    assert.equal(parseMatchOrigin(null), 'offre')
  })
})

describe('correspondances IA : tâche persistante d’un candidat', () => {
  const task = (over: Partial<AutoMatchTask>): AutoMatchTask => ({ state: 'pending', attempts: 0, createdAt: now.toISOString(), leaseUntil: '', ...over })
  const minutes = (n: number) => new Date(now.getTime() + n * 60_000).toISOString()

  it('identifiant fixe par candidat, au format d’Appwrite', () => {
    assert.match(autoMatchTaskId('c1'), /^aim[0-9a-f]{33}$/)
    assert.equal(autoMatchTaskId('c1'), autoMatchTaskId('c1'))
    assert.notEqual(autoMatchTaskId('c1'), autoMatchTaskId('c2'))
  })

  it('lance une tâche en file ou en échec, attend une tâche tenue par un autre passage', () => {
    assert.equal(autoMatchDecision(task({}), now), 'run')
    assert.equal(autoMatchDecision(task({ state: 'failed', attempts: 1 }), now), 'run')
    assert.equal(autoMatchDecision(task({ state: 'running', attempts: 1, leaseUntil: minutes(5) }), now), 'wait')
    // Passage interrompu (serveur arrêté) : repris une fois sa tenue expirée.
    assert.equal(autoMatchDecision(task({ state: 'running', attempts: 1, leaseUntil: minutes(-1) }), now), 'run')
  })

  it('ne refait jamais une tâche finie', () => {
    assert.equal(autoMatchDecision(task({ state: 'done', attempts: 1 }), now), 'wait')
    assert.equal(autoMatchDecision(task({ state: 'abandoned', attempts: 3 }), now), 'wait')
  })

  it('n’abandonne jamais un dernier essai encore en cours', () => {
    assert.equal(autoMatchDecision(task({ state: 'running', attempts: AUTO_MATCH_MAX_ATTEMPTS, leaseUntil: minutes(5) }), now), 'wait')
    assert.equal(autoMatchDecision(task({ state: 'running', attempts: AUTO_MATCH_MAX_ATTEMPTS, leaseUntil: minutes(-1) }), now), 'abandon')
  })

  it('abandonne après 3 essais ou passé le délai', () => {
    assert.equal(autoMatchDecision(task({ state: 'failed', attempts: AUTO_MATCH_MAX_ATTEMPTS }), now), 'abandon')
    const old = new Date(now.getTime() - AUTO_MATCH_WINDOW_MS - 1).toISOString()
    assert.equal(autoMatchDecision(task({ createdAt: old }), now), 'abandon')
    assert.equal(autoMatchDecision(task({ createdAt: 'illisible' }), now), 'abandon')
  })
})

describe('correspondances IA : contenu de l’e-mail', () => {
  const judgements: MatchJudgements = {
    scale: 'matching', roles: [{ title: 'Développeur Backend', fit: 'oui' }], requirements: ['oui', 'oui'], requirementsListed: true,
    skills: ['oui', 'oui', 'oui'], skillsListed: true,
    fits: { projet: 'oui', client: 'oui', localisation: 'oui', niveau: 'oui', formation: 'oui', domaine: 'oui', langue: 'non', tjm: 'oui' },
  }
  const reason = `${judgementSummary(judgements)} — Parcours backend solide sur des microservices.`

  it('donne les compétences demandées qu’a le candidat, la phrase de l’IA et les critères faibles', () => {
    const h = matchHighlights(reason, candidate.skills, ['Node.js', 'NestJS', 'Kafka'])
    assert.deepEqual(h.skills, ['Node.js', 'NestJS'])
    assert.equal(h.why, 'Parcours backend solide sur des microservices.')
    assert.equal(h.gaps.length, 1)
    assert.match(h.gaps[0], /^Langue/)
  })

  it('sans résumé lisible, ne donne que les compétences', () => {
    assert.deepEqual(matchHighlights('Texte libre', candidate.skills, ['AWS']), { why: '', skills: ['AWS'], gaps: [] })
  })
})
