import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALERT_THRESHOLD_DEFAULT, alertDocId, alertEmailsEnabled, alertProfilePath, alertSubjectKey, alertThresholdOf, idealCandidateEmail, isAlertScore,
} from './recruiter-alerts'

describe('alertes des recruteurs sur leurs offres', () => {
  it('peut alerter à partir de 70 (plus bas des seuils réglables), pas en dessous ni sans score', () => {
    assert.equal(ALERT_THRESHOLD_DEFAULT, 70)
    assert.equal(isAlertScore(70), true)
    assert.equal(isAlertScore(100), true)
    assert.equal(isAlertScore(69), false)
    assert.equal(isAlertScore(null), false)
    assert.equal(isAlertScore(Number.NaN), false)
  })

  it('lit le seuil du recruteur, 70 par défaut ou pour une valeur non proposée', () => {
    assert.equal(alertThresholdOf(undefined), 70)
    assert.equal(alertThresholdOf(85), 85)
    assert.equal(alertThresholdOf(95), 95)
    assert.equal(alertThresholdOf(50), 70)
    assert.equal(alertThresholdOf(83), 70)
    assert.equal(alertThresholdOf('85'), 70)
  })

  it('reconnaît la même personne, qu\'elle postule ou soit trouvée dans la base', () => {
    const viaApplication = alertSubjectKey({ source: 'candidature', subjectId: 'app1', candidateId: 'cand1' })
    const viaBase = alertSubjectKey({ source: 'base', subjectId: 'cand1' })
    assert.equal(viaApplication, viaBase)
    assert.notEqual(alertSubjectKey({ source: 'vivier', subjectId: 'cand1' }), viaBase)
    // Candidature sans profil connu : la candidature tient lieu de personne.
    assert.equal(alertSubjectKey({ source: 'candidature', subjectId: 'app1' }), 'candidat:candidature:app1')
  })

  it('donne un identifiant Appwrite fixe par offre, recruteur et personne', () => {
    const id = alertDocId('job1', 'rec1', 'candidat:cand1')
    assert.match(id, /^al[0-9a-f]{34}$/)
    assert.equal(id, alertDocId('job1', 'rec1', 'candidat:cand1'))
    assert.notEqual(id, alertDocId('job2', 'rec1', 'candidat:cand1'))
    assert.notEqual(id, alertDocId('job1', 'rec2', 'candidat:cand1'))
  })

  it('mène au profil selon sa source', () => {
    assert.equal(alertProfilePath('candidature', 'app1'), '/recruiter/candidates/app1')
    assert.equal(alertProfilePath('base', 'cand1'), '/recruiter/candidate-preview/pool/cand1')
    assert.equal(alertProfilePath('vivier', 'cv1'), '/recruiter/candidate-preview/vivier/cv1')
  })

  it('envoie les e-mails sauf si le recruteur les a coupés', () => {
    assert.equal(alertEmailsEnabled(undefined), true)
    assert.equal(alertEmailsEnabled(true), true)
    assert.equal(alertEmailsEnabled(false), false)
  })

  it('écrit un e-mail sans balise venue de l\'offre ou du CV', () => {
    const mail = idealCandidateEmail({
      recipientName: 'Camille', candidateName: 'Alex <b>Test</b>', jobTitle: 'Data <script>alert(1)</script> Engineer',
      score: 88.4, source: 'candidature', threshold: 80, profileUrl: 'https://exemple.fr/recruiter/candidates/app1',
      jobUrl: 'https://exemple.fr/recruiter/pipeline/job1/matching', alertsUrl: 'https://exemple.fr/recruiter/alertes',
    })
    assert.equal(mail.subject, 'Candidat noté 88/100 pour « Data <script>alert(1)</script> Engineer »')
    assert.ok(mail.bodyHtml.includes('noté 80/100 ou plus'))
    assert.ok(!mail.bodyHtml.includes('<script>'))
    assert.ok(!mail.bodyHtml.includes('<b>Test</b>'))
    assert.ok(mail.bodyHtml.includes('Bonjour Camille,'))
    assert.ok(mail.bodyHtml.includes('88/100'))
    assert.ok(mail.bodyHtml.includes('a postulé à votre offre'))
    assert.ok(mail.bodyHtml.includes('https://exemple.fr/recruiter/alertes'))
  })

  it('coupe un intitulé très long dans l\'objet', () => {
    const mail = idealCandidateEmail({
      recipientName: '', candidateName: '', jobTitle: 'x'.repeat(300), score: 90, source: 'base', threshold: 70, profileUrl: 'u', jobUrl: 'j', alertsUrl: 'a',
    })
    assert.ok(mail.subject.length < 140)
    assert.ok(mail.bodyHtml.includes('Bonjour,'))
    assert.ok(mail.bodyHtml.includes('Un candidat'))
  })

  it('détaille une correspondance trouvée au premier CV, textes échappés', () => {
    const mail = idealCandidateEmail({
      recipientName: 'Sam', candidateName: 'Alex Exemple', jobTitle: 'Développeur Node.js', score: 94, source: 'base', threshold: 70,
      highlights: { why: 'Parcours <b>backend</b> solide.', skills: ['Node.js', 'NestJS'], gaps: ['Langue : non précisé'] },
      profileUrl: 'https://exemple.fr/p', jobUrl: 'https://exemple.fr/recruiter/pipeline/job1/matching', alertsUrl: 'https://exemple.fr/a',
    })
    assert.equal(mail.subject, 'Nouveau candidat proposé par l’IA — Développeur Node.js (94/100)')
    assert.ok(mail.bodyHtml.includes('<li>Node.js</li><li>NestJS</li>'))
    assert.ok(mail.bodyHtml.includes('Parcours &lt;b&gt;backend&lt;/b&gt; solide.'))
    assert.ok(mail.bodyHtml.includes('<li>Langue : non précisé</li>'))
    assert.ok(mail.bodyHtml.includes('ce n’est pas une candidature'))
    assert.ok(mail.bodyHtml.includes('https://exemple.fr/recruiter/pipeline/job1/matching'))
  })
})
