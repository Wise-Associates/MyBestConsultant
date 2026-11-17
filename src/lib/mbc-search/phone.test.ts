import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { canRequestPhone, mergeNumbers, parsePhoneRequest, parsePhoneResult, phoneNumbersOf, phoneSchema, phoneTypeLabel, settledPhone } from './phone'

// Numéros fictifs (plage réservée à la fiction en France : 01 99 00…, 06 39 98…).
const ID = '0123456789abcdef01234567'

describe('MBC Search : numéros d’Apollo', () => {
  it('garde la forme internationale, sinon les chiffres écrits ; écarte ce qui n’est pas un numéro et les doublons', () => {
    assert.deepEqual(phoneNumbersOf([
      { sanitized_number: '+33639980001', raw_number: '+33 6 39 98 00 01', type_cd: 'mobile' },
      { raw_number: '01 99 00 12 34', type: 'work_hq' },
      { sanitized_number: '+33639980001', type_cd: 'mobile' },
      { sanitized_number: 'javascript:alert(1)' },
      { raw_number: '12' },
      'pas un objet',
    ]), [{ number: '+33639980001', type: 'mobile' }, { number: '0199001234', type: 'work_hq' }])
    assert.deepEqual(phoneNumbersOf(undefined), [])
  })

  it('cinq numéros au plus', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ sanitized_number: `+3363998000${i}` }))
    assert.equal(phoneNumbersOf(many).length, 5)
  })

  it('lit la demande : numéros déjà donnés, et numéro de demande seulement quand Apollo cherche encore', () => {
    const pending = parsePhoneRequest({
      person: { id: ID, contact: { phone_numbers: [{ sanitized_number: '+33199001234', type_cd: 'work_hq' }] } },
      request_id_str: '-9045486258674686251', phone_enrichment: { status: 'pending', request_id: '42' },
    })
    assert.deepEqual(pending, { numbers: [{ number: '+33199001234', type: 'work_hq' }], requestId: '-9045486258674686251' })
    assert.deepEqual(parsePhoneRequest({ person: { id: ID }, request_id_str: '123', phone_enrichment: { status: 'skipped' } }), { numbers: [], requestId: null })
    assert.equal(parsePhoneRequest({ person: { id: ID }, request_id_str: '1; DROP', phone_enrichment: { status: 'pending' } })?.requestId, null)
    assert.equal(parsePhoneRequest({ error: 'x' }), null)
  })

  it('lit le résultat de la seule personne demandée', () => {
    const json = { webhook_result: { people: [
      { id: 'ffffffffffffffffffffffff', phone_numbers: [{ sanitized_number: '+33639980009' }] },
      { id: ID, phone_numbers: [{ sanitized_number: '+33639980001', type_cd: 'mobile', status_cd: 'valid_number' }] },
    ] } }
    assert.deepEqual(parsePhoneResult(json, ID), [{ number: '+33639980001', type: 'mobile' }])
    assert.deepEqual(parsePhoneResult({ webhook_result: { people: [] } }, ID), [])
    assert.deepEqual(parsePhoneResult(null, ID), [])
  })
})

describe('MBC Search : état du téléphone d’un profil', () => {
  it('réunit les numéros sans doublon et conclut la demande', () => {
    const known = [{ number: '+33199001234', type: 'work_hq' }]
    const merged = mergeNumbers(known, [{ number: '+33199001234', type: 'work_hq' }, { number: '+33639980001', type: 'mobile' }])
    assert.deepEqual(merged.map(n => n.number), ['+33199001234', '+33639980001'])
    assert.deepEqual(settledPhone(merged, '2026-11-17T10:00:00.000Z'), { status: 'found', numbers: merged, requestedAt: '2026-11-17T10:00:00.000Z' })
    assert.equal(settledPhone([], '2026-11-17T10:00:00.000Z').status, 'none')
  })

  it('une nouvelle demande seulement si aucune n’a été faite ou si la précédente a échoué', () => {
    assert.equal(canRequestPhone(undefined), true)
    assert.equal(canRequestPhone({ status: 'failed', numbers: [], requestedAt: '' }), true)
    for (const status of ['pending', 'found', 'none'] as const) assert.equal(canRequestPhone({ status, numbers: [], requestedAt: '' }), false)
  })

  it('relit un téléphone gardé avec les mêmes garanties, et refuse un numéro de demande abîmé', () => {
    const ok = { status: 'pending', numbers: [{ number: '+33639980001', type: 'mobile' }], requestId: '-9045486258674686251', requestedAt: '2026-11-17T10:00:00.000Z' }
    assert.equal(phoneSchema.safeParse(ok).success, true)
    assert.equal(phoneSchema.safeParse({ ...ok, requestId: 'abc' }).success, false)
    assert.equal(phoneSchema.safeParse({ ...ok, numbers: [{ number: 'tel:+336', type: 'mobile' }] }).success, false)
    assert.equal(phoneTypeLabel('mobile'), 'Mobile')
    assert.equal(phoneTypeLabel('inconnu'), 'Téléphone')
  })
})
