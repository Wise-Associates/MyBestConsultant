import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generationDenial, templateUploadDenial } from './access'

describe('generationDenial', () => {
  const ok = { tenantId: 'org1', subscriptionStatus: 'active', emailVerified: true }

  it('permet la génération à une organisation abonnée (essai compris), adresse vérifiée', () => {
    assert.equal(generationDenial(ok), null)
    assert.equal(generationDenial({ ...ok, subscriptionStatus: 'trialing' }), null)
  })

  it('refuse sans organisation, sans abonnement actif ou sans adresse vérifiée', () => {
    assert.match(generationDenial({ ...ok, tenantId: '' }) ?? '', /aucune organisation/)
    for (const status of ['canceled', 'past_due', '', null, undefined]) {
      assert.match(generationDenial({ ...ok, subscriptionStatus: status }) ?? '', /abonnement est actif/, String(status))
    }
    assert.match(generationDenial({ ...ok, emailVerified: false }) ?? '', /adresse e-mail/)
  })
})

describe('templateUploadDenial', () => {
  it('permet le dépôt du modèle à un recruteur à l\'adresse vérifiée, quel que soit l\'abonnement', () => {
    assert.equal(templateUploadDenial({ emailVerified: true }), null)
  })

  it('le refuse sans adresse vérifiée (inscription libre)', () => {
    assert.match(templateUploadDenial({ emailVerified: false }) ?? '', /adresse e-mail/)
  })
})
