import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_CRITERIA, type MbcProfile, type MbcRevealed } from './rules'
import {
  DISCUSSION_LIMITS, discussionPeopleJson, fitDiscussion, mergeDiscussionPeople, parseDiscussion, parseDiscussionPeople,
  type DiscussionMessage, type DiscussionPerson, type MbcDiscussion,
} from './discussion'

const person = (n: number, extra: Partial<MbcRevealed> = {}): DiscussionPerson => {
  const id = n.toString(16).padStart(24, '0')
  return {
    search: { id, firstName: 'Camille', lastNameMasked: 'M***n', title: 'Data Engineer', company: 'Exemple SA', hasEmail: true, hasPhone: false, refreshedAt: '' } satisfies MbcProfile,
    profile: {
      id, name: `Camille Exemple ${n}`, title: 'Data Engineer', headline: '', company: 'Exemple SA', companyWebsite: '', location: 'Lyon, France',
      linkedinUrl: 'https://www.linkedin.com/in/exemple', email: 'camille@exemple.fr', emailStatus: 'verified', photoUrl: '', experiences: [],
      seniority: '', industry: '', ...extra,
    },
  }
}
const criteria = { ...EMPTY_CRITERIA, titles: ['Data Engineer'], locations: ['Lyon'] }
const discussion = (messages: DiscussionMessage[]): MbcDiscussion => ({ brief: 'Data engineer à Lyon', criteria, messages })

describe('MBC Search : discussion enregistrée', () => {
  it('relit ce qu’elle écrit, et rien d’illisible', () => {
    const d = discussion([
      { kind: 'user', text: 'Data engineer à Lyon' }, { kind: 'assistant', text: 'Je lance la recherche.' },
      { kind: 'results', total: 42, label: 'Data Engineer · Lyon' }, { kind: 'error', text: 'Quota atteint.' },
    ])
    assert.deepEqual(parseDiscussion(JSON.stringify(d)), d)
    assert.equal(parseDiscussion('{"brief":1}'), null)
    assert.equal(parseDiscussion('pas du json'), null)
    assert.equal(parseDiscussion(undefined), null)
  })

  it('garde le besoin et la fin d’une discussion trop longue', () => {
    const many: DiscussionMessage[] = [{ kind: 'user', text: 'Le besoin' },
      ...Array.from({ length: 300 }, (_, i) => ({ kind: 'assistant' as const, text: `Réponse ${i} ${'x'.repeat(900)}` }))]
    const fit = fitDiscussion(discussion(many))
    const textOf = (m: DiscussionMessage | undefined) => (m && 'text' in m ? m.text : '')
    assert.equal(textOf(fit.messages[0]), 'Le besoin')
    assert.ok(textOf(fit.messages.at(-1)).startsWith('Réponse 299 '))
    assert.ok(fit.messages.length <= DISCUSSION_LIMITS.messages)
    assert.ok(JSON.stringify(fit).length <= DISCUSSION_LIMITS.chars)
  })

  it('ne coupe pas une discussion courte', () => {
    const d = discussion([{ kind: 'user', text: 'Besoin' }, { kind: 'assistant', text: 'Réponse' }])
    assert.deepEqual(fitDiscussion(d), d)
  })
})

describe('MBC Search : personnes révélées d’une discussion', () => {
  it('relit les personnes écrites, avec les garanties d’un profil révélé', () => {
    const people = [person(1), person(2, { linkedinUrl: 'javascript:alert(1)' })]
    const read = parseDiscussionPeople(discussionPeopleJson(people))
    // Lien qui n'est pas en https : la personne est écartée, comme un profil révélé gardé.
    assert.deepEqual(read.map(p => p.profile.id), [people[0].profile.id])
    assert.deepEqual(read[0], people[0])
  })

  it('ne garde jamais le téléphone d’une personne dans la discussion', () => {
    const withPhone = person(1, { phone: { status: 'found', numbers: [{ number: '+33639980001', type: 'mobile' }], requestedAt: '2026-11-17T10:00:00.000Z' } })
    assert.equal(JSON.stringify(discussionPeopleJson([withPhone])).includes('+33639980001'), false)
    assert.equal(parseDiscussionPeople(discussionPeopleJson([withPhone]))[0].profile.phone, undefined)
  })

  it('écarte une entrée dont la ligne et le profil ne sont pas la même personne', () => {
    const mixed = JSON.stringify([{ search: person(1).search, profile: JSON.parse(discussionPeopleJson([person(2)]))[0].profile }])
    assert.deepEqual(parseDiscussionPeople(mixed), [])
    assert.deepEqual(parseDiscussionPeople('[{"search":1}]'), [])
  })

  it('ajoute les nouvelles personnes sans doublon, 50 au plus', () => {
    const kept = [person(1), person(2)]
    assert.deepEqual(mergeDiscussionPeople(kept, [person(2), person(3)]).map(p => p.profile.name), ['Camille Exemple 1', 'Camille Exemple 2', 'Camille Exemple 3'])
    const crowd = Array.from({ length: 60 }, (_, i) => person(i + 1))
    assert.equal(mergeDiscussionPeople([], crowd).length, DISCUSSION_LIMITS.people)
  })

  it('n’ajoute plus personne au-delà de la taille gardée', () => {
    const long = (n: number) => person(n, { experiences: Array.from({ length: 8 }, () => ({ title: 'Data', company: 'Exemple', start: '', end: '', current: false, description: 'y'.repeat(500) })) })
    const merged = mergeDiscussionPeople([], Array.from({ length: 50 }, (_, i) => long(i + 1)))
    assert.ok(discussionPeopleJson(merged).length <= DISCUSSION_LIMITS.peopleChars)
  })
})
