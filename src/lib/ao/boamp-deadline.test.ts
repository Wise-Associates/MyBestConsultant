import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { boampIdOf, boampNoticeDeadline, correctedDeadline, frenchDeadline, pickDeadline } from './boamp-deadline'
import { parseOfferDate } from './dates'

// Avis fictifs, sur la structure réelle des données du BOAMP (eForms, novembre 2026).
const lot = (period: string, endDate: string, endTime?: string) => ({
  'cac:TenderingProcess': { [period]: { 'cbc:EndDate': endDate, ...(endTime ? { 'cbc:EndTime': endTime } : {}) } },
})
const eforms = (lots: unknown[]) => JSON.stringify({ EFORMS: { ContractNotice: { 'cac:ProcurementProjectLot': lots } } })

/** Jour du passage du script : avant toutes les dates des avis fictifs, sauf mention contraire. */
const TODAY = '2026-07-01'

describe('date limite d\'un avis du BOAMP (e-mails de la veille arrivés sans)', () => {
  it('reconnaît l\'identifiant d\'un avis dans le lien de la veille, et rien d\'autre', () => {
    assert.equal(boampIdOf('https://www.boamp.fr/pages/avis/?q=idweb:26-000123'), '26-000123')
    assert.equal(boampIdOf('https://www.boamp.fr/pages/avis/?q=idweb%3A26-000123'), '26-000123')
    assert.equal(boampIdOf('https://ted.europa.eu/fr/notice/-/detail/700001-2026'), null)
    assert.equal(boampIdOf('https://exemple.test/?q=idweb:26-000123'), null, 'autre site')
    assert.equal(boampIdOf(''), null)
  })

  it('prend le champ du BOAMP quand il est rempli', () => {
    assert.equal(boampNoticeDeadline({ datelimitereponse: '2026-11-19T11:00:00+00:00', donnees: eforms([]) }, TODAY), '2026-11-19T11:00:00+00:00')
  })

  it('sinon la plus proche des périodes eForms (candidatures avant offres), heure et fuseau compris', () => {
    const donnees = eforms([
      lot('cac:ParticipationRequestReceptionPeriod', '2026-12-04+01:00', '12:00:00+01:00'),
      lot('cac:TenderSubmissionDeadlinePeriod', '2027-01-15+01:00', '16:00:00+01:00'),
    ])
    assert.equal(boampNoticeDeadline({ datelimitereponse: null, donnees }, TODAY), '2026-12-04T12:00:00+01:00')
    const millis = eforms([lot('cac:ParticipationRequestReceptionPeriod', '2026-08-04+02:00', '12:00:00.000+02:00')])
    assert.equal(boampNoticeDeadline({ datelimitereponse: null, donnees: millis }, TODAY), '2026-08-04T12:00:00+02:00')
    assert.equal(boampNoticeDeadline({ datelimitereponse: null, donnees: eforms([lot('cac:TenderSubmissionDeadlinePeriod', '2026-12-10Z')]) }, TODAY), '2026-12-10')
  })

  it('avis à plusieurs lots : la plus proche encore ouverte ; tous clos, la plus tardive', () => {
    const lots = ['2026-11-01T12:00:00+01:00', '2026-12-01T12:00:00+01:00']
    assert.equal(pickDeadline(lots, '2026-11-10'), '2026-12-01T12:00:00+01:00', 'un lot ouvert : jamais montré comme échu')
    assert.equal(pickDeadline(lots, '2026-12-05'), '2026-12-01T12:00:00+01:00')
    assert.equal(pickDeadline(lots, '2026-11-01'), '2026-11-01T12:00:00+01:00', 'le jour même compte encore')
    assert.equal(pickDeadline([], '2026-11-01'), undefined)
  })

  it('prend la date du dernier rectificatif quand il en donne une, sinon celle de l\'avis', () => {
    const initial = { datelimitereponse: null, donnees: eforms([lot('cac:ParticipationRequestReceptionPeriod', '2026-07-31+02:00', '12:00:00+02:00')]) }
    const extended = { datelimitereponse: null, donnees: eforms([lot('cac:ParticipationRequestReceptionPeriod', '2026-09-07+02:00', '12:00:00+02:00')]) }
    assert.equal(correctedDeadline(initial, extended, TODAY), '2026-09-07T12:00:00+02:00')
    assert.equal(correctedDeadline(initial, { datelimitereponse: null, donnees: eforms([]) }, TODAY), '2026-07-31T12:00:00+02:00', 'rectificatif sans date')
    assert.equal(correctedDeadline(initial, undefined, TODAY), '2026-07-31T12:00:00+02:00')
  })

  it('ne renvoie rien pour un avis sans date, national ou illisible', () => {
    assert.equal(boampNoticeDeadline({ datelimitereponse: null, donnees: eforms([{ 'cac:TenderingProcess': {} }]) }, TODAY), undefined)
    assert.equal(boampNoticeDeadline({ datelimitereponse: null, donnees: JSON.stringify({ FNSimple: { initial: {} } }) }, TODAY), undefined)
    assert.equal(boampNoticeDeadline({ datelimitereponse: null, donnees: '{"tronqué' }, TODAY), undefined)
    assert.equal(boampNoticeDeadline({ datelimitereponse: null, donnees: null }, TODAY), undefined)
  })

  it('écrit la date comme la veille (heure de Paris), lisible par le tableau des offres', () => {
    assert.equal(frenchDeadline('2026-10-27T12:00:00+01:00'), '27/10/2026 à 12:00')
    assert.equal(frenchDeadline('2026-08-04T12:00:00+02:00'), '04/08/2026 à 12:00')
    assert.equal(frenchDeadline('2026-11-19T11:00:00+00:00'), '19/11/2026 à 12:00', 'converti à l\'heure de Paris')
    assert.equal(frenchDeadline('2026-12-10'), '10/12/2026')
    assert.equal(frenchDeadline('2026-10-27T12:00:00'), '27/10/2026 à 12:00', 'sans fuseau : heure de l\'avis, quel que soit le poste')
    const received = new Date('2026-10-27T09:00:00Z')
    assert.equal(parseOfferDate(frenchDeadline('2026-10-27T12:00:00+01:00'), received)?.toISOString().slice(0, 10), '2026-10-27')
  })
})
