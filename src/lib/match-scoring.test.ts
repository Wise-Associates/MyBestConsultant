import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DOMAIN_CAP, MATCH_RULES, cappedScore, offerTextForAi, parseDomainFit, recommendationFor, withBonus } from './match-scoring'

describe('expérience du domaine demandé', () => {
  it('lit la réponse de l\'IA, accents et casse compris ; inconnue sinon', () => {
    assert.equal(parseDomainFit('oui'), 'oui')
    assert.equal(parseDomainFit(' Non '), 'non')
    assert.equal(parseDomainFit('PARTIEL'), 'partiel')
    assert.equal(parseDomainFit('non requis'), 'non requis')
    assert.equal(parseDomainFit('non-requis'), 'non requis')
    assert.equal(parseDomainFit(undefined), null)
    assert.equal(parseDomainFit('peut-être'), null)
  })

  it('un 95/100 sans l\'expérience du domaine exigé descend à 60, sous le seuil « correspond » (65)', () => {
    assert.equal(cappedScore(95, 'non'), DOMAIN_CAP.non)
    assert.ok(DOMAIN_CAP.non < 65)
    assert.equal(cappedScore(95, 'partiel'), DOMAIN_CAP.partiel)
    assert.equal(cappedScore(40, 'non'), 40, 'un score déjà bas ne monte pas')
  })

  it('laisse le score quand le domaine est présent, non exigé ou non renseigné', () => {
    assert.equal(cappedScore(95, 'oui'), 95)
    assert.equal(cappedScore(95, 'non requis'), 95)
    assert.equal(cappedScore(95, null), 95)
  })

  it('les consignes de l\'IA demandent la preuve dans les expériences, pas dans les mots-clés', () => {
    assert.match(MATCH_RULES, /une compétence ou un outil ne la prouve pas/)
    assert.match(MATCH_RULES, /60 au plus/)
  })
})

describe('bonus (recommandations) ajouté au score de l\'IA', () => {
  it('ne fait jamais passer un candidat sous le seuil au-dessus de 65', () => {
    assert.equal(withBonus(60, 12), 64)
    assert.equal(withBonus(64, 1), 64)
    assert.equal(withBonus(50, 5), 55)
  })

  it('ajoute le bonus au-dessus du seuil, plafonné à 100', () => {
    assert.equal(withBonus(70, 12), 82)
    assert.equal(withBonus(95, 12), 100)
  })
})

describe('description de l\'offre envoyée à l\'IA', () => {
  const missions = Array.from({ length: 40 }, (_, i) => `- Mission fictive numéro ${i + 1} sur le projet`).join('\n')
  const description = `### Contexte\nGrand groupe fictif.\n\n### Missions\n${missions}\n\n### Profil recherché\n- Expérience de la banque de détail exigée\n- Java, Spring`

  it('met le profil recherché en premier : coupée, la description garde l\'exigence du domaine', () => {
    const text = offerTextForAi(description, 400)
    assert.ok(text.length <= 400, `${text.length}`)
    assert.match(text, /^### Profil recherché/)
    assert.match(text, /banque de détail exigée/)
  })

  it('garde tout le texte quand il tient, et le texte brut quand il n\'a pas de sections', () => {
    assert.match(offerTextForAi(description, 10_000), /Mission fictive numéro 40/)
    assert.equal(offerTextForAi('Développeur Java fictif, banque.', 100), 'Développeur Java fictif, banque.')
    assert.equal(offerTextForAi('x'.repeat(500), 100), 'x'.repeat(100))
  })
})

describe('recommandation d\'un score plafonné', () => {
  it('suit le barème : un 60 n\'est jamais « top »', () => {
    assert.equal(recommendationFor(95), 'top')
    assert.equal(recommendationFor(80), 'good')
    assert.equal(recommendationFor(60), 'average')
    assert.equal(recommendationFor(45), 'weak')
    assert.equal(recommendationFor(10), 'reject')
  })
})
