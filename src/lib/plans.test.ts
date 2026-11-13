import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  FEATURES, STANDARD_ENTITLEMENTS, activeJobsDenial, entitlementsOf, featureDenial, planLabel, usersDenial, type Entitlements,
} from './plans'

const custom = (patch: Partial<Entitlements>): Entitlements => ({ ...STANDARD_ENTITLEMENTS, ...patch })

describe('formules et droits des organisations', () => {
  it('donne aux formules standard les droits qu\'avaient toutes les organisations avant les offres sur mesure', () => {
    for (const plan of ['free', 'essentiel', 'pro', 'gold', 'max', '', undefined, null]) {
      assert.deepEqual(entitlementsOf({ plan }), STANDARD_ENTITLEMENTS)
    }
    assert.equal(STANDARD_ENTITLEMENTS.maxUsers, 15)
    assert.equal(STANDARD_ENTITLEMENTS.maxActiveJobs, null)
    assert.ok(FEATURES.every(f => STANDARD_ENTITLEMENTS.features[f]))
    assert.deepEqual(STANDARD_ENTITLEMENTS.dailyQuotas, {
      mbcSearch: 60, mbcReveal: 100, cvExport: 20, aoSourcing: 20, aoRewrite: 30, aoRetry: 30, vivierMatching: 200, interviewAi: 500,
    })
  })

  it('applique les conditions d\'une offre sur mesure à la seule formule « custom »', () => {
    const terms = custom({ maxUsers: 40, maxActiveJobs: 12 })
    assert.equal(entitlementsOf({ plan: 'custom' }, terms), terms)
    assert.deepEqual(entitlementsOf({ plan: 'pro' }, terms), STANDARD_ENTITLEMENTS)
    // Formule « custom » sans conditions lues (offre retirée) : droits standard, jamais rien de plus.
    assert.deepEqual(entitlementsOf({ plan: 'custom' }, null), STANDARD_ENTITLEMENTS)
  })

  it('nomme les formules, anciennes formules de l\'admin comprises', () => {
    assert.equal(planLabel('free'), 'Gratuite')
    assert.equal(planLabel('essentiel'), 'Essentiel')
    assert.equal(planLabel('pro'), 'Pro')
    assert.equal(planLabel('custom'), 'Sur mesure')
    assert.equal(planLabel('gold'), 'Gold')
    assert.equal(planLabel('inconnue'), 'inconnue')
  })
})

describe('contrôles des droits', () => {
  it('refuse une fonction que la formule ne comprend pas', () => {
    assert.equal(featureDenial(STANDARD_ENTITLEMENTS, 'mbcSearch'), null)
    const off = custom({ features: { ...STANDARD_ENTITLEMENTS.features, aiInterviews: false } })
    assert.match(featureDenial(off, 'aiInterviews') ?? '', /entretiens IA.*pas compris dans la formule/)
    assert.equal(featureDenial(off, 'cvExport'), null)
  })

  it('limite les offres actives seulement quand la formule en fixe un nombre', () => {
    assert.equal(activeJobsDenial(STANDARD_ENTITLEMENTS, 500), null)
    const three = custom({ maxActiveJobs: 3 })
    assert.equal(activeJobsDenial(three, 2), null)
    assert.match(activeJobsDenial(three, 3) ?? '', /3 offres actives/)
    assert.match(activeJobsDenial(custom({ maxActiveJobs: 1 }), 1) ?? '', /1 offre active /)
  })

  it('compte toutes les offres d\'un import dans la limite', () => {
    const ten = custom({ maxActiveJobs: 10 })
    assert.equal(activeJobsDenial(ten, 4, 6), null)
    assert.match(activeJobsDenial(ten, 4, 7) ?? '', /vous en avez 4 .* importez-en 6 au plus/)
    assert.equal(activeJobsDenial(STANDARD_ENTITLEMENTS, 400, 50), null)
  })

  it('limite les utilisateurs, invitations en attente et comptes désactivés compris', () => {
    assert.equal(usersDenial(STANDARD_ENTITLEMENTS, 14), null)
    assert.match(usersDenial(STANDARD_ENTITLEMENTS, 15) ?? '', /15 utilisateurs/)
    assert.equal(usersDenial(custom({ maxUsers: 40 }), 15), null)
  })
})
