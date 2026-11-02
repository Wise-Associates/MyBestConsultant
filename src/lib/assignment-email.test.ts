import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assignmentEmail, shouldNotifyAssignee } from './assignment-email'

const base = {
  kind: 'job' as const, title: 'Architecte cloud (H/F)', location: 'Lyon', assigneeName: 'Camille Martin',
  assignerName: 'Alex Durand', url: 'https://exemple.test/recruiter/pipeline/job1/matching',
}

describe('e-mail au recruteur affecté', () => {
  it('ne prévient qu\'un nouveau recruteur, autre que celui qui affecte', () => {
    assert.equal(shouldNotifyAssignee('', 'u2', 'u1'), true)
    assert.equal(shouldNotifyAssignee('u3', 'u2', 'u1'), true, 'réaffectation')
    assert.equal(shouldNotifyAssignee('u2', 'u2', 'u1'), false, 'même recruteur')
    assert.equal(shouldNotifyAssignee('u2', '', 'u1'), false, 'retrait')
    assert.equal(shouldNotifyAssignee('', 'u1', 'u1'), false, 'affectation à soi-même')
  })

  it('nomme l\'offre, celui qui affecte et donne le lien', () => {
    const mail = assignmentEmail(base)
    assert.equal(mail.subject, 'Alex Durand vous a affecté l’offre « Architecte cloud (H/F) »')
    assert.equal(mail.heading, 'Une offre vous est affectée')
    assert.match(mail.bodyHtml, /Bonjour Camille Martin,/)
    assert.match(mail.bodyHtml, /« Architecte cloud \(H\/F\) »<\/strong> \(Lyon\)/)
    assert.match(mail.bodyHtml, /href="https:\/\/exemple\.test\/recruiter\/pipeline\/job1\/matching"/)
    assert.match(mail.bodyHtml, /Alex Durand est en copie/)
  })

  it('parle d\'un appel d\'offres et de son suivi pour un AO', () => {
    const mail = assignmentEmail({ ...base, kind: 'ao', location: '' })
    assert.match(mail.subject, /l’appel d’offres « Architecte cloud/)
    assert.equal(mail.heading, 'Un appel d’offres vous est affecté')
    assert.match(mail.bodyHtml, /Voir l’appel d’offres/)
    assert.match(mail.bodyHtml, /la publication et le sourcing/)
    assert.doesNotMatch(mail.bodyHtml, /\(\)/, 'pas de ville vide')
  })

  it('échappe l\'intitulé, les noms et le lien', () => {
    const mail = assignmentEmail({ ...base, title: '<img src=x onerror=alert(1)>', assignerName: 'A<b>', url: 'https://exemple.test/?a="x"' })
    assert.ok(!mail.bodyHtml.includes('<img src=x'))
    assert.ok(!mail.bodyHtml.includes('A<b>'))
    assert.ok(mail.bodyHtml.includes('href="https://exemple.test/?a=&quot;x&quot;"'))
  })

  it('borne un très long intitulé dans l\'objet, pas dans le corps', () => {
    const mail = assignmentEmail({ ...base, title: 'x'.repeat(300) })
    assert.ok(mail.subject.length < 180)
    assert.ok(mail.subject.endsWith('…»') || mail.subject.endsWith('… »'))
    assert.ok(mail.bodyHtml.includes('x'.repeat(300)))
  })
})
