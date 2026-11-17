import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { stepBlockingMove, type FunnelStep } from './candidate-funnel'
import {
  newSubmission, parseClientSubmission, retainedFunnel, sentSteps, serializeClientSubmission, synthesisSteps, withResponse,
  type ClientSubmission,
} from './client-response'

const now = new Date('2026-11-17T10:00:00.000Z')
const step = (id: string, type: FunnelStep['type'], extra: Partial<FunnelStep> = {}): FunnelStep =>
  ({ id, type, label: id, status: 'todo', ...extra })
const validated = (id: string, type: FunnelStep['type'], report?: string): FunnelStep =>
  step(id, type, { status: 'validated', result: 'positive', report, validatedBy: 'Camille Exemple' })

describe('envoi au client', () => {
  const funnel = [validated('scr', 'screening', '7 ans d’AMOA.'), validated('ia', 'ai_interview', 'Réponses précises.'), step('tel', 'phone', { report: 'Brouillon' }), step('emb', 'hired')]

  it('reprend les seules étapes validées avec un compte rendu', () => {
    const r = newSubmission(funnel, null, 'Camille Exemple', now)
    assert.ok('submission' in r)
    assert.deepEqual(r.submission, { sentAt: now.toISOString(), sentBy: 'Camille Exemple', stepIds: ['scr', 'ia'], response: 'pending' })
  })

  it('refuse une candidature sans étape validée avec compte rendu', () => {
    const r = newSubmission([validated('scr', 'screening'), step('tel', 'phone', { report: 'Brouillon' })], null, 'Camille', now)
    assert.deepEqual(r, { error: 'aucune étape validée avec un compte rendu' })
  })

  it('refuse un second envoi', () => {
    const first = newSubmission(funnel, null, 'Camille', now)
    assert.ok('submission' in first)
    assert.deepEqual(newSubmission(funnel, first.submission, 'Camille', now), { error: 'déjà envoyé au client' })
  })

  it('garde la synthèse envoyée même si le funnel avance', () => {
    const sent = newSubmission(funnel, null, 'Camille', now)
    assert.ok('submission' in sent)
    const later = [...funnel.slice(0, 2), validated('tel', 'phone', 'Mobilité confirmée.'), step('emb', 'hired')]
    assert.deepEqual(sentSteps(later, sent.submission).map(s => s.id), ['scr', 'ia'])
    assert.deepEqual(synthesisSteps(later).map(s => s.id), ['scr', 'ia', 'tel'])
  })
})

describe('réponse du client', () => {
  const sent: ClientSubmission = { sentAt: now.toISOString(), sentBy: 'Camille', stepIds: ['scr'], response: 'pending' }

  it('enregistre la réponse et un commentaire nettoyé', () => {
    const r = withResponse(sent, 'interview', '  Profil intéressant,\n disponible jeudi ?  ', 'Thomas Exemple', now)
    assert.equal(r.response, 'interview')
    assert.equal(r.comment, 'Profil intéressant, disponible jeudi ?')
    assert.equal(r.respondedBy, 'Thomas Exemple')
    assert.equal(withResponse(sent, 'rejected', '   ', 'Thomas', now).comment, undefined)
  })

  it('relit ce qu’elle a écrit et ignore une valeur abîmée', () => {
    const r = withResponse(sent, 'retained', 'Bienvenue', 'Thomas', now)
    assert.deepEqual(parseClientSubmission(serializeClientSubmission(r)), r)
    assert.equal(parseClientSubmission('{"sentAt":1}'), null)
    assert.equal(parseClientSubmission('pas du json'), null)
    assert.equal(parseClientSubmission(undefined), null)
  })
})

describe('candidat retenu par le client', () => {
  const stages = [{ slug: 'screening', autoAction: 'screening' as const }, { slug: 'phone_interview' }, { slug: 'accepted' }]

  it('passe dans Embauchés : étapes restantes passées, embauche validée avec la réponse du client', () => {
    const funnel = [validated('scr', 'screening', 'ok'), step('tel', 'phone'), step('emb', 'hired')]
    const r = retainedFunnel(funnel, stages, 'Démarrage le 5 janvier', 'Camille', now)
    assert.equal(r.column, 'accepted')
    assert.deepEqual(r.steps.map(s => [s.id, s.status]), [['scr', 'validated'], ['tel', 'skipped'], ['emb', 'validated']])
    const hired = r.steps[2]
    assert.equal(hired.report, 'Retenu par le client : « Démarrage le 5 janvier »')
    assert.equal(hired.result, 'positive')
    assert.equal(hired.validatedAt, now.toISOString())
  })

  it('sans étape d’embauche : va dans « accepted », parcours clos, et peut en ressortir', () => {
    const noHire = [validated('scr', 'screening', 'ok'), step('tel', 'phone')]
    const r = retainedFunnel(noHire, stages, '', 'Camille', now)
    assert.equal(r.column, 'accepted')
    assert.deepEqual(r.steps.map(s => [s.id, s.status]), [['scr', 'validated'], ['tel', 'skipped']])
    assert.equal(stepBlockingMove(r.steps, stages, 'accepted', 'on_hold'), null)
  })

  it('ne revalide pas une embauche déjà validée', () => {
    const hiredAlready = [validated('scr', 'screening', 'ok'), validated('emb', 'hired', 'Embauché.')]
    assert.equal(retainedFunnel(hiredAlready, stages, '', 'Camille', now).steps, hiredAlready)
  })
})
