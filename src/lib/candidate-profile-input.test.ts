import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cvProfileJsonError, parseCandidateProfileInput, PROFILE_LIMITS, type ProfileInput } from './candidate-profile-input'

const profile = (over: Partial<ProfileInput> = {}): ProfileInput => ({
  phone: '01 23 45 67 89', whatsapp: '', city: 'Lyon', mobilityRadiusKm: 50,
  skills: ['SQL'], experienceSummary: 'Consultante data', openToWork: true,
  desiredSector: ['Banque'], desiredRoles: ['Data Analyst'], photoUrl: '', linkedinUrl: '',
  ...over,
})

describe('profil du candidat envoyé par le navigateur', () => {
  it('accepte un numéro WhatsApp national, international ou vide', () => {
    for (const [input, expected] of [['06 12 34 56 78', '+33612345678'], ['+33 6 12 34 56 78', '+33612345678'], ['0044 7911 123456', '+447911123456'], ['', '']]) {
      const res = parseCandidateProfileInput(profile({ whatsapp: input }))
      assert.ok(res.ok, input)
      assert.equal(res.values.whatsapp, expected)
    }
  })

  it('rattache au champ WhatsApp seulement les erreurs du numéro', () => {
    const res = parseCandidateProfileInput(profile({ whatsapp: '12' }))
    assert.equal(res.ok, false)
    assert.equal(!res.ok && res.field, 'whatsapp')
  })

  it('refuse trop de secteurs avec un message qui nomme les secteurs, pas WhatsApp', () => {
    const many = ['Banque', 'Assurance', 'Aéronautique', 'Automobile', 'Énergie', 'Industrie', 'Retail & Distribution', 'Transport & Logistique']
    assert.ok(many.join(', ').length > PROFILE_LIMITS.desiredSector)
    const res = parseCandidateProfileInput(profile({ whatsapp: '06 12 34 56 78', desiredSector: many }))
    assert.equal(res.ok, false)
    assert.equal(!res.ok && res.field, 'desiredSector')
    assert.match(!res.ok ? res.error : '', /secteurs/)
  })

  it('refuse les valeurs plus longues que les attributs de la base', () => {
    const cases: [Partial<ProfileInput>, string][] = [
      [{ phone: '0'.repeat(31) }, 'phone'],
      [{ city: 'x'.repeat(101) }, 'city'],
      [{ linkedinUrl: 'https://linkedin.com/in/' + 'x'.repeat(300) }, 'linkedinUrl'],
      [{ desiredRoles: ['x'.repeat(501)] }, 'desiredRoles'],
      [{ mobilityRadiusKm: 1e20 }, 'mobilityRadiusKm'],
    ]
    for (const [over, field] of cases) {
      const res = parseCandidateProfileInput(profile(over))
      assert.equal(res.ok, false, field)
      assert.equal(!res.ok && res.field, field)
    }
  })

  it('refuse une forme inattendue sans planter', () => {
    const res = parseCandidateProfileInput({ ...profile(), skills: 'SQL' })
    assert.equal(res.ok, false)
    assert.match(!res.ok ? res.error : '', /rechargez/)
  })

  it('signale un profil (compétences et résumé) trop long pour la base', () => {
    assert.equal(cvProfileJsonError('x'.repeat(PROFILE_LIMITS.cvProfileJson)), null)
    assert.notEqual(cvProfileJsonError('x'.repeat(PROFILE_LIMITS.cvProfileJson + 1)), null)
  })
})
