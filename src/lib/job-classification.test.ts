import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { JOB_CLASSIFICATION_LIMITS, jobClassificationRequest, parseJobClassification } from './job-classification'

// Classement d'une offre pour le préfiltre (ADR 0061). Offres fictives.

describe('classement d\'une offre : réponse du modèle', () => {
  it('lit famille, secteurs et métiers, entourés de texte ou de balises markdown', () => {
    const answer = '```json\n{"famille": "conseil_fonctionnel", "secteurs": ["secteur_public"], "metiers": ["Business analyst", "Chef de projet MOA"]}\n```'
    assert.deepEqual(parseJobClassification(answer), {
      jobFamily: 'conseil_fonctionnel', sectors: ['secteur_public'], roles: ['Business analyst', 'Chef de projet MOA'],
    })
  })

  it('ramène secteurs et métiers à leurs listes et à leurs bornes', () => {
    const answer = JSON.stringify({
      famille: 'data_ia',
      secteurs: ['banque', 'Banque', 'inconnu', 'assurance', 'banque', 'energie', 'telecom'],
      metiers: [' Data engineer ', 'data engineer', 42, '', 'Data analyst', 'Architecte data', 'En trop'],
    })
    const parsed = parseJobClassification(answer)!
    assert.deepEqual(parsed.sectors, ['banque', 'assurance', 'energie'])
    assert.deepEqual(parsed.roles, ['Data engineer', 'Data analyst', 'Architecte data'])
    assert.equal(parsed.roles.length, JOB_CLASSIFICATION_LIMITS.roles)
  })

  it('refuse une réponse illisible ou sans famille connue : le préfiltre fait alors comme avant', () => {
    assert.equal(parseJobClassification('pas de JSON'), null)
    assert.equal(parseJobClassification('{"famille": "developpement", '), null)
    assert.equal(parseJobClassification('{"famille": "cuisine", "secteurs": [], "metiers": []}'), null)
    assert.equal(parseJobClassification('{"famille": "constructor"}'), null)
    assert.deepEqual(parseJobClassification('{"famille": "developpement"}'), { jobFamily: 'developpement', sectors: [], roles: [] })
  })

  it('envoie l\'intitulé, les compétences, la description et le texte d\'origine d\'un AO, bornés', () => {
    const request = jobClassificationRequest({
      title: 'Lot 2. Expert données', skills: ['SQL'], description: 'Analyser les besoins.', sourceContext: 'Le ministère des Finances…',
    })
    assert.equal(request, 'Intitulé : Lot 2. Expert données\nCompétences : SQL\nDescription :\nAnalyser les besoins.\nTexte de l\'appel d\'offres d\'origine :\nLe ministère des Finances…')
    assert.ok(!jobClassificationRequest({ title: 'Dev', skills: [], description: 'x' }).includes('Compétences'))
    assert.equal(jobClassificationRequest({ title: 'Dev', skills: [], description: 'a'.repeat(10_000) }).length, JOB_CLASSIFICATION_LIMITS.text)
  })
})
