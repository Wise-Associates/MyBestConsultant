import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { customizedFunnel, stepBlockingMove, stepColumn, type FunnelStep } from './candidate-funnel'

const step = (id: string, type: FunnelStep['type'], extra: Partial<FunnelStep> = {}): FunnelStep =>
  ({ id, type, label: id, status: 'todo', ...extra })
const stages = [
  { slug: 'pending' }, { slug: 'screening', autoAction: 'screening' as const }, { slug: 'interview', autoAction: 'interview' as const },
  { slug: 'phone_interview' }, { slug: 'accepted' }, { slug: 'rejected' },
]

describe('compte rendu obligatoire pour quitter une étape du funnel', () => {
  const funnel = [step('scr', 'screening'), step('ia', 'ai_interview'), step('tel', 'phone'), step('emb', 'hired')]

  it('bloque tout départ de l’étape en cours sans compte rendu, refus compris', () => {
    for (const to of ['interview', 'phone_interview', 'accepted', 'rejected', 'pending']) {
      assert.equal(stepBlockingMove(funnel, stages, 'screening', to)?.id, 'scr', to)
    }
  })

  it('laisse rejoindre la colonne de l’étape en cours (arrivée en Screening)', () => {
    assert.equal(stepBlockingMove(funnel, stages, 'pending', 'screening'), null)
  })

  it('laisse partir une fois le compte rendu rédigé', () => {
    const written = [step('scr', 'screening', { report: 'Profil solide sur la recette.' }), ...funnel.slice(1)]
    assert.equal(stepBlockingMove(written, stages, 'screening', 'interview'), null)
    assert.equal(stepBlockingMove(written, stages, 'screening', 'rejected'), null)
  })

  it('ne compte pas un compte rendu fait d’espaces', () => {
    const blank = [step('scr', 'screening', { report: '   ' }), ...funnel.slice(1)]
    assert.equal(stepBlockingMove(blank, stages, 'screening', 'interview')?.id, 'scr')
  })

  it('juge l’étape en cours, pas les étapes validées avant elle', () => {
    const later = [step('scr', 'screening', { status: 'validated', report: 'ok', result: 'positive' }), step('ia', 'ai_interview'), ...funnel.slice(2)]
    assert.equal(stepBlockingMove(later, stages, 'interview', 'phone_interview')?.id, 'ia')
  })

  it('laisse rejoindre la colonne d’une étape suivante du même type, une fois la première validée', () => {
    const twoCalls = [step('tel1', 'phone', { status: 'validated', result: 'positive', report: 'ok' }), step('tel2', 'phone'), step('emb', 'hired')]
    assert.equal(stepBlockingMove(twoCalls, stages, 'phone_interview', 'phone_interview'), null)
    assert.equal(stepBlockingMove(twoCalls, stages, 'phone_interview', 'accepted')?.id, 'tel2')
  })

  it('laisse libre un parcours terminé et un candidat qui ne bouge pas', () => {
    const done = funnel.map(s => ({ ...s, status: 'validated' as const }))
    assert.equal(stepBlockingMove(done, stages, 'accepted', 'rejected'), null)
    assert.equal(stepBlockingMove(funnel, stages, 'screening', 'screening'), null)
  })
})

describe('colonne d’une étape', () => {
  it('suit la colonne de screening ou d’entretien IA du pipeline, même renommée', () => {
    const custom = [{ slug: 'tri_cv', autoAction: 'screening' as const }, { slug: 'visio_ia', autoAction: 'interview' as const }]
    assert.equal(stepColumn(step('a', 'screening'), custom), 'tri_cv')
    assert.equal(stepColumn(step('b', 'ai_interview'), custom), 'visio_ia')
    assert.equal(stepColumn(step('c', 'phone'), custom), 'phone_interview')
    assert.equal(stepColumn(step('d', 'screening'), []), 'screening')
  })
})

describe('funnel personnalisé reçu du navigateur', () => {
  const saved = [
    step('scr', 'screening', { status: 'validated', result: 'positive', report: 'Vrai compte rendu', validatedBy: 'Camille' }),
    step('tel', 'phone', { status: 'skipped' }), step('vis', 'video'), step('emb', 'hired'),
  ]

  it('garde une étape validée telle qu’enregistrée, même modifiée par le navigateur', () => {
    const forged = [{ ...saved[0], report: 'Compte rendu réécrit', validatedBy: 'Directrice' }, ...saved.slice(1)]
    assert.deepEqual(customizedFunnel(forged, { steps: saved, saved: true }, 'video_interview')[0], saved[0])
  })

  it('refuse de valider ou de passer une étape depuis le navigateur', () => {
    const forged = [saved[0], saved[1],
      { ...saved[2], status: 'validated' as const, result: 'positive' as const, report: 'Inventé', validatedBy: 'Marie', validatedAt: '2026-11-10' },
      { ...saved[3], status: 'skipped' as const }]
    const r = customizedFunnel(forged, { steps: saved, saved: true }, 'video_interview')
    assert.deepEqual(r.map(s => s.status), ['validated', 'skipped', 'todo', 'todo'])
    assert.equal(r[2].validatedBy, undefined)
  })

  it('recalcule les étapes passées d’un funnel jamais enregistré d’après la colonne', () => {
    const fresh = [step('a', 'screening', { status: 'skipped' }), step('b', 'phone', { status: 'skipped' }), step('c', 'video')]
    const r = customizedFunnel(fresh, { steps: [], saved: false }, 'phone_interview')
    assert.deepEqual(r.map(s => s.status), ['skipped', 'todo', 'todo'])
  })
})
