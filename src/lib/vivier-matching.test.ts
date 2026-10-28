import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_OFFERS_PER_RUN, OFFERS_PER_CALL, VIVIER_MATCH_MIN_SCORE, matchingOffers, mergeOfferScores, newOffersFor,
  offerBatches, offersToCompare, parseOfferScores, parseVivierMatching, serializeOfferScores, vivierMatchingPrompt,
  type OfferScore, type OfferToScore,
} from './vivier-matching'

const offer = (id: string): OfferToScore => ({ $id: id, title: `Offre ${id}`, skills: ['Java'], location: 'Lyon', description: 'Mission fictive.' })
const score = (jobId: string, value: number, reason = 'Raison fictive'): OfferScore => ({ jobId, score: value, reason })

describe('vivier général : offres correspondant à un CV', () => {
  it('retient les offres ouvertes notées au moins 65, la mieux notée d\'abord', () => {
    assert.equal(VIVIER_MATCH_MIN_SCORE, 65)
    const scores = [score('a', 64), score('b', 80), score('c', 65), score('fermee', 95)]
    assert.deepEqual(matchingOffers(scores, new Set(['a', 'b', 'c'])).map(s => s.jobId), ['b', 'c'])
  })

  it('ne propose que les offres ouvertes jamais comparées, dans la limite d\'un passage', () => {
    const open = Array.from({ length: MAX_OFFERS_PER_RUN + 5 }, (_, i) => offer(`o${i}`))
    const scores = [score('o0', 20), score('o1', 90)]
    assert.equal(newOffersFor(scores, open).length, MAX_OFFERS_PER_RUN + 3)
    const next = offersToCompare(scores, open)
    assert.equal(next.length, MAX_OFFERS_PER_RUN)
    assert.equal(next[0].$id, 'o2')
  })

  it('ajoute les nouveaux scores, garde le plus récent et retire les offres fermées', () => {
    const merged = mergeOfferScores([score('a', 30), score('b', 70)], [score('a', 75), score('c', 10)], new Set(['a', 'c']))
    assert.deepEqual(merged.map(s => [s.jobId, s.score]), [['a', 75], ['c', 10]])
  })

  it('envoie les offres à l\'IA par lots', () => {
    const batches = offerBatches(Array.from({ length: OFFERS_PER_CALL * 2 + 1 }, (_, i) => i))
    assert.deepEqual(batches.map(b => b.length), [OFFERS_PER_CALL, OFFERS_PER_CALL, 1])
    assert.deepEqual(offerBatches([]), [])
  })
})

describe('vivier général : scores enregistrés sur le CV', () => {
  it('relit ce qu\'il a enregistré, sans raison pour les offres non correspondantes', () => {
    const stored = parseOfferScores(serializeOfferScores([score('a', 40, 'Trop junior'), score('b', 88, 'Java et Lyon')]))
    assert.deepEqual(stored, [score('b', 88, 'Java et Lyon'), score('a', 40, '')])
  })

  it('ne garde la raison que des 10 meilleures correspondances (taille de l\'attribut)', () => {
    const many = Array.from({ length: 100 }, (_, i) => score(`offre-${i}`, 100 - (i % 30), 'x'.repeat(400)))
    const json = serializeOfferScores(many)
    assert.ok(json.length < 20_000)
    assert.equal(parseOfferScores(json).filter(s => s.reason).length, 10)
  })

  it('traite un enregistrement absent ou illisible comme jamais comparé', () => {
    assert.deepEqual(parseOfferScores(null), [])
    assert.deepEqual(parseOfferScores('{pas du json'), [])
    assert.deepEqual(parseOfferScores('[{"jobId":"a","score":"élevé","reason":""}]'), [])
  })
})

describe('vivier général : réponse de l\'IA', () => {
  it('lit les scores des offres du lot, bornés et arrondis, une fois par offre', () => {
    const answer = 'Voici : [{"offerId":"a","score":82.6,"reason":"Java"},{"offerId":"a","score":10},{"offerId":"b","score":140},'
      + '{"offerId":"inconnue","score":99},{"offerId":"c","score":"abc"},{"score":50},{"offerId":"d","score":" 72 "}]'
    assert.deepEqual(parseVivierMatching(answer, ['a', 'b', 'c', 'd']), [score('a', 83, 'Java'), score('b', 100, ''), score('d', 72, '')])
  })

  it('laisse à comparer une offre au score absent ou vide (pas un 0)', () => {
    assert.deepEqual(parseVivierMatching('[{"offerId":"a","score":null},{"offerId":"b","score":""},{"offerId":"c"}]', ['a', 'b', 'c']), [])
  })

  it('refuse une réponse qui n\'est pas un tableau JSON', () => {
    assert.equal(parseVivierMatching('Je ne peux pas répondre.', ['a']), null)
    assert.equal(parseVivierMatching('[{"offerId": "a", score: 3]', ['a']), null)
  })

  it('borne la taille du message même pour des offres saisies sans limite', () => {
    const hostile: OfferToScore = { $id: 'h', title: 'T'.repeat(5000), skills: Array.from({ length: 500 }, () => 'S'.repeat(100)), location: 'L'.repeat(5000), description: 'D'.repeat(50_000) }
    const profile = { skills: Array.from({ length: 500 }, () => 'K'.repeat(100)), experienceSummary: 'E'.repeat(50_000), experiences: Array.from({ length: 50 }, () => ({ title: 'P'.repeat(5000) })), yearsOfExperience: 3, languages: Array.from({ length: 50 }, () => ({ name: 'N'.repeat(500), level: 'C1' })) }
    const prompt = vivierMatchingPrompt(profile, Array.from({ length: OFFERS_PER_CALL }, () => hostile))
    assert.ok(prompt.length < 70_000, `${prompt.length} caractères`)
  })

  it('n\'envoie à l\'IA ni le nom ni les coordonnées du candidat', () => {
    const prompt = vivierMatchingPrompt({
      skills: ['Java', 'Spring'], experienceSummary: 'Développeur fictif.', experiences: [{ title: 'Développeur Java' }],
      yearsOfExperience: 6, languages: [{ name: 'Anglais', level: 'B2' }],
    }, [offer('a')])
    assert.match(prompt, /Développeur Java/)
    assert.match(prompt, /--- Offre \[a\] ---/)
    assert.doesNotMatch(prompt, /@|Nom/)
  })
})
