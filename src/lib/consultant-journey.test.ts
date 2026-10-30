import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  JOURNEY_STAGES, MAX_HISTORY, advanceBlockedReason, applyJourneyAction, describeEvent, isJourneyComplete, newJourney,
  journeySteps, parseJourney, reachedPieces, type JourneyAction, type JourneyState,
} from './consultant-journey'

const NOW = new Date('2026-10-30T10:00:00.000Z')
const BY = 'Camille Recruteuse'

function run(journey: JourneyState, ...actions: JourneyAction[]): JourneyState {
  return actions.reduce((current, action) => {
    const result = applyJourneyAction(current, action, BY, NOW)
    assert.ok(result.ok, `action ${JSON.stringify(action)} refusée : ${result.ok ? '' : result.error}`)
    return result.journey
  }, journey)
}

function refused(journey: JourneyState, action: JourneyAction): string {
  const result = applyJourneyAction(journey, action, BY, NOW)
  assert.equal(result.ok, false)
  return result.ok ? '' : result.error
}

/** Parcours arrivé à l'étape « Envoyé au client ». */
const atClient = () => run(newJourney(BY, NOW),
  { type: 'advance' }, { type: 'advance' }, { type: 'advance' },
  { type: 'piece', piece: 'cv_format', status: 'pret' }, { type: 'advance' })

describe('parcours consultant', () => {
  it('suit l’ordre du product owner, de l’appel d’offres à la facture', () => {
    assert.deepEqual(JOURNEY_STAGES.map(s => s.label), [
      'AO importé', 'Publié', 'Matching & score', 'Funnel', 'Entretiens', 'CV validé', 'CV format cabinet',
      'Envoyé au client', 'Contrat', 'Timesheet', 'Facture',
    ])
  })

  it('commence au funnel, avec un événement de démarrage', () => {
    const journey = newJourney(BY, NOW)
    assert.equal(journey.stage, 'funnel')
    assert.equal(journey.status, 'active')
    assert.deepEqual(journey.history, [{ kind: 'start', at: NOW.toISOString(), by: BY, stage: 'funnel' }])
  })

  it('passe librement le funnel, les entretiens et la validation du CV', () => {
    const journey = run(newJourney(BY, NOW), { type: 'advance' }, { type: 'advance' }, { type: 'advance' })
    assert.equal(journey.stage, 'cv_format')
    assert.equal(journey.pieces.cv_format?.status, 'a_produire')
  })

  it('n’envoie pas au client tant que le CV format cabinet n’est pas prêt', () => {
    const journey = run(newJourney(BY, NOW), { type: 'advance' }, { type: 'advance' }, { type: 'advance' })
    assert.equal(refused(journey, { type: 'advance' }), 'Le CV format cabinet doit d’abord être prêt.')
    const sent = run(journey, { type: 'piece', piece: 'cv_format', status: 'pret' }, { type: 'advance' })
    assert.equal(sent.stage, 'envoi_client')
    assert.equal(sent.pieces.envoi_client?.status, 'envoye')
  })

  it('ne propose un contrat qu’à un consultant retenu par le client', () => {
    const journey = atClient()
    assert.equal(refused(journey, { type: 'advance' }), 'Le client doit d’abord retenir le consultant.')
    const declined = run(journey, { type: 'piece', piece: 'envoi_client', status: 'refuse' })
    assert.equal(advanceBlockedReason(declined), 'Le client doit d’abord retenir le consultant.')
    const contract = run(declined, { type: 'piece', piece: 'envoi_client', status: 'retenu' }, { type: 'advance' })
    assert.equal(contract.stage, 'contrat')
    assert.equal(contract.pieces.contrat?.status, 'propose')
  })

  it('va jusqu’à la facture payée : contrat signé, timesheet validé', () => {
    const journey = run(atClient(),
      { type: 'piece', piece: 'envoi_client', status: 'retenu' }, { type: 'advance' },
      { type: 'piece', piece: 'contrat', status: 'signe' }, { type: 'advance' },
      { type: 'piece', piece: 'timesheet', status: 'recu' })
    assert.equal(refused(journey, { type: 'advance' }), 'Le timesheet doit d’abord être validé.')
    const invoice = run(journey, { type: 'piece', piece: 'timesheet', status: 'valide' }, { type: 'advance' })
    assert.equal(invoice.stage, 'facture')
    assert.equal(invoice.pieces.facture?.status, 'a_emettre')
    assert.equal(refused(invoice, { type: 'advance' }), 'Dernière étape du parcours.')
    assert.equal(isJourneyComplete(invoice), false)
    assert.equal(isJourneyComplete(run(invoice, { type: 'piece', piece: 'facture', status: 'payee' })), true)
  })

  it('refuse de changer une pièce d’une étape pas encore atteinte, ou un statut inconnu', () => {
    const journey = atClient()
    assert.equal(refused(journey, { type: 'piece', piece: 'contrat', status: 'signe' }), 'Cette pièce n’est pas encore à l’ordre du jour.')
    assert.equal(refused(journey, { type: 'piece', piece: 'envoi_client', status: 'signe' }), 'Statut inconnu.')
    assert.equal(refused(journey, { type: 'piece', piece: 'envoi_client', status: 'envoye' }), 'La pièce a déjà ce statut.')
    assert.deepEqual(reachedPieces(journey).map(p => p.key), ['cv_format', 'envoi_client'])
  })

  it('revient en arrière sans perdre les pièces, mais pas avant le funnel', () => {
    const journey = atClient()
    const back = run(journey, { type: 'back' })
    assert.equal(back.stage, 'cv_format')
    assert.equal(back.pieces.envoi_client?.status, 'envoye')
    const again = run(back, { type: 'advance' })
    assert.equal(again.pieces.envoi_client?.status, 'envoye')
    assert.equal(refused(newJourney(BY, NOW), { type: 'back' }), 'Première étape du parcours.')
  })

  it('bloque un parcours abandonné jusqu’à ce qu’il soit repris', () => {
    const abandoned = run(atClient(), { type: 'abandon', note: '  Mission annulée par le client ' })
    assert.equal(abandoned.status, 'abandoned')
    assert.equal(abandoned.history.at(-1)?.note, 'Mission annulée par le client')
    assert.equal(refused(abandoned, { type: 'advance' }), 'Le parcours est abandonné : reprenez-le d’abord.')
    assert.equal(refused(abandoned, { type: 'piece', piece: 'envoi_client', status: 'retenu' }), 'Le parcours est abandonné : reprenez-le d’abord.')
    const resumed = run(abandoned, { type: 'resume' })
    assert.equal(resumed.status, 'active')
    assert.equal(resumed.stage, 'envoi_client')
    assert.equal(refused(resumed, { type: 'resume' }), 'Le parcours est déjà en cours.')
  })

  it('n’enregistre que la fin d’un long historique', () => {
    let journey = atClient()
    for (let i = 0; i < MAX_HISTORY; i++) journey = run(journey, { type: 'back' }, { type: 'advance' })
    assert.equal(journey.history.length, MAX_HISTORY)
    assert.equal(journey.history.at(-1)?.kind, 'advance')
  })

  it('relit un parcours enregistré et rejette un contenu illisible', () => {
    const journey = atClient()
    assert.deepEqual(parseJourney(journey.stage, journey.status, JSON.stringify(journey.pieces), JSON.stringify(journey.history)), journey)
    assert.equal(parseJourney('matching', 'active', '{}', '[]'), null)
    assert.equal(parseJourney('funnel', 'termine', '{}', '[]'), null)
    assert.equal(parseJourney('funnel', 'active', '{pas du json', '[]'), null)
    assert.equal(parseJourney('funnel', 'active', '[]', '[]'), null)
  })

  it('décrit l’historique en français', () => {
    const journey = run(atClient(), { type: 'piece', piece: 'envoi_client', status: 'retenu' }, { type: 'abandon' })
    assert.deepEqual(journey.history.slice(-3).map(describeEvent), [
      'Étape « Envoyé au client »', 'Proposition au client : Retenu par le client', 'Parcours abandonné',
    ])
  })
})

