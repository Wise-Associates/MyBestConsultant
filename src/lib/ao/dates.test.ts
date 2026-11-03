import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isPastDeadline, offerDateCount, parseOfferDate, placeUnlabeledDates } from './dates'

// E-mail reçu le mercredi 21 octobre 2026 : référence pour les dates écrites sans année.
const received = new Date('2026-10-21T09:00:00Z')
const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null

describe('dates d\'un appel d\'offres', () => {
  it('lit les formats courants, avec ou sans année', () => {
    assert.equal(iso(parseOfferDate('30/10/2026', received)), '2026-10-30')
    assert.equal(iso(parseOfferDate('30.10.26', received)), '2026-10-30')
    assert.equal(iso(parseOfferDate('2026-11-02', received)), '2026-11-02')
    assert.equal(iso(parseOfferDate('lundi 2 novembre', received)), '2026-11-02')
    assert.equal(iso(parseOfferDate('1er déc. 2026', received)), '2026-12-01')
    assert.equal(iso(parseOfferDate('02/11', received)), '2026-11-02')
    assert.equal(iso(parseOfferDate('15/01', received)), '2027-01-15', 'sans année et déjà passée : l\'an prochain')
    assert.equal(parseOfferDate('31/02/2026', received), null)
    assert.equal(parseOfferDate('ASAP', received), null)
  })

  it('classe une date sans libellé selon son jour : vendredi = date limite, lundi = démarrage', () => {
    assert.deepEqual(placeUnlabeledDates({ startDate: '', deadline: '' }, ['30/10/2026'], received), { startDate: '', deadline: '30/10/2026' })
    assert.deepEqual(placeUnlabeledDates({ startDate: '', deadline: '' }, ['02/11/2026'], received), { startDate: '02/11/2026', deadline: '' })
    assert.deepEqual(placeUnlabeledDates({ startDate: '', deadline: '' }, ['02/11/2026', '30/10/2026'], received), { startDate: '02/11/2026', deadline: '30/10/2026' })
    assert.deepEqual(placeUnlabeledDates({ startDate: '', deadline: '' }, ['lundi 2 novembre'], received), { startDate: 'lundi 2 novembre', deadline: '' })
  })

  it('met une date sans libellé d\'un autre jour, ou illisible, en date limite', () => {
    assert.deepEqual(placeUnlabeledDates({ startDate: '', deadline: '' }, ['28/10/2026'], received), { startDate: '', deadline: '28/10/2026' })
    assert.deepEqual(placeUnlabeledDates({ startDate: '', deadline: '' }, ['fin octobre'], received), { startDate: '', deadline: 'fin octobre' })
  })

  it('ne déplace jamais une date que le texte désigne lui-même', () => {
    // « Démarrage : vendredi 30/10 » reste un démarrage ; « Date limite : lundi 02/11 » reste une date limite.
    assert.deepEqual(placeUnlabeledDates({ startDate: '30/10/2026', deadline: '02/11/2026' }, ['06/11/2026', '09/11/2026'], received), { startDate: '30/10/2026', deadline: '02/11/2026' })
  })
})

describe('date limite passée (offres de la veille)', () => {
  const now = new Date('2026-10-23T05:00:00Z')

  it('reconnaît une date limite antérieure au jour du traitement', () => {
    assert.equal(isPastDeadline('22/10/2026', now), true)
    assert.equal(isPastDeadline('2026-09-30', now), true)
  })

  it('garde une offre dont la date limite est aujourd\'hui ou plus tard', () => {
    assert.equal(isPastDeadline('23/10/2026', now), false, 'le jour même : on peut encore répondre')
    assert.equal(isPastDeadline('16/11/2026 à 18:00', now), false)
  })

  it('ne juge jamais passée une date absente ou illisible', () => {
    assert.equal(isPastDeadline('', now), false)
    assert.equal(isPastDeadline('ASAP', now), false)
  })
})

describe('date limite passée, année lue à la réception de l\'e-mail (offres échues)', () => {
  const now = new Date('2026-11-03T08:00:00Z')

  it('donne à une date sans année l\'année de la réception, et non celle du jour', () => {
    const decemberEmail = new Date('2025-12-01T09:00:00Z')
    assert.equal(isPastDeadline('20/12', now, decemberEmail), true, '20/12/2025 : passée depuis près d\'un an')
    assert.equal(isPastDeadline('20/12', now), false, 'sans la réception, lue comme le 20/12/2026')
  })

  it('garde l\'année suivante pour une date sans année déjà largement passée à la réception', () => {
    assert.equal(isPastDeadline('15/01', now, received), false, '15/01/2027')
  })

  it('compare toujours au jour présent, pas au jour de la réception', () => {
    assert.equal(isPastDeadline('02/11/2026', now, received), true)
    assert.equal(isPastDeadline('03/11/2026', now, received), false, 'le jour même : on peut encore répondre')
  })
})

describe('dates citées dans un texte', () => {
  it('compte une seule date pour chaque format lu, heure comprise', () => {
    for (const text of ['30/10/2026', '30.10.26', '2026-11-02', '02/11', 'lundi 2 novembre', '1er déc. 2026', '29/10/2026 à 11:00', '3 mars']) {
      assert.equal(offerDateCount(text), 1, text)
    }
  })

  it('compte chaque date d\'un texte qui en cite plusieurs', () => {
    assert.equal(offerDateCount('du 01/11 au 20/11/2026'), 2)
    assert.equal(offerDateCount('20/11/2026 (initialement le 10 novembre)'), 2)
  })

  it('ne voit aucune date dans un texte sans date', () => {
    for (const text of ['', 'ASAP', 'fin octobre', '3 mois', '18:00', 'Lot 2']) assert.equal(offerDateCount(text), 0, text)
  })
})
