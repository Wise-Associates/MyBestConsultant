import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  IDEAL_SCORE, alertDocId, alertEmailsEnabled, alertProfilePath, alertSubjectKey, idealCandidateEmail, isIdealScore,
} from './recruiter-alerts'

describe('alertes « profil idéal »', () => {
  it('alerte à partir de 85, pas en dessous ni sans score', () => {
    assert.equal(IDEAL_SCORE, 85)
    assert.equal(isIdealScore(85), true)
    assert.equal(isIdealScore(100), true)
    assert.equal(isIdealScore(84), false)
    assert.equal(isIdealScore(null), false)
    assert.equal(isIdealScore(Number.NaN), false)
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
      score: 88.4, source: 'candidature', profileUrl: 'https://exemple.fr/recruiter/candidates/app1', alertsUrl: 'https://exemple.fr/recruiter/alertes',
    })
    assert.equal(mail.subject, 'Profil idéal (88/100) pour « Data <script>alert(1)</script> Engineer »')
    assert.ok(!mail.bodyHtml.includes('<script>'))
    assert.ok(!mail.bodyHtml.includes('<b>Test</b>'))
    assert.ok(mail.bodyHtml.includes('Bonjour Camille,'))
    assert.ok(mail.bodyHtml.includes('88/100'))
    assert.ok(mail.bodyHtml.includes('a postulé à votre offre'))
    assert.ok(mail.bodyHtml.includes('https://exemple.fr/recruiter/alertes'))
  })

  it('coupe un intitulé très long dans l\'objet', () => {
    const mail = idealCandidateEmail({
      recipientName: '', candidateName: '', jobTitle: 'x'.repeat(300), score: 90, source: 'vivier', profileUrl: 'u', alertsUrl: 'a',
    })
    assert.ok(mail.subject.length < 140)
    assert.ok(mail.bodyHtml.includes('Bonjour,'))
    assert.ok(mail.bodyHtml.includes('Un candidat'))
  })
})
