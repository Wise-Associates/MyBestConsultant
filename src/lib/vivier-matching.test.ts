import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_OFFERS_PER_RUN, OFFERS_PER_CALL, VIVIER_MATCH_MIN_SCORE, matchingOffers, mergeOfferScores, newOffersFor,
  VIVIER_MATCHING_SYSTEM, offerBatches, offersToCompare, parseOfferScores, parseVivierMatching, serializeOfferScores,
  profileForAi, vivierMatchingPrompt, vivierScore, type OfferScore, type OfferToScore,
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
  const offers = [offer('a'), offer('b'), { ...offer('c'), skills: ['Java', 'Spring', 'SQL'] }]
  // Profil fictif tel que l'IA le lit : les citations et intitulés de ses réponses y sont vérifiés.
  const cv = 'Parcours :\n- Développeur Java — Banque Fictive (2020-2024) : Développement Java Spring pour la banque de détail\n'
    + '- Scrum Master — Assureur Fictif (2018-2019) : Animation des cérémonies Scrum de deux équipes'
  const line = 'Développement Java Spring pour la banque de détail'
  const ok = { jugement: 'oui', citation: line }
  const item = (offre: unknown, over: Record<string, unknown> = {}) => ({
    offre, poste: [{ metier: 'Développeur Java', exerce: 'oui', intitule: 'Développeur Java' }], exigences: ok, competences: [ok], domaine: 'oui', niveau: 'oui', ...over,
  })
  const parse = (items: unknown[]) => parseVivierMatching(`Voici : ${JSON.stringify(items)}`, offers, cv)?.map(vivierScore) ?? null

  it('rattache chaque réponse à l\'offre de son numéro, jamais à un identifiant recopié par l\'IA', () => {
    assert.deepEqual(parse([
      item(2, { raison: 'Java en banque' }),
      item('3', { competences: [ok, { jugement: 'partiel' }, { jugement: 'non' }], niveau: 'partiel', raison: 'SQL absent' }),
    ]), [
      score('b', 100, 'Poste : Développeur Java oui · Exigences : oui · Compétences : 1 sur 1 · Domaine : oui · Niveau : oui — Java en banque'),
      score('c', 88, 'Poste : Développeur Java oui · Exigences : oui · Compétences : 1 sur 3, 1 partielle · Domaine : oui · Niveau : partiel — SQL absent'),
    ])
  })

  it('ignore un numéro hors du lot ou répété, et une réponse sans jugement (l\'offre reste à comparer)', () => {
    const result = parse([item(9), item(1), item(1, { domaine: 'non' }), { offre: 2, score: 95 }, { offerId: 'c', score: 90 }])
    assert.deepEqual((result ?? []).map(s => [s.jobId, s.score]), [['a', 100]])
  })

  it('un « oui » sans expérience citée ne vaut que « partiel »', () => {
    assert.equal(parse([item(1, { competences: ['oui'] })])?.[0].score, 90)
  })

  it('juge chaque métier d\'un titre qui en réunit plusieurs : Scrum Master sans développement plafonné à 50', () => {
    const [result] = parse([item(1, {
      poste: [{ metier: 'Scrum Master', exerce: 'oui', intitule: 'Scrum Master' }, { metier: 'Développeur Full Stack', exerce: 'non' }],
      domaine: 'non requis', raison: 'aucun développement',
    })]) ?? []
    assert.equal(result.score, 50)
    assert.match(result.reason, /^Poste : Scrum Master oui, Développeur Full Stack non · /)
  })

  it('plafonne le score quand le poste du titre n\'a pas été exercé, quelles que soient les compétences', () => {
    assert.equal(parse([item(1, { poste: [{ metier: 'Chef de projet', exerce: 'non' }] })])?.[0].score, 50)
  })

  it('plafonne le score quand le domaine exigé manque, quelles que soient les compétences', () => {
    assert.equal(parse([item(1, { domaine: 'non' })])?.[0].score, 60)
  })

  it('refuse une réponse qui n\'est pas un tableau JSON', () => {
    assert.equal(parseVivierMatching('Je ne peux pas répondre.', offers, cv), null)
    assert.equal(parseVivierMatching('[{"offre": 1, domaine: "oui"]', offers, cv), null)
  })

  it('borne la taille du message même pour des offres et un CV saisis sans limite', () => {
    const hostile: OfferToScore = { $id: 'h', title: 'T'.repeat(5000), skills: Array.from({ length: 500 }, () => 'S'.repeat(100)), location: 'L'.repeat(5000), description: 'D'.repeat(50_000) }
    const prompt = vivierMatchingPrompt('C'.repeat(100_000), Array.from({ length: OFFERS_PER_CALL }, () => hostile))
    assert.ok(prompt.length < 70_000, `${prompt.length} caractères`)
  })

  it('le profil extrait (repli sans texte de CV) reste borné', () => {
    const profile = { skills: Array.from({ length: 500 }, () => 'K'.repeat(100)), experienceSummary: 'E'.repeat(50_000), experiences: Array.from({ length: 50 }, () => ({ title: 'P'.repeat(5000) })), yearsOfExperience: 3, languages: Array.from({ length: 50 }, () => ({ name: 'N'.repeat(500), level: 'C1' })) }
    assert.ok(profileForAi(profile).length < 20_000, `${profileForAi(profile).length} caractères`)
  })

  it('envoie le texte du CV, comme toute notation, et le barème commun (ADR 0029)', () => {
    const prompt = vivierMatchingPrompt('Développeur Java — Banque Fictive (2020 - 2024) : Refonte du crédit immobilier', [offer('a')])
    assert.match(prompt, /=== CV DU CANDIDAT ===\nDéveloppeur Java — Banque Fictive \(2020 - 2024\) : Refonte du crédit immobilier/)
    assert.match(VIVIER_MATCHING_SYSTEM, /une compétence ou un outil ne la prouve pas/)
    assert.match(VIVIER_MATCHING_SYSTEM, /"offre":1/)
    assert.match(VIVIER_MATCHING_SYSTEM, /"intitule"/)
    assert.match(VIVIER_MATCHING_SYSTEM, /coordonnées et liens du CV sont masqués/)
    assert.doesNotMatch(VIVIER_MATCHING_SYSTEM, /"score"/)
  })

  it('profil extrait : le parcours (employeurs, périodes, missions) pour juger le domaine', () => {
    assert.match(profileForAi({
      skills: ['Java'], experienceSummary: 'Développeur fictif.', yearsOfExperience: 6, languages: [],
      experiences: [{ title: 'Développeur Java', company: 'Banque Fictive', period: '2020 - 2024', missions: ['Refonte du crédit immobilier'] }],
    }), /Développeur Java — Banque Fictive \(2020 - 2024\) : Refonte du crédit immobilier/)
  })

  it('profil extrait : ni le nom ni les coordonnées du candidat ; offres numérotées, sans identifiant', () => {
    const candidate = profileForAi({
      skills: ['Java', 'Spring'], experienceSummary: 'Développeur fictif.', experiences: [{ title: 'Développeur Java' }],
      yearsOfExperience: 6, languages: [{ name: 'Anglais', level: 'B2' }],
    })
    const prompt = vivierMatchingPrompt(candidate, [offer('a')])
    assert.match(prompt, /Développeur Java/)
    assert.match(prompt, /--- Offre 1 ---/)
    assert.match(prompt, /1\. Java/)
    assert.doesNotMatch(prompt, /\ba\b ---/, 'pas d\'identifiant d\'offre à recopier')
    assert.doesNotMatch(prompt, /@|Nom/)
  })
})
