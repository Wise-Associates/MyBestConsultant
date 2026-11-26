import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { putOpening, takeOpening, withRecruiterOpening } from './recruiter-opening'

describe('ouverture du contexte au nom de l’organisation qui publie (demande de David)', () => {
  it('réécrit « <client> recrute un profil pour … » en « <organisation> recrute pour <client> un profil pour … »', () => {
    const description = [
      'Une mission au cœur des paiements.',
      '',
      '### Le contexte',
      'Un organisme public chargé de la télédéclaration recrute un profil pour assurer le support. Le projet dure deux ans.',
      '',
      '### Au programme',
      '- Qualifier les incidents',
    ].join('\n')
    assert.equal(withRecruiterOpening(description, 'Altrion'), description.replace(
      'Un organisme public chargé de la télédéclaration recrute un profil',
      'Altrion recrute pour un organisme public chargé de la télédéclaration un profil',
    ))
    assert.equal(withRecruiterOpening('### Le contexte\nUn grand groupe bancaire recrute un ingénieur Java.', 'Wise Associates'),
      '### Le contexte\nWise Associates recrute pour un grand groupe bancaire un ingénieur Java.')
  })

  it('garde la virgule d’une apposition et la casse d’un sigle', () => {
    assert.equal(withRecruiterOpening('### Le contexte\nUn ministère, soutenu par un projet international, recrute un profil pour structurer ses données.', 'Altrion'),
      '### Le contexte\nAltrion recrute pour un ministère, soutenu par un projet international, un profil pour structurer ses données.')
    assert.equal(withRecruiterOpening('### Le contexte\nSNCF Réseau recrute un chef de projet.', 'Altrion'), '### Le contexte\nAltrion recrute pour SNCF Réseau un chef de projet.')
  })

  it('ne devine rien : déjà ouvert, autre forme, sans section « Le contexte » ou sans organisation, la description reste telle quelle', () => {
    for (const description of [
      '### Le contexte\nAltrion recrute pour une banque un profil.',
      '### Le contexte\nLe client modernise ses paiements.',
      'Une banque recrute un profil.',
      '### Au programme\n- Une banque recrute un profil.',
    ]) assert.equal(withRecruiterOpening(description, 'Altrion'), description)
    assert.equal(withRecruiterOpening('### Le contexte\nUne banque recrute un profil.', '  '), '### Le contexte\nUne banque recrute un profil.')
  })

  it('met l’ouverture de côté pendant l’anonymisation, puis la remet à sa place', () => {
    const description = 'Accroche.\n\n### Le contexte\nWise Associates recrute pour une banque un profil.\n\n### Profil recherché\n- Java'
    const taken = takeOpening(description, 'Wise Associates')
    assert.equal(taken.description, 'Accroche.\n\n### Le contexte\nune banque un profil.\n\n### Profil recherché\n- Java')
    assert.equal(putOpening(taken.description, taken.opening), description)
    // Ailleurs que dans l'ouverture, le nom n'est pas protégé.
    assert.equal(takeOpening('### Profil recherché\n- Wise Associates recrute pour…', 'Wise Associates').opening, null)
    assert.equal(takeOpening(description, '').opening, null)
    assert.equal(putOpening('### Le contexte\nune banque.', null), '### Le contexte\nune banque.')
  })
})
