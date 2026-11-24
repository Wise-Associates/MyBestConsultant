import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALERT_THRESHOLD_DEFAULT, alertDocId, alertEmailsEnabled, alertEmailWanted, alertProfilePath, alertSubjectKey, alertThresholdOf, idealCandidateEmail,
  isAlertScore, meetsAlertRule,
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

  it('prévient de toute candidature, quel que soit son score ou sans score (ADR 0051)', () => {
    assert.equal(meetsAlertRule({ source: 'candidature', score: 12 }, 95), true)
    assert.equal(meetsAlertRule({ source: 'candidature', score: null }, 70), true)
    assert.equal(meetsAlertRule({ source: 'candidature', score: 99 }, 70), true)
  })

  it('ne prévient d\'un candidat de la base ou d\'un CV du vivier qu\'au seuil du recruteur', () => {
    assert.equal(meetsAlertRule({ source: 'base', score: 70 }, 70), true)
    assert.equal(meetsAlertRule({ source: 'base', score: 69 }, 70), false)
    assert.equal(meetsAlertRule({ source: 'base', score: 79 }, 80), false)
    assert.equal(meetsAlertRule({ source: 'vivier', score: 85 }, 80), true)
    assert.equal(meetsAlertRule({ source: 'base', score: null }, 70), false)
  })

  it('suit chaque candidature à part, même pour une personne déjà signalée depuis la base', () => {
    const viaApplication = alertSubjectKey({ source: 'candidature', subjectId: 'app1' })
    assert.equal(viaApplication, 'candidature:app1')
    assert.notEqual(viaApplication, alertSubjectKey({ source: 'base', subjectId: 'cand1' }))
    assert.notEqual(alertSubjectKey({ source: 'candidature', subjectId: 'app2' }), viaApplication)
    assert.equal(alertSubjectKey({ source: 'base', subjectId: 'cand1' }), 'candidat:cand1')
    assert.notEqual(alertSubjectKey({ source: 'vivier', subjectId: 'cand1' }), 'candidat:cand1')
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

  it('envoie toujours l\'e-mail d\'une candidature, même e-mails coupés (ADR 0051)', () => {
    assert.equal(alertEmailWanted('candidature', false), true)
    assert.equal(alertEmailWanted('candidature', undefined), true)
    assert.equal(alertEmailWanted('base', false), false)
    assert.equal(alertEmailWanted('base', undefined), true)
    assert.equal(alertEmailWanted('vivier', false), false)
  })

  it('annonce une candidature avec son score, textes de l\'offre et du CV échappés', () => {
    const mail = idealCandidateEmail({
      recipientName: 'Camille', candidateName: 'Alex <b>Test</b>', jobTitle: 'Data <script>alert(1)</script> Engineer',
      score: 41.6, source: 'candidature', threshold: 80, profileUrl: 'https://exemple.fr/recruiter/candidates/app1',
      jobUrl: 'https://exemple.fr/recruiter/pipeline/job1/matching', offerUrl: 'https://exemple.fr/recruiter/offres/job1',
      alertsUrl: 'https://exemple.fr/recruiter/alertes',
    })
    assert.equal(mail.subject, 'Nouvelle candidature — Data <script>alert(1)</script> Engineer (42/100)')
    assert.equal(mail.heading, 'Nouvelle candidature')
    assert.ok(!mail.bodyHtml.includes('<script>'))
    assert.ok(!mail.bodyHtml.includes('<b>Test</b>'))
    assert.ok(mail.bodyHtml.includes('Bonjour Camille,'))
    assert.ok(mail.bodyHtml.includes(
      'Nouvelle candidature pour votre offre <strong>« Data &lt;script&gt;alert(1)&lt;/script&gt; Engineer »</strong> : <strong>Alex &lt;b&gt;Test&lt;/b&gt;</strong>.',
    ))
    assert.ok(mail.bodyHtml.includes('<strong>42/100</strong>'))
    assert.ok(mail.bodyHtml.includes('>Voir la candidature</a>'))
    // La candidature n'est que derrière le bouton ; « Allez sur l'offre » mène à l'offre (vue recruteur).
    assert.equal(mail.bodyHtml.split('https://exemple.fr/recruiter/candidates/app1').length - 1, 1)
    assert.ok(mail.bodyHtml.includes('<a href="https://exemple.fr/recruiter/offres/job1" style="color:#E8A33D;">Allez sur l’offre</a>'))
    assert.ok(!mail.bodyHtml.includes('copiez'))
    assert.ok(mail.bodyHtml.includes('<a href="https://exemple.fr/recruiter/pipeline/job1/matching" style="color:#E8A33D;">Voir le Matching IA de l’offre</a>'))
    // Le seuil du recruteur ne s'applique pas aux candidatures : l'e-mail ne le cite pas.
    assert.ok(mail.bodyHtml.includes('chaque candidature reçue sur une de vos offres, quel que soit son score'))
    assert.ok(!mail.bodyHtml.includes('80/100'))
    assert.ok(mail.bodyHtml.includes('https://exemple.fr/recruiter/alertes'))
  })

  it('annonce une candidature sans score ni nom lisible', () => {
    const mail = idealCandidateEmail({
      recipientName: '', candidateName: ' ', jobTitle: 'Chef de projet', score: null, source: 'candidature', threshold: 70,
      profileUrl: 'u', jobUrl: 'j', offerUrl: 'o', alertsUrl: 'a',
    })
    assert.equal(mail.subject, 'Nouvelle candidature — Chef de projet')
    assert.ok(mail.bodyHtml.includes('Nouvelle candidature pour votre offre <strong>« Chef de projet »</strong>. Elle n’a pas'))
    assert.ok(mail.bodyHtml.includes('pas encore de score'))
    assert.ok(!mail.bodyHtml.includes('null'))
    assert.ok(!mail.bodyHtml.includes('/100'))
  })

  it('annonce un candidat de la base noté au seuil du recruteur', () => {
    const mail = idealCandidateEmail({
      recipientName: 'Camille', candidateName: 'Alex Exemple', jobTitle: 'Data Engineer', score: 88.4, source: 'base', threshold: 80,
      profileUrl: 'https://exemple.fr/p', jobUrl: 'https://exemple.fr/j', offerUrl: 'https://exemple.fr/o', alertsUrl: 'https://exemple.fr/a',
    })
    assert.equal(mail.subject, 'Candidat noté 88/100 pour « Data Engineer »')
    assert.ok(mail.bodyHtml.includes('inscrit sur la plateforme, correspond à votre offre'))
    assert.ok(mail.bodyHtml.includes('noté 80/100 ou plus'))
    assert.ok(mail.bodyHtml.includes('>Voir le profil</a>'))
  })

  it('coupe un intitulé très long dans l\'objet', () => {
    const mail = idealCandidateEmail({
      recipientName: '', candidateName: '', jobTitle: 'x'.repeat(300), score: 90, source: 'base', threshold: 70, profileUrl: 'u', jobUrl: 'j', offerUrl: 'o', alertsUrl: 'a',
    })
    assert.ok(mail.subject.length < 140)
    assert.ok(mail.bodyHtml.includes('Bonjour,'))
    assert.ok(mail.bodyHtml.includes('Un candidat'))
  })

  it('détaille une correspondance trouvée au premier CV, textes échappés', () => {
    const mail = idealCandidateEmail({
      recipientName: 'Sam', candidateName: 'Alex Exemple', jobTitle: 'Développeur Node.js', score: 94, source: 'base', threshold: 70,
      highlights: { why: 'Parcours <b>backend</b> solide.', skills: ['Node.js', 'NestJS'], gaps: ['Langue : non précisé'] },
      profileUrl: 'https://exemple.fr/p', jobUrl: 'https://exemple.fr/recruiter/pipeline/job1/matching', offerUrl: 'https://exemple.fr/o', alertsUrl: 'https://exemple.fr/a',
    })
    assert.equal(mail.subject, 'Nouveau candidat proposé par l’IA — Développeur Node.js (94/100)')
    assert.ok(mail.bodyHtml.includes('<li>Node.js</li><li>NestJS</li>'))
    assert.ok(mail.bodyHtml.includes('Parcours &lt;b&gt;backend&lt;/b&gt; solide.'))
    assert.ok(mail.bodyHtml.includes('<li>Langue : non précisé</li>'))
    assert.ok(mail.bodyHtml.includes('ce n’est pas une candidature'))
    assert.ok(mail.bodyHtml.includes('https://exemple.fr/recruiter/pipeline/job1/matching'))
  })
})
