import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CV_PROFILE_MIN_TEXT, CV_PROFILE_SYSTEM, parseCvProfileResponse } from './cv-profile-prompt'

const now = new Date('2026-11-25T10:00:00.000Z')

describe('CV_PROFILE_SYSTEM', () => {
  it('demande un JSON seul avec tous les champs du profil', () => {
    assert.ok(CV_PROFILE_SYSTEM.startsWith('Tu analyses un CV et en extrais un profil structuré. Réponds UNIQUEMENT avec un JSON valide, sans markdown :\n{'))
    for (const field of ['skills', 'experienceSummary', 'experiences', 'education', 'languages', 'yearsOfExperience', 'candidateName', 'candidateEmail', 'candidatePhone']) {
      assert.ok(CV_PROFILE_SYSTEM.includes(`"${field}"`), field)
    }
    assert.equal(CV_PROFILE_MIN_TEXT, 30)
  })
})

describe('parseCvProfileResponse', () => {
  it('lit le JSON entouré de texte et de balises, borne les listes et convertit les valeurs', () => {
    const response = 'Voici le profil :\n```json\n' + JSON.stringify({
      skills: ['Java', 'Spring', 3, ...Array.from({ length: 30 }, (_, i) => `Outil ${i}`)],
      experienceSummary: 'Dix ans de développement.',
      experiences: [{ title: 'Développeuse', company: 'Exemple SA', period: '2019 - 2022', missions: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }],
      education: [{ degree: 'Master', school: 'Université fictive', year: 2018 }],
      languages: [{ name: 'Anglais' }],
      yearsOfExperience: 7.6,
      candidateName: '  Jeanne Exemple ',
      candidateEmail: '',
      candidatePhone: null,
    }) + '\n```'
    const profile = parseCvProfileResponse(response, now)
    assert.ok(profile)
    assert.equal(profile.skills.length, 20)
    assert.equal(profile.skills[2], '3')
    assert.deepEqual(profile.experiences[0].missions, ['a', 'b', 'c', 'd', 'e', 'f'])
    assert.deepEqual(profile.education, [{ degree: 'Master', school: 'Université fictive', year: '2018' }])
    assert.deepEqual(profile.languages, [{ name: 'Anglais', level: '' }])
    assert.equal(profile.yearsOfExperience, 8)
    assert.equal(profile.candidateName, 'Jeanne Exemple')
    assert.equal(profile.candidateEmail, null)
    assert.equal(profile.candidatePhone, null)
    assert.equal(profile.extractedAt, '2026-11-25T10:00:00.000Z')
  })

  it('laisse vides les champs absents ou d’un autre type', () => {
    const profile = parseCvProfileResponse('{"skills":"Java","yearsOfExperience":"7"}', now)
    assert.deepEqual(profile, {
      skills: [], experienceSummary: '', experiences: [], education: [], languages: [], yearsOfExperience: null,
      candidateName: null, candidateEmail: null, candidatePhone: null, extractedAt: '2026-11-25T10:00:00.000Z',
    })
  })

  it('ne donne jamais d’années négatives', () => {
    assert.equal(parseCvProfileResponse('{"yearsOfExperience":-3}', now)?.yearsOfExperience, 0)
  })

  it('null sans objet JSON', () => {
    assert.equal(parseCvProfileResponse('Je ne peux pas lire ce CV.', now), null)
  })

  it('lève sur un JSON illisible ou un élément de liste qui n’est pas un objet (pas de profil)', () => {
    assert.throws(() => parseCvProfileResponse('{"skills":[}', now))
    assert.throws(() => parseCvProfileResponse('{"experiences":[null]}', now))
  })
})