describe('bandeau des étapes', () => {
  it('montre les étapes avant le parcours comme faites, et le funnel en cours avant le démarrage', () => {
    const steps = journeySteps(null, { fromAo: true, score: 81.6 })
    assert.deepEqual(steps.slice(0, 4).map(s => [s.key, s.state, s.caption]), [
      ['ao', 'done', undefined], ['publication', 'done', undefined], ['matching', 'done', 'Score 82/100'], ['funnel', 'current', undefined],
    ])
    assert.ok(steps.slice(4).every(s => s.state === 'upcoming'))
  })

  it('marque « AO importé » sans objet pour une offre créée directement', () => {
    assert.deepEqual(journeySteps(null, { fromAo: false, score: null })[0], { key: 'ao', label: 'AO importé', state: 'skipped', caption: 'Offre directe' })
  })

  it('suit l’étape en cours, signale l’abandon et termine à la facture payée', () => {
    const client = journeySteps(atClient(), { fromAo: true, score: null })
    assert.equal(client.find(s => s.state === 'current')?.key, 'envoi_client')
    assert.equal(client.filter(s => s.state === 'done').length, 7)
    const abandoned = journeySteps(run(atClient(), { type: 'abandon' }), { fromAo: true, score: null })
    assert.equal(abandoned.find(s => s.state === 'current')?.caption, 'Abandonné')
    const paid = run(atClient(),
      { type: 'piece', piece: 'envoi_client', status: 'retenu' }, { type: 'advance' },
      { type: 'piece', piece: 'contrat', status: 'signe' }, { type: 'advance' },
      { type: 'piece', piece: 'timesheet', status: 'valide' }, { type: 'advance' },
      { type: 'piece', piece: 'facture', status: 'payee' })
    assert.ok(journeySteps(paid, { fromAo: true, score: null }).every(s => s.state === 'done'))
  })
})
