import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { STANDARD_DAILY_QUOTAS } from './plans'
import { PAYMENT_PENDING_MS, acceptDenial, acceptedDocument, acceptedTerms, adminEditDenial, offerDocument, offerOf, offerPriceText, offerState } from './plan-offers'

const NOW = new Date('2026-11-13T10:00:00.000Z')
const input = {
  name: 'Offre Groupe', priceCents: 120000, period: 'monthly', paymentMethod: 'invoice', daysUntilDue: 30,
  maxUsers: 40, maxActiveJobs: 12, features: ['mbcSearch', 'cvExport', 'cvExport'], dailyQuotas: { ...STANDARD_DAILY_QUOTAS, mbcSearch: 200 },
  validUntil: '2026-12-31',
}
const stored = () => {
  const res = offerDocument(input, NOW)
  if ('error' in res) throw new Error(res.error)
  return res.data
}

describe('offre sur mesure saisie par l\'admin', () => {
  it('enregistre une proposition valable jusqu\'à la fin du jour choisi', () => {
    const data = stored()
    assert.equal(data.status, 'proposed')
    assert.equal(data.validUntil, '2026-12-31T23:59:59.000Z')
    assert.deepEqual(data.features, ['mbcSearch', 'cvExport'])
    assert.equal(data.acceptedAt, null)
  })

  it('refuse des conditions invalides ou une date passée', () => {
    assert.ok('error' in offerDocument({ ...input, priceCents: 0 }, NOW))
    assert.ok('error' in offerDocument({ ...input, maxUsers: 9999 }, NOW))
    assert.ok('error' in offerDocument({ ...input, features: ['inconnue'] }, NOW))
    assert.ok('error' in offerDocument({ ...input, dailyQuotas: { mbcSearch: 5 } }, NOW))
    assert.match((offerDocument({ ...input, validUntil: '2026-11-12' }, NOW) as { error: string }).error, /aujourd'hui ou plus tard/)
    assert.match((offerDocument({ ...input, validUntil: '2027-02-30' }, NOW) as { error: string }).error, /invalide/)
    assert.match((offerDocument({ ...input, validUntil: '2035-01-01' }, NOW) as { error: string }).error, /3 ans/)
  })
})

describe('offre lue et appliquée', () => {
  it('relit les conditions en droits ; fonctions absentes fermées', () => {
    const offer = offerOf(stored())
    assert.ok(offer)
    assert.equal(offer.terms.maxUsers, 40)
    assert.equal(offer.terms.maxActiveJobs, 12)
    assert.deepEqual(offer.terms.features, { mbcSearch: true, aiInterviews: false, aoSourcing: false, cvExport: true })
    assert.equal(offer.terms.dailyQuotas.mbcSearch, 200)
  })

  it('ne devine jamais des droits d\'un document illisible', () => {
    assert.equal(offerOf({ ...stored(), quotasJson: '{' }), null)
    assert.equal(offerOf({ ...stored(), quotasJson: '{"mbcSearch":-1}' }), null)
    assert.equal(offerOf({ ...stored(), status: 'autre' }), null)
  })

  it('relit une offre enregistrée avant l\'ajout d\'un quota (valeur standard) ou d\'un plafond plus bas', () => {
    const offer = offerOf({ ...stored(), quotasJson: '{"mbcSearch":200,"cvExport":50000}', features: null })
    assert.ok(offer)
    assert.equal(offer.terms.dailyQuotas.mbcSearch, 200)
    assert.equal(offer.terms.dailyQuotas.cvExport, 50000)
    assert.equal(offer.terms.dailyQuotas.interviewAi, STANDARD_DAILY_QUOTAS.interviewAi)
    assert.equal(offer.terms.features.mbcSearch, false)
  })

  it('enregistre à l\'acceptation les conditions facturées, en entier', () => {
    const offer = offerOf(stored())!
    const doc = acceptedDocument(offer, { acceptedAt: NOW.toISOString(), acceptedBy: 'u1', stripeSubscriptionId: 'sub_1' })
    const reread = offerOf(doc)
    assert.equal(reread?.status, 'accepted')
    assert.deepEqual(reread?.terms, offer.terms)
    assert.equal(reread?.priceCents, offer.priceCents)
    assert.equal(doc.stripeSubscriptionId, 'sub_1')
  })

  it('n\'applique que les droits d\'une offre acceptée', () => {
    const offer = offerOf(stored())
    assert.equal(acceptedTerms(offer), null)
    assert.equal(acceptedTerms(offer && { ...offer, status: 'accepted' }), offer?.terms)
    assert.equal(acceptedTerms(null), null)
  })
})

describe('acceptation et modification', () => {
  const offer = offerOf(stored())!

  it('accepte une offre proposée encore valable, refuse une offre expirée ou retirée', () => {
    assert.equal(acceptDenial(offer, 'free', NOW), null)
    assert.equal(offerState(offer, new Date('2027-01-01T00:00:00.000Z')), 'expired')
    assert.match(acceptDenial(offer, 'free', new Date('2027-01-01T00:00:00.000Z')) ?? '', /expiré/)
    assert.match(acceptDenial({ ...offer, status: 'withdrawn' }, 'free', NOW) ?? '', /Aucune offre/)
    assert.match(acceptDenial(null, 'free', NOW) ?? '', /Aucune offre/)
  })

  it('laisse payer de nouveau une offre acceptée dont le paiement n\'a pas abouti, pas après sa validité', () => {
    const accepted = { ...offer, status: 'accepted' as const }
    assert.equal(acceptDenial(accepted, 'free', NOW), null)
    assert.match(acceptDenial(accepted, 'custom', NOW) ?? '', /déjà/)
    assert.match(acceptDenial(accepted, 'free', new Date('2027-01-01T00:00:00.000Z')) ?? '', /expiré/)
  })

  it('fige une offre acceptée pendant le contrat et pendant un paiement par carte en cours', () => {
    const accepted = { ...offer, status: 'accepted' as const, acceptedAt: NOW.toISOString() }
    assert.equal(adminEditDenial(offer, 'free', NOW), null)
    assert.equal(adminEditDenial(null, 'free', NOW), null)
    assert.match(adminEditDenial(accepted, 'custom', NOW) ?? '', /contrat en cours/)
    assert.match(adminEditDenial(accepted, 'free', new Date(NOW.getTime() + 3600_000)) ?? '', /moins de 24 h/)
    // Paiement abandonné, ou organisation passée à une autre formule : l'admin peut la remplacer.
    assert.equal(adminEditDenial(accepted, 'free', new Date(NOW.getTime() + PAYMENT_PENDING_MS + 1)), null)
  })

  it('affiche le prix au mois ou à l\'an', () => {
    assert.equal(offerPriceText({ priceCents: 120000, period: 'monthly' }), '1 200 € / mois')
    assert.equal(offerPriceText({ priceCents: 99950, period: 'annual' }), '999,50 € / an')
  })
})
