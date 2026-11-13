import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PAY_FIELD_LABEL, PAY_NEEDS_CONTRACT, payHint, payListText, payLooksWrong, payShort, payText, payUnitFor, payUnitOf } from './job-pay'

describe('unité du montant d\'une offre', () => {
  it('salaire annuel pour un CDI ou un CDD, TJM sinon (freelance, mission, contrat non précisé)', () => {
    assert.equal(payUnitFor('cdi'), 'an')
    assert.equal(payUnitFor('cdd'), 'an')
    assert.equal(payUnitFor('freelance'), 'jour')
    assert.equal(payUnitFor('mission'), 'jour')
    assert.equal(payUnitFor(undefined), 'jour')
  })

  it('libellé du champ du formulaire selon le contrat', () => {
    assert.equal(PAY_FIELD_LABEL[payUnitFor('cdi')], 'Salaire annuel brut (€/an)')
    assert.equal(PAY_FIELD_LABEL[payUnitFor('freelance')], 'TJM (€/jour)')
  })

  it('texte publié (LinkedIn, affiche) : jamais « €/mois » pour un salaire annuel', () => {
    assert.equal(payText(55000, 'cdi'), 'Salaire : 55 000 €/an')
    assert.equal(payText(650, 'freelance'), 'TJM : 650 €/jour')
  })

  it('signale un montant qui ne ressemble pas à son unité, sans le refuser', () => {
    assert.equal(payLooksWrong(55000, 'jour'), true, '55 000 € par jour : probablement un salaire annuel')
    assert.equal(payLooksWrong(650, 'an'), true, '650 € par an : probablement un TJM')
    assert.equal(payLooksWrong(650, 'jour'), false)
    assert.equal(payLooksWrong(55000, 'an'), false)
  })
})

describe('aide sous le champ « montant » du formulaire de création', () => {
  it('demande le type de contrat quand un montant est saisi sans lui', () => {
    assert.deepEqual(payHint(650, ''), { text: PAY_NEEDS_CONTRACT, warning: true })
    assert.equal(payHint(null, '').warning, false)
  })

  it('dit l\'unité retenue, ou avertit quand le montant ne lui ressemble pas', () => {
    assert.deepEqual(payHint(650, 'freelance'), { text: 'Publié comme TJM (€/jour), sur l’offre et sur LinkedIn.', warning: false })
    assert.equal(payHint(55000, 'cdi').warning, false)
    assert.match(payHint(55000, 'mission').text, /par jour : s’agit-il d’un salaire annuel/)
    assert.match(payHint(650, 'cdd').text, /par an : s’agit-il d’un TJM/)
  })
})

describe('unité affichée pour un montant enregistré', () => {
  it('jamais 60 000 €/j : sans contrat, 60 000 € est un salaire annuel (offre de production du 2026-11-03)', () => {
    assert.equal(payUnitOf(60000, undefined), 'an')
    assert.equal(payText(60000, undefined), 'Salaire : 60 000 €/an')
    assert.equal(payShort(60000, ''), '60 000 €/an')
  })

  it('garde l\'unité du contrat quand le montant lui ressemble', () => {
    assert.equal(payUnitOf(650, 'freelance'), 'jour')
    assert.equal(payUnitOf(55000, 'cdi'), 'an')
    assert.equal(payUnitOf(650, undefined), 'jour', 'sans contrat, 650 € est un TJM')
  })

  it('prend la seule unité vraisemblable quand le contrat la contredit', () => {
    assert.equal(payText(60000, 'freelance'), 'Salaire : 60 000 €/an')
    assert.equal(payShort(60000, 'mission'), '60 000 €/an', 'offre de production : mission à 60 000 €, affichée « €/j »')
    assert.equal(payShort(650, 'cdi'), '650 €/j')
  })

  it('écrit l\'unité en entier dans la liste des offres', () => {
    assert.equal(payListText(620, 'mission'), '620 €/jour')
    assert.equal(payListText(58000, 'cdi'), '58 000 €/an')
  })

  it('n\'invente aucune unité pour un montant entre les deux (salaire mensuel ?)', () => {
    assert.equal(payUnitOf(4500, 'cdi'), null)
    assert.equal(payText(4500, 'cdi'), 'Rémunération : 4 500 €')
    assert.equal(payShort(4500, undefined), '4 500 €')
  })
})
